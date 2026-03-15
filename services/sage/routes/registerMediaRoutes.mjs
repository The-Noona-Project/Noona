import {createReadStream} from 'node:fs'
import {stat} from 'node:fs/promises'

const TRACK_FILE_URL = new URL('../assets/background-track.mp3', import.meta.url)
const TRACK_CONTENT_TYPE = 'audio/mpeg'
const TRACK_CACHE_CONTROL = 'private, no-store'

const normalizeString = (value) => (typeof value === 'string' ? value.trim() : '')

const parseRangeHeader = (value, size) => {
    const normalized = normalizeString(value)
    const match = /^bytes=(\d*)-(\d*)$/i.exec(normalized)
    if (!match) {
        return null
    }

    const rawStart = match[1]
    const rawEnd = match[2]
    if (!rawStart && !rawEnd) {
        return null
    }

    if (!rawStart) {
        const suffixLength = Number.parseInt(rawEnd, 10)
        if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
            return null
        }

        const clampedLength = Math.min(size, suffixLength)
        return {
            start: Math.max(0, size - clampedLength),
            end: Math.max(0, size - 1),
        }
    }

    const start = Number.parseInt(rawStart, 10)
    if (!Number.isInteger(start) || start < 0 || start >= size) {
        return null
    }

    if (!rawEnd) {
        return {start, end: size - 1}
    }

    const end = Number.parseInt(rawEnd, 10)
    if (!Number.isInteger(end) || end < start) {
        return null
    }

    return {
        start,
        end: Math.min(size - 1, end),
    }
}

const streamTrack = (res, options = {}) => {
    const stream = createReadStream(TRACK_FILE_URL, options)
    stream.on('error', () => {
        if (!res.headersSent) {
            res.status(500).json({error: 'Unable to stream background track.'})
            return
        }

        res.destroy()
    })
    stream.pipe(res)
}

export function registerMediaRoutes(context = {}) {
    const {
        app,
        logger,
        requireSessionIfSetupCompleted,
        serviceName,
    } = context

    app.use('/api/media', requireSessionIfSetupCompleted)

    app.get('/api/media/background-track', async (req, res) => {
        try {
            const {size} = await stat(TRACK_FILE_URL)
            const requestedRange = normalizeString(req.headers.range)

            res.setHeader('Accept-Ranges', 'bytes')
            res.setHeader('Cache-Control', TRACK_CACHE_CONTROL)
            res.setHeader('Content-Type', TRACK_CONTENT_TYPE)
            res.setHeader('Content-Disposition', 'inline; filename="background-track.mp3"')

            if (!requestedRange) {
                res.status(200)
                res.setHeader('Content-Length', size)
                streamTrack(res)
                return
            }

            const parsedRange = parseRangeHeader(requestedRange, size)
            if (!parsedRange) {
                res.setHeader('Content-Range', `bytes */${size}`)
                res.status(416).end()
                return
            }

            const {start, end} = parsedRange
            res.status(206)
            res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
            res.setHeader('Content-Length', end - start + 1)
            streamTrack(res, {start, end})
        } catch (error) {
            logger.error(`[${serviceName}] Failed to serve background track: ${error.message}`)
            res.status(503).json({error: 'Background track unavailable.'})
        }
    })
}
