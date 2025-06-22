// services/moon/webpages/testpage.mjs
import {getPages} from '../../../utilities/dynamic/pages/getPages.mjs';
import {debugMSG, log} from '../../../utilities/logger.mjs';

let clickCount = 0;

/**
 * Registers the test page into the page list — but doesn't write a static file.
 */
export async function registerTestPage(buttonLabel) {
    const existing = await getPages();
    if (!existing.includes('test')) {
        log(`Test page 'test' is now accessible at /dynamic/test`);
    } else {
        debugMSG(`Test page already registered`);
    }
}

/**
 * Renders test page dynamically with current click count.
 */
export function renderTestPage(req, res) {
    res.send(`
    <html lang="en">
      <body>
        <h1>Demo Test Page</h1>
        <form method="POST" action="/click">
          <button type="submit">${process.env.TEST_BUTTON || 'Click me'}</button>
        </form>
        <p>Button clicked: ${clickCount} times</p>
      </body>
    </html>
  `);
}

/**
 * Increments the click count.
 */
export function handleClick(req, res) {
    clickCount++;
    res.redirect('/dynamic/test');
}
