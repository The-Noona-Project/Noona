// services/sage/clients/discordSetupClient.mjs

import {ChannelType, GatewayIntentBits} from 'discord.js'

import createDiscordClient from './discordClient.mjs'
import {SetupValidationError} from '../lib/errors.mjs'

const normalizeString = (value) => {
    if (typeof value !== 'string') {
        return ''
    }

    return value.trim()
}

const resolveChannelType = (value) => {
    if (typeof value === 'number' && ChannelType[value] !== undefined) {
        return value
    }

    if (typeof value === 'string') {
        const trimmed = value.trim()
        if (!trimmed) {
            return null
        }

        const numericValue = Number(trimmed)
        if (!Number.isNaN(numericValue) && ChannelType[numericValue] !== undefined) {
            return numericValue
        }

        const direct = ChannelType[trimmed]
        if (typeof direct === 'number') {
            return direct
        }

        const pascal = trimmed
            .toLowerCase()
            .split(/[_\s-]+/)
            .filter(Boolean)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join('')

        const resolved = ChannelType[pascal]
        if (typeof resolved === 'number') {
            return resolved
        }
    }

    return null
}

const ensureNonEmpty = (value, label) => {
    const normalized = normalizeString(value)
    if (!normalized) {
        throw new SetupValidationError(`${label} is required.`)
    }

    return normalized
}

const toArray = (collection) => {
    if (!collection) {
        return []
    }

    if (Array.isArray(collection)) {
        return collection
    }

    if (typeof collection.values === 'function') {
        return Array.from(collection.values())
    }

    if (collection.cache) {
        return toArray(collection.cache)
    }

    if (typeof collection.forEach === 'function') {
        const items = []
        collection.forEach((value) => {
            items.push(value)
        })
        return items
    }

    return []
}

const mapRole = (role) => ({
    id: role?.id ?? null,
    name: role?.name ?? null,
    color: role?.hexColor ?? null,
    position: typeof role?.position === 'number' ? role.position : null,
    managed: Boolean(role?.managed),
})

const mapGuild = (guild) => ({
    id: guild?.id ?? null,
    name: guild?.name ?? null,
    description: guild?.description ?? null,
    icon: guild?.icon ?? null,
})

const sortRoles = (a, b) => {
    const posA = typeof a.position === 'number' ? a.position : 0
    const posB = typeof b.position === 'number' ? b.position : 0
    if (posA === posB) {
        return (a.name ?? '').localeCompare(b.name ?? '')
    }

    return posB - posA
}

const mapChannel = (channel) => ({
    id: channel?.id ?? null,
    name: channel?.name ?? null,
    type: channel?.type ?? null,
})

const isUsableRole = (role) => role?.id && !role.managed

const isUsableChannel = (channel) => Boolean(channel?.id && (channel?.name ?? '').trim())

const SETUP_CLIENT_INTENTS = Object.freeze([GatewayIntentBits.Guilds])
const SETUP_CLIENT_PARTIALS = Object.freeze([])

const normaliseDiscordLoginError = (error) => {
    if (!error) {
        return null
    }

    const message = typeof error?.message === 'string' ? error.message : ''
    const code = error?.code ?? null

    if (code === 'TokenInvalid' || /invalid token/i.test(message)) {
        return new SetupValidationError(
            'Discord rejected the provided bot token. Please verify the token and try again.',
        )
    }

    return null
}

const withDiscordClient = async (
    {token, guildId, logger, serviceName, createClient = createDiscordClient},
    handler,
) => {
    const discordClient = createClient({
        token,
        guildId,
        commands: new Map(),
        intents: SETUP_CLIENT_INTENTS,
        partials: SETUP_CLIENT_PARTIALS,
    })

    try {
        try {
            await discordClient.login()
        } catch (error) {
            const mappedError = normaliseDiscordLoginError(error)
            if (mappedError) {
                throw mappedError
            }

            throw error
        }

        return await handler(discordClient)
    } finally {
        try {
            discordClient.destroy?.()
        } catch (error) {
            logger?.error?.(
                `[${serviceName}] Failed to clean up Discord client: ${error instanceof Error ? error.message : error}`,
            )
        }
    }
}

export const createDiscordSetupClient = ({
    logger,
    serviceName = 'noona-sage',
    createClient = createDiscordClient,
} = {}) => {
    const resolveCredentials = (credentials = {}) => ({
        token: ensureNonEmpty(credentials.token, 'Discord bot token'),
        clientId: normalizeString(credentials.clientId),
        guildId: normalizeString(credentials.guildId),
    })

    return {
        async fetchResources(credentials = {}) {
            const {token, clientId, guildId} = resolveCredentials(credentials)

            return await withDiscordClient({token, guildId, logger, serviceName, createClient}, async (client) => {
                const [application, guildCollection] = await Promise.all([
                    client.fetchApplication?.().catch(() => null) ?? Promise.resolve(null),
                    client.fetchGuilds?.().catch(() => []) ?? Promise.resolve([]),
                ])

                const detectedClientId = normalizeString(application?.id ?? client?.client?.user?.id)
                const guilds = toArray(guildCollection)
                    .map(mapGuild)
                    .filter((entry) => Boolean(entry?.id))
                    .sort((left, right) => (left.name ?? '').localeCompare(right.name ?? ''))

                const resolvedGuildId = guildId || (guilds.length === 1 ? guilds[0].id ?? '' : '')
                const guild = resolvedGuildId
                    ? await client.fetchGuildById?.(resolvedGuildId)
                    : null

                let roles = []
                if (guild) {
                    try {
                        const fetchedRoles = guild.roles?.fetch ? await guild.roles.fetch() : guild.roles
                        roles = toArray(fetchedRoles).map(mapRole).filter(isUsableRole).sort(sortRoles)
                    } catch (error) {
                        logger?.error?.(
                            `[${serviceName}] Failed to load Discord roles: ${error instanceof Error ? error.message : error}`,
                        )
                        roles = []
                    }
                }

                let channels = []
                if (guild) {
                    try {
                        const fetchedChannels = guild.channels?.fetch ? await guild.channels.fetch() : guild.channels
                        channels = toArray(fetchedChannels).map(mapChannel).filter(isUsableChannel)
                    } catch (error) {
                        logger?.error?.(
                            `[${serviceName}] Failed to load Discord channels: ${error instanceof Error ? error.message : error}`,
                        )
                        channels = []
                    }
                }

                const summary = guild ? mapGuild(guild) : null
                const resourceSummary = summary
                    ? `[${serviceName}] Verified Discord guild ${summary.name || summary.id} with ${roles.length} roles and ${channels.length} channels`
                    : `[${serviceName}] Verified Discord bot login with ${guilds.length} accessible guild(s)`
                logger?.info?.(resourceSummary)

                return {
                    application: {
                        id: detectedClientId || null,
                        name: application?.name ?? null,
                        verified: Boolean(application),
                        providedClientId: clientId || null,
                        clientIdMatches: !clientId || clientId === detectedClientId,
                    },
                    botUser: {
                        id: client?.client?.user?.id ?? null,
                        username: client?.client?.user?.username ?? null,
                        tag: client?.client?.user?.tag ?? null,
                    },
                    guilds,
                    guild: summary,
                    roles,
                    channels,
                    suggested: {
                        clientId: detectedClientId || null,
                        guildId: resolvedGuildId || null,
                    },
                }
            })
        },

        async createRole(credentials = {}) {
            const {token, guildId} = resolveCredentials(credentials)
            const resolvedGuildId = ensureNonEmpty(guildId, 'Discord guild id')
            const name = ensureNonEmpty(credentials.name, 'Role name')

            return await withDiscordClient({
                token,
                guildId: resolvedGuildId,
                logger,
                serviceName,
                createClient
            }, async (client) => {
                const guild = await client.fetchGuild()
                if (!guild) {
                    throw new Error('Discord guild could not be retrieved.')
                }

                const role = await guild.roles?.create?.({
                    name,
                    reason: 'Requested during Noona setup',
                })

                if (!role) {
                    throw new Error('Discord did not return a newly created role.')
                }

                const mapped = mapRole(role)
                logger?.info?.(
                    `[${serviceName}] Created Discord role ${mapped.name || mapped.id} for guild ${resolvedGuildId}`,
                )
                return mapped
            })
        },

        async createChannel(credentials = {}) {
            const {token, guildId} = resolveCredentials(credentials)
            const resolvedGuildId = ensureNonEmpty(guildId, 'Discord guild id')
            const name = ensureNonEmpty(credentials.name, 'Channel name')
            const type = resolveChannelType(credentials.type)

            return await withDiscordClient({
                token,
                guildId: resolvedGuildId,
                logger,
                serviceName,
                createClient
            }, async (client) => {
                const guild = await client.fetchGuild()
                if (!guild) {
                    throw new Error('Discord guild could not be retrieved.')
                }

                const createOptions = {name, reason: 'Requested during Noona setup'}
                if (typeof type === 'number') {
                    createOptions.type = type
                }

                const channel = await guild.channels?.create?.(createOptions)

                if (!channel) {
                    throw new Error('Discord did not return a newly created channel.')
                }

                const mapped = mapChannel(channel)
                logger?.info?.(
                    `[${serviceName}] Created Discord channel ${mapped.name || mapped.id} for guild ${resolvedGuildId}`,
                )
                return mapped
            })
        },
    }
}

export default createDiscordSetupClient
