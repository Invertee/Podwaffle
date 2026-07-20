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
const realtimeSync = require('./services/realtimeSyncService');
const pushService = require('./services/pushService');
const authService = require('./services/authService');
const profileRegistry = require('./services/profileRegistry');
const diagnostics = require('./services/diagnosticsService');

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
const createApiRouter = require('./routes/api');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const USERS_DIR = path.join(DATA_DIR, 'users');
const PODCASTS_DIR = path.join(DATA_DIR, 'podcasts');
const LOG_HTTP_REQUESTS = false;

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
  console.log(`  👥  Profiles  : ${profileRegistry.list().map((profile) => `${profile.name} (${profile.id})`).join(', ')}`);
  console.log(`  🔑  Access key: ${authService.isRequired() ? 'required' : 'not configured'}`);
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
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Podwaffle-Key', 'X-Podwaffle-Client']
}));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
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
  const mutatesSyncState = msgObj.type === 'feeds:updated' || msgObj.type.startsWith('user:');
  const stamped = realtimeSync.stamp(msgObj, mutatesSyncState);
  const payload = JSON.stringify(stamped);
  const targetGuid = stamped && stamped.data && stamped.data.guid ? String(stamped.data.guid) : null;
  const targetClientId = stamped?.data?.targetClientId ? String(stamped.data.targetClientId) : null;
  let sent = 0;
  wss.clients.forEach(client => {
    const profileMatches = !targetGuid || client.guid === targetGuid;
    const clientMatches = !targetClientId || client.clientId === targetClientId;
    if (client.authenticated && client.readyState === WebSocket.OPEN && profileMatches && clientMatches) {
      client.send(payload);
      sent++;
    }
  });
  if (sent > 0) {
    console.log(`[ws] Broadcast to ${sent} client(s): type=${msgObj.type}`);
  }
  if (targetGuid && mutatesSyncState) {
    pushService.notifySyncChanged(targetGuid, stamped.sync, msgObj.type);
  }
}

async function sendUserSyncState(ws, guid) {
  const bootstrap = await userService.getBootstrapSyncState(guid);
  const subscriptions = bootstrap?.snapshot?.subscriptions || [];
  const feeds = await feedService.getCachedFeedsByUrls(subscriptions);
  ws.send(JSON.stringify(realtimeSync.stamp({
    type: 'sync:state',
    data: { guid, ...bootstrap, feeds },
  }, false)));
}

function sendInitialRealtimeState(ws) {
  const devices = castService.getDevices();
  ws.send(JSON.stringify({ type: 'cast:devices', data: devices }));
  const session = castService.getSession();
  if (!session || !(session.deviceId || session.activeDeviceId)) return;
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
      status: session.status || 'idle',
    },
  }));
}

// ---------------------------------------------------------------------------
// WebSocket connection handler
// ---------------------------------------------------------------------------
wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress || 'unknown';
  ws.authenticated = !authService.isRequired();
  ws.socketId = diagnostics.connect('', { remoteAddress: clientIp, authenticated: ws.authenticated });
  console.log(`[ws] Client connected from ${clientIp}. Total clients: ${wss.clients.size}`);

  const authenticationTimer = setTimeout(() => {
    if (!ws.guid && ws.readyState === WebSocket.OPEN) ws.close(4401, 'Authentication timeout');
  }, 10000);
  authenticationTimer.unref?.();

  // Ping/pong keepalive
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
    console.log(`[ws] Pong received from ${clientIp}`);
  });

  // Handle incoming messages
  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      diagnostics.touch(ws.socketId);

      if (msg.type === 'sync:hello') {
        if (!authService.matches(msg.accessKey || msg.data?.accessKey || '')) {
          diagnostics.record('client-auth-failed', { remoteAddress: clientIp });
          ws.close(4401, 'Invalid access key');
          return;
        }
        const guid = String(msg.guid || msg.data?.guid || '').trim();
        if (!profileRegistry.has(guid)) {
          ws.close(4403, 'Profile not configured');
          return;
        }
        clearTimeout(authenticationTimer);
        ws.authenticated = true;
        ws.guid = guid;
        ws.clientId = String(msg.clientId || msg.data?.clientId || '').trim();
        diagnostics.identify(ws.socketId, { profileId: guid, clientId: ws.clientId, authenticated: true });
        diagnostics.record('client-connected', { profileId: guid, clientId: ws.clientId, transport: 'websocket' });
        await userService.ensureUser(guid);
        sendInitialRealtimeState(ws);
        await sendUserSyncState(ws, guid);
      } else if (!ws.authenticated || !ws.guid) {
        ws.close(4401, 'Authenticate first');
      } else if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      } else if (msg.type === 'sync:request') {
        const guid = ws.guid || String(msg.guid || msg.data?.guid || '').trim();
        if (guid) await sendUserSyncState(ws, guid);
      } else if (msg.type === 'cast:get_devices') {
        const devices = castService.getDevices();
        ws.send(JSON.stringify({ type: 'cast:devices', data: devices }));
      } else if (msg.type === 'cast:play') {
        if (!castService.canControl(ws.guid || '')) return ws.send(JSON.stringify({ type: 'cast:error', data: { error: 'This user does not own the active cast session' } }));
        castService.resume().catch(err => {
          console.error('[ws] cast:play failed:', err.message);
          broadcastWs({ type: 'cast:error', data: { error: err.message } });
        });
      } else if (msg.type === 'cast:pause') {
        if (!castService.canControl(ws.guid || '')) return ws.send(JSON.stringify({ type: 'cast:error', data: { error: 'This user does not own the active cast session' } }));
        castService.pause().catch(err => {
          console.error('[ws] cast:pause failed:', err.message);
          broadcastWs({ type: 'cast:error', data: { error: err.message } });
        });
      } else if (msg.type === 'cast:seek') {
        if (!castService.canControl(ws.guid || '')) return ws.send(JSON.stringify({ type: 'cast:error', data: { error: 'This user does not own the active cast session' } }));
        castService.seek(msg.position || 0).catch(err => {
          console.error('[ws] cast:seek failed:', err.message);
          broadcastWs({ type: 'cast:error', data: { error: err.message } });
        });
      } else if (msg.type === 'cast:setVolume') {
        if (!castService.canControl(ws.guid || '')) return ws.send(JSON.stringify({ type: 'cast:error', data: { error: 'This user does not own the active cast session' } }));
        castService.setVolume(msg.level || 0).catch(err => {
          console.error('[ws] cast:setVolume failed:', err.message);
          broadcastWs({ type: 'cast:error', data: { error: err.message } });
        });
      } else if (msg.type === 'cast:stop') {
        if (!castService.canControl(ws.guid || '')) return ws.send(JSON.stringify({ type: 'cast:error', data: { error: 'This user does not own the active cast session' } }));
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
    clearTimeout(authenticationTimer);
    diagnostics.disconnect(ws.socketId, { code, reason: String(reason || '') });
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

// Application-level clock lets clients detect a missed websocket mutation even
// when the TCP connection itself appears healthy.
const syncClockInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.authenticated && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(realtimeSync.clock(ws.guid || '')));
  });
}, 60000);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
  clearInterval(syncClockInterval);
  console.log('[ws] WebSocket server closed');
});

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------
app.get('/api/status', (_req, res) => {
  res.json({
    ok: true,
    service: 'podwaffle-server',
    authRequired: authService.isRequired(),
    serverTime: new Date().toISOString(),
  });
});
app.use('/api', authService.requireHttpAccess);
app.use('/api', createApiRouter(feedService, userService, castService, broadcastWs, {
  pushService,
  profileRegistry,
  diagnostics,
  realtimeSync,
}));

const CLIENT_DIR = path.join(__dirname, '..', 'client');
app.use(express.static(CLIENT_DIR, { index: 'index.html', maxAge: '1h' }));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next();
  res.sendFile(path.join(CLIENT_DIR, 'index.html'));
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
  await profileRegistry.ensureAll(userService);

  // Verify at startup that the configured service account can obtain an FCM
  // OAuth token. This checks real Firebase access without sending a message.
  await pushService.logStartupStatus();

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
