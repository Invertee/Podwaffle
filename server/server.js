'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');

const express = require('express');
const cors = require('cors');
const { WebSocketServer, WebSocket } = require('ws');

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------
const feedService = require('./services/feedService');
const userService = require('./services/userService');
const castService = require('./services/castService');
const scheduler = require('./services/scheduler');

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
const createApiRouter = require('./routes/api');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const CLIENT_DIR = path.join(__dirname, '..', 'client');
const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_DIR = path.join(DATA_DIR, 'users');
const PODCASTS_DIR = path.join(DATA_DIR, 'podcasts');
const LOG_HTTP_REQUESTS = false;
const DISABLE_NEW_USER_SESSIONS = String(process.env.DISABLE_NEW_USER_SESSIONS || '').toLowerCase() === 'true';

// ---------------------------------------------------------------------------
// Startup banner
// ---------------------------------------------------------------------------
function printBanner() {
  console.log('');
  console.log('  ██████╗  ██████╗ ██████╗ ██╗    ██╗ █████╗ ███████╗███████╗██╗     ███████╗');
  console.log('  ██╔══██╗██╔═══██╗██╔══██╗██║    ██║██╔══██╗██╔════╝██╔════╝██║     ██╔════╝');
  console.log('  ██████╔╝██║   ██║██║  ██║██║ █╗ ██║███████║█████╗  █████╗  ██║     █████╗  ');
  console.log('  ██╔═══╝ ██║   ██║██║  ██║██║███╗██║██╔══██║██╔══╝  ██╔══╝  ██║     ██╔══╝  ');
  console.log('  ██║     ╚██████╔╝██████╔╝╚███╔███╔╝██║  ██║██║     ██║     ███████╗███████╗');
  console.log('  ╚═╝      ╚═════╝ ╚═════╝  ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝     ╚═╝     ╚══════╝╚══════╝');
  console.log('');
  console.log('  🎙️  Podwaffle Server — Self-hosted podcast app');
  console.log(`  📡  Port      : ${PORT}`);
  console.log(`  📂  Data dir  : ${DATA_DIR}`);
  console.log(`  🌐  Client dir: ${CLIENT_DIR}`);
  console.log(`  🔐  New user sessions disabled: ${DISABLE_NEW_USER_SESSIONS ? 'yes' : 'no'}`);
  console.log('');
}

// ---------------------------------------------------------------------------
// Ensure data directories exist
// ---------------------------------------------------------------------------
async function ensureDirectories() {
  try {
    await fs.promises.mkdir(USERS_DIR, { recursive: true });
    console.log(`[server] Users directory ensured: ${USERS_DIR}`);
  } catch (err) {
    console.error('[server] Failed to create users directory:', err);
  }
  try {
    await fs.promises.mkdir(PODCASTS_DIR, { recursive: true });
    console.log(`[server] Podcasts directory ensured: ${PODCASTS_DIR}`);
  } catch (err) {
    console.error('[server] Failed to create podcasts directory:', err);
  }
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------
const app = express();

// CORS — allow all origins (self-hosted local network use)
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// JSON body parsing
app.use(express.json({ limit: '1mb' }));

// Request logging middleware
app.use((req, res, next) => {
  if (LOG_HTTP_REQUESTS) {
    console.log(`[http] ${req.method} ${req.url}`);
  }
  next();
});

// Static files from client directory (if it exists)
app.use(express.static(CLIENT_DIR));

// ---------------------------------------------------------------------------
// HTTP server & WebSocket server
// ---------------------------------------------------------------------------
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ---------------------------------------------------------------------------
// WebSocket broadcast helper
// ---------------------------------------------------------------------------
/**
 * Send a message object to all currently connected WebSocket clients.
 * @param {Object} msgObj
 */
function broadcastWs(msgObj) {
  const payload = JSON.stringify(msgObj);
  let sent = 0;
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
      sent++;
    }
  });
  if (sent > 0) {
    console.log(`[ws] Broadcast to ${sent} client(s): type=${msgObj.type}`);
  }
}

// ---------------------------------------------------------------------------
// WebSocket connection handler
// ---------------------------------------------------------------------------
wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress || 'unknown';
  console.log(`[ws] Client connected from ${clientIp}. Total clients: ${wss.clients.size}`);

  // Send welcome ping
  ws.send(JSON.stringify({ type: 'ping', data: { message: 'Welcome to Podwaffle' } }));

  // Ping/pong keepalive
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
    console.log(`[ws] Pong received from ${clientIp}`);
  });

  // Handle incoming messages
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      console.log(`[ws] Message from ${clientIp}:`, msg);

      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
    } catch (err) {
      console.error(`[ws] Failed to parse message from ${clientIp}:`, err.message);
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`[ws] Client disconnected from ${clientIp} (code=${code}). Remaining clients: ${wss.clients.size}`);
  });

  ws.on('error', (err) => {
    console.error(`[ws] Error from client ${clientIp}:`, err.message);
  });
});

// Heartbeat interval — close stale connections every 30s
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.isAlive === false) {
      console.log('[ws] Terminating stale client (no pong received)');
      ws.terminate();
      return;
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
  console.log('[ws] WebSocket server closed');
});

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------
app.use('/api', createApiRouter(feedService, userService, castService, broadcastWs, {
  disableNewUserSessions: DISABLE_NEW_USER_SESSIONS
}));

// ---------------------------------------------------------------------------
// SPA catch-all — serve index.html for all non-API routes
// ---------------------------------------------------------------------------
app.get('*', (req, res) => {
  const indexPath = path.join(CLIENT_DIR, 'index.html');
  console.log(`[http] SPA catch-all → serving ${indexPath}`);
  fs.access(indexPath, fs.constants.F_OK, (err) => {
    if (err) {
      res.status(200).json({
        service: 'Podwaffle Server',
        version: '1.0.0',
        status: 'running',
        message: 'Client files not found. Place your client build in the ../client/ directory.'
      });
    } else {
      res.sendFile(indexPath);
    }
  });
});

// ---------------------------------------------------------------------------
// Uncaught exception / rejection handlers
// ---------------------------------------------------------------------------
process.on('uncaughtException', (err) => {
  console.error('[server] UNCAUGHT EXCEPTION:', err);
  console.error(err.stack);
  // Don't exit — keep the server running
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[server] UNHANDLED REJECTION at:', promise, 'reason:', reason);
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
process.on('SIGTERM', () => {
  console.log('[server] SIGTERM received → shutting down gracefully');
  server.close(() => {
    console.log('[server] HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\n[server] SIGINT received → shutting down gracefully');
  server.close(() => {
    console.log('[server] HTTP server closed');
    process.exit(0);
  });
});

// ---------------------------------------------------------------------------
// Startup sequence
// ---------------------------------------------------------------------------
async function start() {
  printBanner();

  // 1. Ensure all data directories exist
  await ensureDirectories();

  // 2. Start Google Cast device discovery
  console.log('[server] Starting Google Cast mDNS discovery...');
  const _onCastDeviceFound = (device) => {
    console.log(`[server] Cast device found: "${device.name}" @ ${device.host}`);
    broadcastWs({ type: 'cast:device_found', data: device });
  };
  const _onCastDeviceLost = (deviceId) => {
    console.log(`[server] Cast device lost: ${deviceId}`);
    broadcastWs({ type: 'cast:device_lost', data: { deviceId } });
  };
  try {
    castService.startDiscovery(_onCastDeviceFound, _onCastDeviceLost);
  } catch (err) {
    console.error('[server] Cast discovery failed to start (non-fatal):', err.message);
  }

  // Restart mDNS discovery every 3 hours to pick up newly-added or renamed devices
  setInterval(() => {
    console.log('[server] Periodic cast device discovery refresh (3 h interval)...');
    try {
      castService.restartDiscovery(_onCastDeviceFound, _onCastDeviceLost);
    } catch (err) {
      console.error('[server] Cast discovery refresh failed (non-fatal):', err.message);
    }
  }, 3 * 60 * 60 * 1000);

  // 3. Start the feed refresh scheduler
  console.log('[server] Starting feed refresh scheduler...');
  scheduler.startScheduler(feedService, userService, broadcastWs);

  // 4. Run an initial feed refresh after a 5-second delay (let the server settle)
  setTimeout(async () => {
    console.log('[server] Running initial feed refresh...');
    try {
      await scheduler.runImmediately(feedService, userService, broadcastWs);
    } catch (err) {
      console.error('[server] Initial feed refresh failed (non-fatal):', err.message);
    }
  }, 5000);

  // 5. Start listening
  server.listen(PORT, () => {
    console.log(`\n[server] ✅ Podwaffle is running at http://localhost:${PORT}`);
    console.log(`[server] 🔌 WebSocket available at ws://localhost:${PORT}`);
    console.log(`[server] 📡 API available at http://localhost:${PORT}/api`);
    console.log('');
  });
}

// Kick off startup
start().catch(err => {
  console.error('[server] Fatal startup error:', err);
  process.exit(1);
});
