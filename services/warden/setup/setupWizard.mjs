/**
 * Generates the HTML for the Noona Setup Wizard.
 * This is pushed into Redis and rendered by Moon.
 *
 * @param {string[]} slugs - List of service slugs (e.g. noona-moon)
 * @returns {string} - Full HTML document as string
 */
export function generateSetupWizardHTML(slugs = []) {
    const sorted = [...slugs]
        .filter(Boolean)
        .map((slug) => String(slug).trim())
        .filter((slug) => slug.length > 0)
        .sort((a, b) => a.localeCompare(b));

    const formatLabel = (slug) => {
        const cleaned = slug.replace(/^noona-/i, '');
        return cleaned
            .split(/[-_]/)
            .filter(Boolean)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ');
    };

    const options = sorted
        .map((slug) => `                <option value="${slug}">${formatLabel(slug)}</option>`)
        .join('\n');

    const hasServices = sorted.length > 0;

    const serviceForm = hasServices
        ? `
          <form id="service-form" class="service-form" method="get">
            <label class="field">
              <span class="field-label">Service</span>
              <select id="service-select" name="service" required>
                <option value="" disabled selected>Select a service…</option>
${options}
              </select>
            </label>
            <label id="docker-socket-field" class="field checkbox-field" hidden>
              <span class="checkbox-wrapper">
                <input type="checkbox" id="docker-socket-checkbox" name="dockerSocket" value="true" disabled />
                <span>Attach Docker socket</span>
              </span>
              <span class="field-help">Bind the host Docker socket so Warden can control containers.</span>
            </label>
            <button id="service-submit" type="submit" class="primary-button" disabled>Continue</button>
          </form>`
        : '          <p><em>No services registered.</em></p>';

    return /* html */`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Noona Setup Wizard</title>
        <style>
          :root {
            color-scheme: light;
          }

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
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
          }

          h1 {
            margin-top: 0;
            font-size: 1.8rem;
          }

          p {
            margin-bottom: 1.5rem;
          }

          .service-form {
            display: grid;
            gap: 1.25rem;
          }

          .field {
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
          }

          .field-label {
            font-weight: 600;
            color: #1f2933;
          }

          .service-form select {
            appearance: none;
            padding: 0.75rem 1rem;
            font-size: 1rem;
            border: 1px solid #cbd5e1;
            border-radius: 6px;
            background: #fff;
            transition: border-color 0.2s ease, box-shadow 0.2s ease;
          }

          .service-form select:focus {
            outline: none;
            border-color: #7c3aed;
            box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.15);
          }

          .checkbox-field {
            padding: 1rem;
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            background: #f8fafc;
            gap: 0.25rem;
          }

          .checkbox-wrapper {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            font-weight: 600;
            color: #1f2933;
          }

          .checkbox-wrapper input[type='checkbox'] {
            width: 1.1rem;
            height: 1.1rem;
          }

          .field-help {
            font-size: 0.875rem;
            color: #475569;
          }

          .primary-button {
            align-self: flex-start;
            padding: 0.75rem 1.5rem;
            font-size: 1rem;
            font-weight: 600;
            color: white;
            background: linear-gradient(135deg, #7c3aed, #5b21b6);
            border: none;
            border-radius: 6px;
            cursor: pointer;
            transition: transform 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease;
          }

          .primary-button:disabled {
            cursor: not-allowed;
            opacity: 0.6;
            box-shadow: none;
          }

          .primary-button:not(:disabled):hover {
            transform: translateY(-1px);
            box-shadow: 0 8px 16px rgba(124, 58, 237, 0.25);
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
${serviceForm}
        </main>
        <footer>
          Powered by Warden · ${new Date().toLocaleDateString()}
        </footer>
        <script>
          document.addEventListener('DOMContentLoaded', () => {
            const form = document.getElementById('service-form');
            const select = document.getElementById('service-select');
            const submit = document.getElementById('service-submit');
            const dockerField = document.getElementById('docker-socket-field');
            const dockerCheckbox = document.getElementById('docker-socket-checkbox');

            if (!select || !form || !submit) {
              return;
            }

            const updateState = () => {
              const value = select.value;
              const hasValue = Boolean(value);

              if (hasValue) {
                form.setAttribute('action', `/dynamic/${encodeURIComponent(value)}`);
              } else {
                form.removeAttribute('action');
              }

              submit.disabled = !hasValue;

              if (dockerField && dockerCheckbox) {
                const isWarden = value === 'noona-warden' || value === 'warden';
                dockerField.hidden = !isWarden;
                dockerCheckbox.disabled = !isWarden;
                if (!isWarden) {
                  dockerCheckbox.checked = false;
                }
              }
            };

            select.addEventListener('change', updateState);
            updateState();

            form.addEventListener('submit', (event) => {
              if (!select.value) {
                event.preventDefault();
                select.focus();
              }
            });
          });
        </script>
      </body>
    </html>
  `;
}
