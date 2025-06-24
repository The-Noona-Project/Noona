// services/warden/newPage/setupWizard.mjs

/**
 * Generates an HTML document for the Noona Setup Wizard page.
 * This page provides a list of buttons linking to available service setup routes.
 *
 * @param {string[]} slugs - A list of service slugs to render buttons for
 * @returns {string} A full HTML document as a string
 */
export function generateSetupWizardHTML(slugs = []) {
    const buttons = slugs.map(slug => `
    <form action="/dynamic/${slug}" method="get">
      <button type="submit" style="padding: 0.5em 1em; font-size: 1rem;">
        ${slug}
      </button>
    </form>
  `).join('<br>')

    return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Noona Setup Wizard</title>
        <style>
          body {
            font-family: sans-serif;
            max-width: 600px;
            margin: 2em auto;
            padding: 1em;
            background: #f0f0f0;
            color: #222;
            border-radius: 8px;
          }
          h1 {
            margin-top: 0;
          }
          footer {
            margin-top: 2em;
            font-size: 0.8em;
            color: #666;
          }
        </style>
      </head>
      <body>
        <h1>🧙 Noona Setup Wizard</h1>
        <p>Select a service below to configure it:</p>
        ${buttons || '<p><i>No services available.</i></p>'}
        <hr />
        <footer><small>Powered by Warden</small></footer>
      </body>
    </html>
  `
}
