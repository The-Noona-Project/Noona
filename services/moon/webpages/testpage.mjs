// services/moon/webpages/testpage.mjs
import {debugMSG} from '../../../utilities/logger.mjs';
import {sendPage} from '../../../utilities/dynamic/pages/sendPage.mjs';

let clickCount = 0;

export async function registerTestPage(label) {
    const html = `
        <html>
          <head><title>Test Page</title></head>
          <body>
            <h1>This is a test page</h1>
            <form method="post" action="/click">
              <button type="submit">${label}</button>
            </form>
          </body>
        </html>
    `;
    const res = await sendPage('test', html);
    if (res.status === 'ok') {
        debugMSG(`Test page registered as 'test'`);
    } else {
        throw new Error(res.error);
    }
    return res;
}

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

export function handleClick(req, res) {
    clickCount++;
    res.redirect('/dynamic/test');
}
