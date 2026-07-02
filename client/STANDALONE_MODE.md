# PodWaffle Local-First Standalone Mode

## Overview

PodWaffle is designed to work **fully standalone** without any backend server. All your podcast subscriptions, episode progress, playback history, and personalization are stored locally in your browser's storage.

## Getting Started (Local-Only Mode)

### Start the client development server:

```bash
cd client
npm install
npm start
```

The app will run at `http://localhost:4000` and work completely offline:
- All subscriptions are stored in localStorage
- Episode progress is tracked locally
- Playback history is saved in your browser
- No data is sent to any server

## Optional: Enable Backend Sync

If you want to sync your podcast data across multiple devices (phone, tablet, desktop), you can optionally configure a PodWaffle backend server.

### 1. Set Up Backend Server

Start the backend server:

```bash
cd server
npm install
npm start
```

The backend will run on `http://localhost:3000` by default.

### 2. Configure Backend in App Settings

In the PodWaffle app:
1. Click your profile icon → **Settings**
2. Scroll to **"Backend Server"** section
3. Enable "Enable backend sync" checkbox
4. Enter server details:
   - **Server host or URL**: `localhost` (or your server's domain)
   - **Port**: `3000` (or your server's port)
   - Optionally enable HTTPS/WSS if using a secure connection
5. Click **"Save Server Settings"**

Once configured, the app will automatically sync your data with the backend.

### 3. Cross-Device Sync

With a backend configured:
- Changes on one device will sync to the server
- Other devices with the same GUID can pull and merge those changes
- Episode progress uses timestamp-based conflict resolution (most recent wins)
- Subscriptions are merged (you won't lose any local subscriptions)

## Architecture

### Local Mode (No Backend)
```
Browser App → localStorage only
(All data stays on your device)
```

### Sync Mode (With Backend)
```
Device A → (sync) → Backend Server ← (sync) ← Device B
(All data synced across devices)
```

## Data Storage

- **Subscriptions**: List of podcast feed URLs
- **Episode Progress**: Start position, play time, completion status per episode
- **Playback Stats**: Total hours listened, episodes completed
- **Queue**: Current playback queue
- **Settings**: Skip back/forward, backend configuration

## Privacy

- **Local Mode**: 100% private - no data leaves your device
- **Sync Mode**: Data is sent to *your* backend server only (you control the server)

## Environment Variables

### Client Server
- `PORT`: Port to run on (default: 4000)
- `BACKEND_URL`: Optional backend URL to proxy API calls to (default: none)

Example with backend:
```bash
# Automatically proxy /api/* calls to http://localhost:3000
BACKEND_URL=http://localhost:3000 npm start
```

Example standalone:
```bash
# No backend - app works in local-only mode
npm start
```

## Troubleshooting

### "Backend not configured" error
- This is expected if you haven't set up a backend server
- The app will continue to work in local-only mode
- Go to Settings > Backend Server to configure one if needed

### Data not syncing
- Make sure backend server is running on the configured host/port
- Check browser console for detailed error messages
- Verify client can reach backend (e.g., same network, firewall open)

### Lost data when switching devices
- Without a backend configured, each device has its own separate local storage
- To sync across devices, configure a backend server in settings
- Once configured, run a manual sync from the Settings panel
