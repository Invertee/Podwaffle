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
app.disable('x-powered-by');
app.set('trust proxy', true);

// CORS — allow all origins (self-hosted local network use)
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  next();
});

// JSON body parsing
app.use(express.json({ limit: '1mb' }));

// Request logging middleware
app.use((req, res, next) => {
  if (LOG_HTTP_REQUESTS) {
    console.log(`[http] ${req.method} ${req.url}`);
  }
  next();
});

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

  // Send initial cast device snapshot so newly-connected clients can render immediately
  try {
    const devices = castService.getDevices();
    ws.send(JSON.stringify({ type: 'cast:devices', data: devices }));

    const session = castService.getSession();
    if (session && (session.deviceId || session.activeDeviceId)) {
      ws.send(JSON.stringify({
        type: 'cast:status',
        data: {
          activeDeviceId: session.activeDeviceId || session.deviceId || null,
          deviceName: session.deviceName || null,
          ownerGuid: session.ownerGuid || null,
          mediaUrl: session.mediaUrl || null,
          episodeGuid: session.episodeGuid || null,
          title: session.title || null,
          podcastTitle: session.podcastTitle || null,
          imageUrl: session.imageUrl || null,
          position: session.position || 0,
          duration: session.duration || 0,
          volume: session.volume != null ? session.volume : 1,
          status: session.status || 'idle'
        }
      }));
    }
  } catch (err) {
    console.error('[ws] Failed to send initial cast snapshot:', err.message);
  }

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
      } else if (msg.type === 'cast:get_devices') {
        const devices = castService.getDevices();
        ws.send(JSON.stringify({ type: 'cast:devices', data: devices }));
      } else if (msg.type === 'cast:play') {
        castService.resume().catch(err => {
          console.error('[ws] cast:play failed:', err.message);
          broadcastWs({ type: 'cast:error', data: { error: err.message } });
        });
      } else if (msg.type === 'cast:pause') {
        castService.pause().catch(err => {
          console.error('[ws] cast:pause failed:', err.message);
          broadcastWs({ type: 'cast:error', data: { error: err.message } });
        });
      } else if (msg.type === 'cast:seek') {
        castService.seek(msg.position || 0).catch(err => {
          console.error('[ws] cast:seek failed:', err.message);
          broadcastWs({ type: 'cast:error', data: { error: err.message } });
        });
      } else if (msg.type === 'cast:setVolume') {
        castService.setVolume(msg.level || 0).catch(err => {
          console.error('[ws] cast:setVolume failed:', err.message);
          broadcastWs({ type: 'cast:error', data: { error: err.message } });
        });
      } else if (msg.type === 'cast:stop') {
        castService.stop().catch(err => {
          console.error('[ws] cast:stop failed:', err.message);
          broadcastWs({ type: 'cast:error', data: { error: err.message } });
        });
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

  // 2. Start the feed refresh scheduler
  console.log('[server] Starting feed refresh scheduler...');
  scheduler.startScheduler(feedService, userService, broadcastWs);

  // 2.5. Initialize cast discovery
  console.log('[server] Initializing Cast service discovery...');
  castService.init(broadcastWs);

  // 3. Run an initial feed refresh after a 5-second delay (let the server settle)
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
