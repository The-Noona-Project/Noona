/**
 * Generates the HTML for the Noona Setup Wizard.
 * This is pushed into Redis and rendered by Moon.
 *
 * @param {string[]} slugs - List of service slugs (e.g. noona-moon)
 * @returns {string} - Full HTML document as string
 */
export function generateSetupWizardHTML(slugs = []) {
    // Sort and generate buttons
    const sorted = [...slugs].sort()
    const buttons = sorted.map(slug => `
    <form action="/dynamic/${slug}" method="get">
      <button type="submit" class="service-button">
        ${slug}
      </button>
    </form>
  `).join('')

    return /* html */`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Noona Setup Wizard</title>
        <style>
          body {
            font-family: system-ui, sans-serif;
            background: #f9f9f9;
            margin: 0;
            padding: 2em;
            color: #333;
          }

          main {
            max-width: 600px;
            margin: 2em auto;
            padding: 2em;
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.05);
          }

          h1 {
            margin-top: 0;
            font-size: 1.8rem;
          }

          p {
            margin-bottom: 1.5rem;
          }

          .service-button {
            display: block;
            width: 100%;
            margin: 0.5em 0;
            padding: 0.75em 1em;
            font-size: 1rem;
            background: #1976d2;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            transition: background 0.2s ease;
          }

          .service-button:hover {
            background: #1565c0;
          }

          footer {
            text-align: center;
            margin-top: 2em;
            font-size: 0.85em;
            color: #777;
          }
        </style>
      </head>
      <body>
        <main>
          <h1>🧙 Noona Setup Wizard</h1>
          <p>Select a service to configure:</p>
          ${buttons || '<p><em>No services registered.</em></p>'}
        </main>
        <footer>
          Powered by Warden · ${new Date().toLocaleDateString()}
        </footer>
      </body>
    </html>
  `
}
