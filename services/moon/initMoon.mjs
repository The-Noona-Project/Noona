// services/moon/initMoon.mjs
import express from 'express';

const app = express();
const PORT = process.env.PORT || 3000;
const TEST_BUTTON = process.env.TEST_BUTTON || 'Click me';

let clickCount = 0;

app.use(express.urlencoded({extended: true}));

// HTML page with button
app.get('/', (req, res) => {
    res.send(`
    <html lang="en">
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

// Handle button click
app.post('/click', (req, res) => {
    clickCount++;
    res.redirect('/');
});

app.listen(PORT, () => {
    console.log(`[moon] Server running at http://localhost:${PORT}`);
});
