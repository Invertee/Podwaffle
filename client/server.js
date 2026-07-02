const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4000;

function getSafeUrl(rawUrl) {
  const value = String(rawUrl || '').trim();
  if (!value) return null;

  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return null;
    }
    return parsed;
  } catch (_) {
    return null;
  }
}

// Middleware
app.use(express.json());

app.get('/proxy/feed', async (req, res) => {
  const targetUrl = getSafeUrl(req.query.url);
  if (!targetUrl) {
    return res.status(400).json({ error: 'A valid http/https feed url is required.' });
  }

  try {
    const response = await fetch(targetUrl.toString(), {
      headers: {
        'Accept': 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
        'User-Agent': 'PodWaffle Local Client/1.0',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `Feed request failed with HTTP ${response.status}` });
    }

    const text = await response.text();
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/xml; charset=utf-8');
    res.send(text);
  } catch (error) {
    console.error('[client-server] Feed proxy failed:', error.message);
    res.status(502).json({ error: 'Failed to fetch feed', details: error.message });
  }
});

app.use(express.static(path.join(__dirname)));

// Serve index.html for all non-static routes (SPA routing)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Catch-all for SPA routing
app.get('*', (req, res) => {
  // Check if it's a file request (has extension)
  if (req.path.includes('.')) {
    res.status(404).send('Not found');
  } else {
    res.sendFile(path.join(__dirname, 'index.html'));
  }
});

app.listen(PORT, () => {
  console.log(`PodWaffle client running at http://localhost:${PORT}`);
  console.log(`App is fully self-contained and works offline.`);
  console.log(`To enable backend sync: Settings → Backend Server`);
});


