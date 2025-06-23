// setupwizard.mjs
export function generateSetupWizardHTML(slugs = []) {
    const buttons = slugs.map(slug => `
        <form action="/dynamic/${slug}" method="get">
          <button type="submit">${slug}</button>
        </form>
    `).join('<br>');

    return `
        <html lang="en">
          <head><title>Setup Wizard</title></head>
          <body>
            <h1>Setup Wizard</h1>
            <p>Select a service to configure:</p>
            ${buttons || '<p>No services available.</p>'}
          </body>
        </html>
    `;
}
