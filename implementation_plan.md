# Podwaffle — Implementation Plan

A full-featured podcast listening application modelled closely on Pocketcasts, built with vanilla Node.js/Express (backend) and vanilla JS + Bulma CSS (frontend).

---

## Overview

Podwaffle is a self-hosted, multi-user podcast listening application. The backend serves both the SPA and REST/WebSocket APIs. User profiles are stored as JSON files keyed by UUID (GUID). Podcast metadata is pulled from RSS feeds, refreshed every 35 minutes. Two playback modes are supported: local browser audio and backend-driven Google Cast.

---

## Confirmed Decisions

> [!NOTE]
> **Podcast Search**: **PodcastIndex.org** is the primary search API, with **iTunes Search API** as automatic fallback when no PodcastIndex key is configured. Both the API key and secret are stored per-user in their settings profile and configurable from the Profile screen.

> [!NOTE]
> **Google Cast**: Backend-driven casting using **`castv2-client` + `bonjour`** (mDNS). Confirmed suitable for older Google Home speakers on the same LAN.

> [!NOTE]
> **Skip Duration Default**: 15s back / 45s forward (matching Pocketcasts defaults), user-configurable in Profile.djust.

---

## Project Structure

```
PodWaffle/
├── server/                     # Backend Node.js Express app
│   ├── server.js               # Main entry point
│   ├── routes/
│   │   ├── api.js              # REST API router
│   │   └── cast.js             # Cast control routes
│   ├── services/
│   │   ├── feedService.js      # RSS feed fetching & parsing
│   │   ├── userService.js      # User profile CRUD
│   │   ├── castService.js      # Google Cast backend sender
│   │   └── scheduler.js        # Periodic 35-min feed refresh
│   ├── data/
│   │   ├── users/              # {guid}.json user profiles
│   │   └── podcasts/           # {feedId}.json podcast + episode cache
│   └── package.json
├── client/                     # Frontend SPA
│   ├── index.html              # Single entry point
│   ├── sw.js                   # Service Worker (cache API)
│   ├── css/
│   │   └── app.css             # Bulma + custom overrides (dark theme)
│   ├── js/
│   │   ├── app.js              # App bootstrap, router, state
│   │   ├── api.js              # API client (fetch wrappers)
│   │   ├── player.js           # Audio player, MediaSession API
│   │   ├── castClient.js       # WebSocket bridge to backend cast
│   │   ├── views/
│   │   │   ├── podcasts.js     # Podcasts grid view
│   │   │   ├── podcastDetail.js# Single podcast + episodes view
│   │   │   ├── inProgress.js   # In-progress list view
│   │   │   ├── discover.js     # Discover / search view
│   │   │   ├── history.js      # History list view (desktop only)
│   │   │   └── profile.js      # Profile / settings / stats view
│   │   └── components/
│   │       ├── playerBar.js    # Bottom progress bar component
│   │       ├── queue.js        # Now playing queue panel
│   │       ├── castModal.js    # Cast device picker modal
│   │       ├── nav.js          # Sidebar (desktop) / bottom nav (mobile)
│   │       └── episodeRow.js   # Reusable episode list row
│   └── manifest.json           # PWA manifest (for Android media controls)
└── README.md
```

---

## Proposed Changes

### Backend — Server Foundation

#### [NEW] `server/server.js`
- Express app setup with CORS, JSON body parsing
- Serves `client/` as static files
- Mounts REST API and WebSocket (via `ws` package)
- Starts the 35-minute RSS refresh scheduler on boot
- Starts the Cast device discovery service (mDNS)
- Extensive `console.log` / `console.error` throughout

#### [NEW] `server/package.json`
Key dependencies:
| Package | Purpose |
|---|---|
| `express` | HTTP server |
| `ws` | WebSocket for real-time frontend sync |
| `rss-parser` | RSS/Atom feed parsing + iTunes namespace support |
| `node-fetch` | HTTP fetch for feed downloads |
| `uuid` | GUID generation for user profiles |
| `bonjour-service` | mDNS for Chromecast discovery |
| `castv2-client` | Google Cast CASTV2 protocol sender |
| `node-cron` | Periodic task scheduler |

---

### Backend — Services

#### [NEW] `server/services/userService.js`
- CRUD for `data/users/{guid}.json`
- Schema per user profile:
```json
{
  "guid": "...",
  "createdAt": "ISO8601",
  "updatedAt": "ISO8601",
  "settings": {
    "skipBack": 15,
    "skipForward": 45
  },
  "subscriptions": ["feedUrl1", "feedUrl2"],
  "progress": {
    "{episodeGuid}": {
      "position": 1234.5,
      "duration": 3600,
      "updatedAt": "ISO8601",
      "played": false
    }
  },
  "history": [
    { "episodeGuid": "...", "podcastId": "...", "listenedAt": "ISO8601" }
  ],
  "stats": {
    "totalListenedSeconds": 0,
    "totalSkippedSeconds": 0
  }
}
```
- Timestamp-aware merge: when saving progress, compare `updatedAt` across clients, keeping the latest

#### [NEW] `server/services/feedService.js`
- Fetches and parses RSS feeds using `rss-parser`
- Caches episode metadata to `data/podcasts/{feedId}.json`
- Determines "new" episodes by comparing `pubDate` to last-known
- Exposes methods: `getFeedMeta(feedUrl)`, `getEpisodes(feedUrl, limit, offset)`, `refreshAllFeeds()`

#### [NEW] `server/services/castService.js`
- mDNS discovery via `bonjour` — scans `_googlecast._tcp` service type
- Maintains an in-memory device registry (`{ name, host, port, status }`)
- Methods: `getDevices()`, `castToDevice(deviceId, mediaUrl, startPosition)`, `pauseCast()`, `resumeCast()`, `stopCast()`, `setCastVolume(level)`
- Broadcasts position updates via WebSocket every ~5 seconds while casting
- Reports progress back so the frontend can sync the scrubber

#### [NEW] `server/services/scheduler.js`
- Uses `node-cron` to trigger `feedService.refreshAllFeeds()` every 35 minutes
- Logs each refresh cycle with timestamps and episode counts

---

### Backend — REST API Routes

#### [NEW] `server/routes/api.js`

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/users` | Create new user, returns GUID |
| `GET` | `/api/users/:guid` | Get user profile |
| `PUT` | `/api/users/:guid/settings` | Update settings |
| `GET` | `/api/users/:guid/subscriptions` | Get subscribed podcasts with metadata |
| `POST` | `/api/users/:guid/subscriptions` | Subscribe to a podcast (by feedUrl) |
| `DELETE` | `/api/users/:guid/subscriptions/:feedId` | Unsubscribe |
| `GET` | `/api/users/:guid/progress` | Get all episode progress |
| `PUT` | `/api/users/:guid/progress/:episodeGuid` | Update episode position/played |
| `GET` | `/api/users/:guid/history` | Get listen history (paginated) |
| `GET` | `/api/users/:guid/stats` | Get listening stats |
| `GET` | `/api/podcasts/:feedId` | Get podcast metadata + episodes (limit/offset) |
| `GET` | `/api/search?q=query&guid=userGuid` | Search PodcastIndex (user key if set) → fallback iTunes |
| `GET` | `/api/cast/devices` | List discovered Cast devices |
| `POST` | `/api/cast/play` | Start cast playback |
| `POST` | `/api/cast/pause` | Pause cast |
| `POST` | `/api/cast/resume` | Resume cast |
| `POST` | `/api/cast/stop` | Stop cast |
| `PUT` | `/api/cast/volume` | Set cast volume |
| `PUT` | `/api/cast/seek` | Seek to position |

#### WebSocket Events (via `ws`)
| Event (server → client) | Payload |
|---|---|
| `cast:state` | `{ deviceId, state, position, duration }` |
| `feeds:updated` | `{ updatedFeeds: [feedId] }` — notifies clients of new episodes |

---

### Frontend — SPA Architecture

#### [NEW] `client/index.html`
- Single HTML file, loads Bulma from CDN + Google Fonts (Inter)
- Registers service worker
- Dark-mode theme by default (matching Pocketcasts dark UI)

#### [NEW] `client/js/app.js`
- Hash-based SPA router (`#/podcasts`, `#/in-progress`, `#/discover`, `#/history`, `#/profile`, `#/podcast/:feedId`)
- Global state object: `{ user, queue, currentEpisode, playMode, castDevice }`
- Initialises player bar, nav, and periodic sync (every 60s to check new episodes)

#### [NEW] `client/js/player.js`
- Wraps `HTMLAudioElement` for local playback
- Implements `MediaSession` API: artwork, title, skip forward/back action handlers → enables Android lock screen controls
- Syncs position to backend every 15 seconds
- Marks episode played at ≥98% progress
- On queue exhaustion: marks played, clears queue, resets player UI

#### [NEW] `client/js/castClient.js`
- WebSocket client connected to backend
- Relays commands (play, pause, seek, volume) to backend cast service
- Updates shared player state from `cast:state` events so the progress bar reflects cast position

---

### Frontend — Views

#### [NEW] `client/js/views/podcasts.js`
- Grid of square podcast artwork tiles (4–6 columns desktop, 3 mobile)
- Blue dot indicator on tile for podcasts with new unseen episodes
- Click navigates to `#/podcast/:feedId`

#### [NEW] `client/js/views/podcastDetail.js`
- Podcast header: large artwork, title, description (4-line clamp, click to expand), subscriber info
- Episode list: 100 episodes default, "Load more" button for pagination
- Per-episode row:
  - Checkbox for multi-select
  - Title, date, duration
  - Played state: lighter colour + tick icon (≥98% threshold)
  - Inline action buttons: Play, Play Next, Play Last, Mark Played

#### [NEW] `client/js/views/inProgress.js`
- Filtered list of episodes with `position > 0` and `played === false`
- Shows progress within each row (remaining time)

#### [NEW] `client/js/views/discover.js`
- Search bar → calls `/api/search?q=`
- Results shown as artwork tiles with podcast name
- Subscribe button on each → calls POST subscriptions API

#### [NEW] `client/js/views/history.js`
- Chronological list of listened episodes
- **Desktop-only**: hidden via CSS on mobile (`display: none` below breakpoint)

#### [NEW] `client/js/views/profile.js`
- Displays GUID with copy-to-clipboard
- Editable skip forward/back duration (saved to backend)
- Stats panel: total listened minutes, total skipped minutes
- Login/switch profile: enter existing GUID field

---

### Frontend — Components

#### [NEW] `client/js/components/playerBar.js`
- Always-visible bottom bar (z-index above content)
- **Left**: Episode artwork thumbnail + title/podcast name
- **Centre**: Skip-back | Play/Pause | Skip-forward, progress scrubber, elapsed/total time
- **Right**: Volume slider, Cast button, Queue button
- Updates every second via `requestAnimationFrame`

#### [NEW] `client/js/components/queue.js`
- Slide-up panel listing queued episodes
- Drag-to-reorder (HTML5 drag API)
- Remove button per item

#### [NEW] `client/js/components/castModal.js`
- Triggered by Cast button
- Lists discovered devices from `/api/cast/devices`
- "Local" option at top to switch back to browser playback
- Visual indicator for currently active device

#### [NEW] `client/js/components/nav.js`
- Desktop: left sidebar with icon + label links
- Mobile: fixed bottom navbar with icon tabs
- Active state highlighting
- History tab hidden on mobile

---

### Service Worker

#### [NEW] `client/sw.js`
- Intercepts audio file fetch requests
- Caches podcast audio URLs in a named `CacheStorage` (`podwaffle-media-v1`)
- Evicts entries older than 14 days on activation/fetch
- Serves from cache if available (offline support)

---

### Styling

#### [NEW] `client/css/app.css`
- Imports Bulma base
- Dark theme colour overrides (matching Pocketcasts dark palette)
  - Background: `#1a1a2e` → `#16213e`
  - Surface: `#0f3460`
  - Accent: `#e94560` (coral-red, matching PocketCasts brand red)
  - Text: `#eee`
- Custom: `.podcast-tile`, `.episode-row`, `.player-bar`, `.sidebar`, `.bottom-nav`
- Responsive breakpoints for mobile layout switch

---

## Key Design Decisions

| Decision | Rationale |
|---|---|
| **Vanilla JS + Bulma** | As specified. Bulma provides responsive grid/layout; custom CSS handles theming |
| **Hash-based SPA routing** | No build step needed; works with static file serving |
| **JSON file storage** | As specified. `updatedAt` timestamps on progress records allow multi-client conflict resolution |
| **iTunes Search API** | No API key required; widely available; sufficient for discovery |
| **`castv2-client` + `bonjour`** | Only viable Node.js approach for backend-driven cast |
| **WebSocket for cast sync** | Gives real-time position updates from backend Cast sender to frontend scrubber |
| **MediaSession API** | Native browser/OS integration; Android lock screen support |
| **Service Worker Cache API** | Specified requirement; 14-day TTL for media files |

---

## Verification Plan

### Automated Checks
- `node server/server.js` — server starts without errors, binds port 3000
- All REST API routes return correct status codes (verified via curl/Postman)

### Manual Verification
- Create user → receive GUID
- Subscribe to a podcast → appears in Podcasts grid
- Podcast detail page loads episodes
- Episode plays locally; MediaSession API updates OS controls
- Progress syncs to backend (verify JSON file updated every 15s)
- Mark played via ≥98% threshold → episode shows tick + lighter colour
- Queue: add episodes, reorder, remove, auto-advance
- Discover: search returns results, subscribe works dynamically
- Cast: device list appears, cast starts, WebSocket position updates frontend
- Mobile: bottom nav present, History tab hidden
- Service Worker: audio cached, served on second play
- Feed refresh: scheduler fires every 35 min, new episodes marked on tile

---

## Phased Build Order

1. **Backend foundation** — Express server, user service, feed service, API routes  
2. **Frontend shell** — SPA router, nav, layout, Bulma dark theme  
3. **Podcasts view** — Grid, new-episode dot, click to detail  
4. **Podcast detail** — Episode list, play actions, mark played  
5. **Player bar** — Local audio, MediaSession, progress sync, queue  
6. **In Progress & History views**  
7. **Discover view** — iTunes search, subscribe  
8. **Profile view** — Stats, settings, GUID sharing  
9. **Cast system** — Backend mDNS + castv2, WebSocket sync, Cast modal  
10. **Service Worker** — Media caching, 14-day TTL  
11. **Scheduler** — 35-min feed refresh, frontend WebSocket notification  
12. **Polish** — Responsive mobile, animations, error handling, logging  
