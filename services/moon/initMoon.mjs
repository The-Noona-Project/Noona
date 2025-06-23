// services/moon/initMoon.mjs
import express from 'express';
import fs from 'fs-extra';
import path from 'path';
import {fileURLToPath} from 'url';

import redis from '../../utilities/redisClient.mjs';
import {debugMSG, errMSG, log, warn} from '../../utilities/logger.mjs';
import {getReply, replyPage} from '../../utilities/dynamic/pages/replyPage.mjs';
import {handleClick, registerTestPage, renderTestPage} from './webpages/testpage.mjs';

const app = express();
const PORT = process.env.PORT || 3000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DYNAMIC_PAGE_DIR = path.join(__dirname, 'dynamic-pages');

fs.ensureDirSync(DYNAMIC_PAGE_DIR);

app.use(express.urlencoded({extended: true}));
app.use(express.json());

/**
 * Home: lists dynamic pages from disk.
 */
app.get('/', async (req, res) => {
    try {
        const files = await fs.readdir(DYNAMIC_PAGE_DIR);
        let slugs = files
            .filter(name => name.endsWith('.html'))
            .map(name => name.replace(/\.html$/, ''));

        debugMSG(`[initMoon] Found slugs on disk: ${slugs.join(', ')}`);

        if (!slugs.includes('test')) slugs.unshift('test');

        const buttons = slugs.map(slug => `
            <form action="/dynamic/${slug}" method="get">
              <button type="submit">${slug}</button>
            </form>
        `).join('<br>');

        res.send(`
            <html>
              <head><title>Moon Page Index</title></head>
              <body>
                <h1>Available Pages</h1>
                ${buttons || '<p>No pages registered.</p>'}
              </body>
            </html>
        `);
    } catch (err) {
        errMSG(`[initMoon] Failed to load index: ${err.message}`);
        res.status(500).send('<h1>500 - Internal Error</h1>');
    }
});

app.post('/click', handleClick);

/**
 * Serve dynamic page content from disk.
 */
app.get('/dynamic/:slug', async (req, res) => {
    const safeSlug = req.params.slug.replace(/[^a-zA-Z0-9_-]/g, '');

    if (safeSlug === 'test') return renderTestPage(req, res);

    const filePath = path.join(DYNAMIC_PAGE_DIR, `${safeSlug}.html`);
    if (await fs.pathExists(filePath)) {
        debugMSG(`[initMoon] Serving /dynamic/${safeSlug} from disk`);
        res.sendFile(filePath);
    } else {
        res.status(404).send(`<h1>404 - Page '${safeSlug}' not found.</h1>`);
    }
});

/**
 * Lists all registered slugs from Redis (optional usage).
 */
app.get('/api/pages', async (req, res) => {
    try {
        const slugs = await redis.smembers('noona:pages');
        debugMSG(`[initMoon] /api/pages responding with: ${slugs.join(', ')}`);
        res.json({status: 'ok', pages: slugs});
    } catch (err) {
        errMSG(`[initMoon] Failed to get pages: ${err.message}`);
        res.status(500).json({status: 'error', error: err.message});
    }
});

app.delete('/api/page/:slug', async (req, res) => {
    const result = await replyPage(req.params.slug);
    res.status(result.status === 'ok' ? 200 : 404).json(result);
});

app.post('/api/page-reply/:slug', async (req, res) => {
    const result = await replyPage(req.params.slug, req.body);
    res.status(result.status === 'ok' ? 200 : 500).json(result);
});

app.get('/api/page-reply/:slug', async (req, res) => {
    const result = await getReply(req.params.slug);
    res.status(result.status === 'ok' || result.status === 'waiting' ? 200 : 404).json(result);
});

/**
 * Redis listener: watches for pagePackets and saves to disk + Redis set
 */
async function listenForPagePackets() {
    while (true) {
        try {
            const result = await redis.blpop('noona:pagePackets', 0);
            const json = JSON.parse(result[1]);

            if (json?.type === 'pagePacket' && json.slug && json.html) {
                const safeSlug = json.slug.replace(/[^a-zA-Z0-9_-]/g, '');
                const filePath = path.join(DYNAMIC_PAGE_DIR, `${safeSlug}.html`);
                await fs.writeFile(filePath, json.html, 'utf-8');
                await redis.sadd('noona:pages', safeSlug);
                debugMSG(`[initMoon] Registered '${safeSlug}' from Redis to disk`);
            } else {
                warn(`[initMoon] Ignored invalid packet: ${JSON.stringify(json)}`);
            }
        } catch (err) {
            errMSG(`[initMoon] Redis packet error: ${err.message}`);
        }
    }
}

/**
 * Start the server and begin Redis listener.
 */
app.listen(PORT, async () => {
    log(`Server running at http://localhost:${PORT}`);

    try {
        await registerTestPage(process.env.TEST_BUTTON || 'Click me');
    } catch (err) {
        errMSG(`[initMoon] Failed to register test page: ${err.message}`);
    }

    listenForPagePackets(); // run Redis listener in background
});
