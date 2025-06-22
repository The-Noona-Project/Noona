import express from 'express';
import fs from 'fs-extra';
import path from 'path';
import {fileURLToPath} from 'url';

const app = express();
const PORT = process.env.PORT || 3000;
const TEST_BUTTON = process.env.TEST_BUTTON || 'Click me';

let clickCount = 0;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DYNAMIC_PAGE_DIR = path.join(__dirname, 'dynamic-pages');

fs.ensureDirSync(DYNAMIC_PAGE_DIR);

app.use(express.urlencoded({extended: true}));
app.use(express.json());

/**
 * Root demo page with click counter.
 */
app.get('/', (req, res) => {
    res.send(`
    <html lang="en">
      <head><title>Moon</title></head>
      <body>
        <h1>Hello, world from Moon!</h1>
        <form method="POST" action="/click">
          <button type="submit">${TEST_BUTTON}</button>
        </form>
        <p>Button clicked: ${clickCount} times</p>
      </body>
    </html>
  `);
});

app.post('/click', (req, res) => {
    clickCount++;
    res.redirect('/');
});

/**
 * Registers a new HTML page at /dynamic/:slug
 * @route POST /api/register-page
 * @bodyParam {string} route
 * @bodyParam {string} html
 */
app.post('/api/register-page', async (req, res) => {
    const {route, html} = req.body;

    if (!route || !html || typeof route !== 'string' || typeof html !== 'string') {
        return res.status(400).json({status: 'error', error: 'Invalid pagePacket format'});
    }

    const safeSlug = route.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!safeSlug) {
        return res.status(400).json({status: 'error', error: 'Invalid route value'});
    }

    const filePath = path.join(DYNAMIC_PAGE_DIR, `${safeSlug}.html`);
    try {
        await fs.writeFile(filePath, html, 'utf8');
        res.status(200).json({status: 'ok', slug: safeSlug});
    } catch (err) {
        console.error('[moon] Error writing page:', err);
        res.status(500).json({status: 'error', error: 'Failed to write page'});
    }
});

/**
 * Lists all registered page slugs.
 * @route GET /api/pages
 */
app.get('/api/pages', async (req, res) => {
    try {
        const files = await fs.readdir(DYNAMIC_PAGE_DIR);
        const pages = files
            .filter(f => f.endsWith('.html'))
            .map(f => f.replace(/\.html$/, ''));

        res.json({status: 'ok', pages});
    } catch (err) {
        console.error('[moon] Error listing pages:', err);
        res.status(500).json({status: 'error', error: 'Failed to list pages'});
    }
});

/**
 * Deletes a registered page by slug.
 * @route DELETE /api/page/:slug
 */
app.delete('/api/page/:slug', async (req, res) => {
    const slug = req.params.slug.replace(/[^a-zA-Z0-9_-]/g, '');
    const filePath = path.join(DYNAMIC_PAGE_DIR, `${slug}.html`);

    try {
        if (await fs.pathExists(filePath)) {
            await fs.remove(filePath);
            res.json({status: 'ok', removed: slug});
        } else {
            res.status(404).json({status: 'error', error: 'Page not found'});
        }
    } catch (err) {
        console.error('[moon] Error deleting page:', err);
        res.status(500).json({status: 'error', error: 'Failed to delete page'});
    }
});

/**
 * Serves dynamic pages from disk.
 */
app.get('/dynamic/:slug', async (req, res) => {
    const slug = req.params.slug.replace(/[^a-zA-Z0-9_-]/g, '');
    const filePath = path.join(DYNAMIC_PAGE_DIR, `${slug}.html`);

    if (await fs.pathExists(filePath)) {
        res.sendFile(filePath);
    } else {
        res.status(404).send(`<h1>404 - Page '${slug}' not found.</h1>`);
    }
});

app.listen(PORT, () => {
    console.log(`[moon] Server running at http://localhost:${PORT}`);
});
