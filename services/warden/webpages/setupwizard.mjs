/**
 * Generates the HTML for the Noona setup wizard page.
 * @param {string[]} services - List of service names
 * @returns {string} Raw HTML page
 */
export function generateSetupWizardHTML(services) {
    return `
    <html lang="en">
      <head><title>Noona Setup Wizard</title></head>
      <body>
        <h1>Noona Setup Wizard</h1>
        <p>Select the services you want to install:</p>
        <form method="POST" action="/api/install-services">
          ${services.map(s => `
            <label>
              <input type="checkbox" name="services" value="${s}"> ${s}
            </label><br>`).join('')}
          <br>
          <button type="submit">Install</button>
        </form>
      </body>
    </html>`;
}
