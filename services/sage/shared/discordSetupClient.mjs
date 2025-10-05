// services/sage/shared/discordSetupClient.mjs

import createDiscordClient from '../../portal/shared/discordClient.mjs'
import { SetupValidationError } from './errors.mjs'

const normalizeString = (value) => {
    if (typeof value !== 'string') {
        return ''
    }

    const trimmed = value.trim()
    return trimmed
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

const withDiscordClient = async ({ token, guildId, logger, serviceName }, handler) => {
    const discordClient = createDiscordClient({
        token,
        guildId,
        commands: new Map(),
    })

    try {
        await discordClient.login()
        return await handler(discordClient)
    } finally {
        try {
            discordClient.destroy?.()
        } catch (error) {
            logger?.error?.(
                `[${serviceName}] ⚠️ Failed to clean up Discord client: ${error instanceof Error ? error.message : error}`,
            )
        }
    }
}

export const createDiscordSetupClient = ({ logger, serviceName = 'noona-sage' } = {}) => {
    const resolveCredentials = (credentials = {}) => ({
        token: ensureNonEmpty(credentials.token, 'Discord bot token'),
        guildId: ensureNonEmpty(credentials.guildId, 'Discord guild id'),
    })

    return {
        async fetchResources(credentials = {}) {
            const { token, guildId } = resolveCredentials(credentials)

            return await withDiscordClient({ token, guildId, logger, serviceName }, async (client) => {
                const guild = await client.fetchGuild()
                if (!guild) {
                    throw new Error('Discord guild could not be retrieved.')
                }

                let roles = []
                try {
                    const fetchedRoles = guild.roles?.fetch ? await guild.roles.fetch() : guild.roles
                    roles = toArray(fetchedRoles).map(mapRole).filter(isUsableRole).sort(sortRoles)
                } catch (error) {
                    logger?.error?.(
                        `[${serviceName}] ⚠️ Failed to load Discord roles: ${error instanceof Error ? error.message : error}`,
                    )
                    roles = []
                }

                let channels = []
                try {
                    const fetchedChannels = guild.channels?.fetch ? await guild.channels.fetch() : guild.channels
                    channels = toArray(fetchedChannels).map(mapChannel).filter(isUsableChannel)
                } catch (error) {
                    logger?.error?.(
                        `[${serviceName}] ⚠️ Failed to load Discord channels: ${error instanceof Error ? error.message : error}`,
                    )
                    channels = []
                }

                const summary = {
                    id: guild.id ?? guildId,
                    name: guild.name ?? null,
                    description: guild.description ?? null,
                    icon: guild.icon ?? null,
                }

                const resourceSummary =
                    `[${serviceName}] 🤖 Verified Discord guild ${summary.name || summary.id} with ${roles.length} roles and ${channels.length} channels`
                logger?.info?.(resourceSummary)

                return { guild: summary, roles, channels }
            })
        },

        async createRole(credentials = {}) {
            const { token, guildId } = resolveCredentials(credentials)
            const name = ensureNonEmpty(credentials.name, 'Role name')

            return await withDiscordClient({ token, guildId, logger, serviceName }, async (client) => {
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
                    `[${serviceName}] 🎨 Created Discord role ${mapped.name || mapped.id} for guild ${guildId}`,
                )
                return mapped
            })
        },

        async createChannel(credentials = {}) {
            const { token, guildId } = resolveCredentials(credentials)
            const name = ensureNonEmpty(credentials.name, 'Channel name')
            const type = normalizeString(credentials.type) || null

            return await withDiscordClient({ token, guildId, logger, serviceName }, async (client) => {
                const guild = await client.fetchGuild()
                if (!guild) {
                    throw new Error('Discord guild could not be retrieved.')
                }

                const createOptions = { name, reason: 'Requested during Noona setup' }
                if (type) {
                    createOptions.type = type
                }

                const channel = await guild.channels?.create?.(createOptions)

                if (!channel) {
                    throw new Error('Discord did not return a newly created channel.')
                }

                const mapped = mapChannel(channel)
                logger?.info?.(
                    `[${serviceName}] 📢 Created Discord channel ${mapped.name || mapped.id} for guild ${guildId}`,
                )
                return mapped
            })
        },
    }
}

export default createDiscordSetupClient
