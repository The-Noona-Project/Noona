// services/warden/initWarden.mjs

import Docker from 'dockerode'
import fetch from 'node-fetch'

import noonaDockers from './docker/noonaDockers.mjs'
import addonDockers from './docker/addonDockers.mjs'
import {debugMSG, errMSG, log, warn} from '../../utilities/etc/logger.mjs'
import {sendPage} from '../../utilities/dynamic/pages/sendPage.mjs'
import {generateSetupWizardHTML} from './newPage/setupWizard.mjs'

const docker = new Docker()
const networkName = 'noona-network'
const trackedContainers = new Set()
const DEBUG = process.env.DEBUG === 'true'

/**
 * Ensures the shared Docker network exists.
 */
async function ensureNetwork() {
    const networks = await docker.listNetworks()
    if (!networks.some(n => n.Name === networkName)) {
        log(`Creating Docker network: ${networkName}`)
        await docker.createNetwork({Name: networkName})
    }
}

/**
 * Connects Warden itself to the noona-network.
 */
async function attachSelfToNetwork() {
    const id = process.env.HOSTNAME
    const info = await docker.getContainer(id).inspect()
    const networks = info?.NetworkSettings?.Networks || {}

    if (!networks[networkName]) {
        log(`Attaching Warden to Docker network: ${networkName}`)
        await docker.getNetwork(networkName).connect({Container: id})
    }
}

/**
 * Pulls a container image if not already present.
 */
async function pullImageIfNeeded(image) {
    const images = await docker.listImages()
    const exists = images.some(i => i.RepoTags?.includes(image))

    if (exists) {
        debugMSG(`[initWarden] 🐳 Image already present: ${image}`)
        return
    }

    log(`Pulling image: ${image}`)
    await new Promise((resolve, reject) => {
        docker.pull(image, (err, stream) => {
            if (err) return reject(err)
            docker.modem.followProgress(stream, resolve, event => {
                if (event.status) process.stdout.write(`\r[warden] ${event.status} ${event.progress || ''}  `)
            })
        })
    })
    log(`\nPull complete for ${image}`)
}

/**
 * Runs a container based on the service definition.
 */
async function runContainer(service) {
    log(`Starting container: ${service.name}`)

    const binds = service.volumes || []
    const envVars = [...(service.env || []), `SERVICE_NAME=${service.name}`]

    // Handle special override for Moon (port 80 → 3000 on host)
    const isMoon = service.name === 'noona-moon'
    const exposed = isMoon ? {'80/tcp': {}} : service.exposed || {}
    const ports = isMoon
        ? {'80/tcp': [{HostPort: '3000'}]}
        : service.ports || {}

    const container = await docker.createContainer({
        name: service.name,
        Image: service.image,
        Env: envVars,
        ExposedPorts: exposed,
        HostConfig: {
            PortBindings: ports,
            Binds: binds.length ? binds : undefined
        },
        NetworkingConfig: {
            EndpointsConfig: {
                [networkName]: {}
            }
        }
    })

    trackedContainers.add(service.name)
    await container.start()

    const showLogs = service.name !== 'noona-redis' || DEBUG
    if (showLogs) {
        const logs = await container.logs({
            follow: true,
            stdout: true,
            stderr: true,
            tail: 10
        })
        logs.on('data', chunk => process.stdout.write(`[${service.name}] ${chunk.toString()}`))
    }

    log(`${service.name} is now running.`)
}

/**
 * Waits for a container's health endpoint to return 200 OK.
 */
async function waitForHealth(name, url, tries = 20, delay = 1000) {
    for (let i = 0; i < tries; i++) {
        try {
            const res = await fetch(url)
            if (res.ok) {
                debugMSG(`[initWarden] ✅ ${name} is healthy after ${i + 1} tries`)
                return
            }
        } catch {
        }
        process.stdout.write('.')
        await new Promise(r => setTimeout(r, delay))
    }
    throw new Error(`${name} did not become healthy in time`)
}

/**
 * Confirms Moon is serving pages from Redis.
 */
async function waitForTestPage() {
    const url = 'http://noona-moon:3000/dynamic/test'
    for (let i = 0; i < 20; i++) {
        try {
            const res = await fetch(url)
            if (res.ok) {
                debugMSG(`[initWarden] 🌕 test page is reachable`)
                return
            }
        } catch {
        }
        await new Promise(r => setTimeout(r, 1000))
        process.stdout.write('.')
    }
    throw new Error(`Test page did not load in time`)
}

/**
 * Pushes the Setup Wizard into Redis.
 */
async function registerSetupWizard() {
    const slugs = Object.keys(noonaDockers)
    log(`[initWarden] Registering setup wizard for: ${slugs.join(', ')}`)

    const html = generateSetupWizardHTML(slugs)
    const res = await sendPage('setupwizard', html)

    if (res.status !== 'ok') {
        throw new Error(`[initWarden] Failed to register setupwizard: ${res.error}`)
    }

    log(`[initWarden] Setup wizard registered successfully`)
}

/**
 * Stops and removes all tracked containers.
 */
async function shutdownAll() {
    warn(`Shutting down all containers...`)
    for (const name of trackedContainers) {
        try {
            const container = docker.getContainer(name)
            await container.stop()
            await container.remove()
            log(`Stopped & removed ${name}`)
        } catch (err) {
            warn(`Error stopping ${name}: ${err.message}`)
        }
    }
    process.exit(0)
}

process.on('SIGINT', shutdownAll)
process.on('SIGTERM', shutdownAll)

/**
 * Main boot sequence for Noona Warden.
 */
async function init() {
    await ensureNetwork()
    await attachSelfToNetwork()

    // 1. Redis (addon)
    const redis = addonDockers['noona-redis']
    if (!(await containerExists(redis.name))) {
        await pullImageIfNeeded(redis.image)
        await runContainer(redis)
    } else {
        log(`${redis.name} already running.`)
    }
    await waitForHealth(redis.name, 'http://noona-redis:8001/')

    // 2. Sage
    const sage = noonaDockers['noona-sage']
    if (!(await containerExists(sage.name))) {
        await pullImageIfNeeded(sage.image)
        await runContainer(sage)
    } else {
        log(`${sage.name} already running.`)
    }
    await waitForHealth('Sage', 'http://noona-sage:3004/health')

    // 3. Moon
    const moon = noonaDockers['noona-moon']
    if (!(await containerExists(moon.name))) {
        await pullImageIfNeeded(moon.image)
        await runContainer(moon)
    } else {
        log(`${moon.name} already running.`)
    }
    await waitForHealth('Moon', 'http://noona-moon:3000/')
    await waitForTestPage()

    // 4. Register Setup Wizard
    await registerSetupWizard()

    log(`🌕 Noona Warden is fully online. Press Ctrl+C to exit.`)
    setInterval(() => process.stdout.write('.'), 60_000)
}

/**
 * Utility: checks if a named container exists (any state).
 */
async function containerExists(name) {
    const list = await docker.listContainers({all: true})
    return list.some(c => c.Names.includes(`/${name}`))
}

init().catch(err => errMSG(`[initWarden] ❌ Fatal: ${err.message}`))
