# Podwaffle Build Complete 🎉

Podwaffle, your self-hosted podcast listening app, has been fully built and is now running on your local machine! 

The application architecture heavily mirrors Pocketcasts, providing a clean, responsive single-page application built on vanilla JS and Bulma CSS, powered by a robust Express backend.

## What was built

### Backend (`/server`)
- **API Server:** Built with Express, providing routes for managing subscriptions, viewing podcast feeds, tracking playback progress, and configuring user profiles.
- **Data Layer:** Uses a flat-file JSON structure in `/data` for portability. User profiles and cached podcast metadata are stored here.
- **Podcast Service:** Uses `rss-parser` to download and parse podcast XML feeds. It normalizes data and caches it.
- **Discover API:** Uses PodcastIndex.org as the primary search engine, with an automatic fallback to the iTunes Search API if no API key is provided.
- **Google Cast Support:** Integrated `castv2-client` and `bonjour-service` to discover Chromecast and Google Home devices on the network.
- **Real-time Sync:** A WebSocket connection pushes playback progress and "new episode" notifications to all connected clients instantly.
- **Background Scheduler:** A `node-cron` job runs every 35 minutes to check for new episodes in all subscribed podcasts.

### Frontend (`/client`)
- **Single Page Application:** Built entirely in Vanilla JavaScript without heavy frameworks, using hash-based routing (`#/podcasts`, `#/discover`, etc.).
- **User Interface:** Styled using Bulma CSS and custom CSS variables to closely match the dark-mode aesthetic of Pocketcasts.
- **Components:** 
  - Dynamic responsive navigation (Sidebar on desktop, Bottom bar on mobile).
  - A persistent Player Bar at the bottom of the screen.
  - An "Up Next" queue panel with drag-and-drop reordering.
  - A Google Cast device selection modal.
- **Media Player:** Uses the native HTML5 `<audio>` element for local playback.
- **Service Worker:** Includes a service worker (`sw.js`) that automatically caches audio files as they are streamed, improving performance for seeking and replays.

## How to use Podwaffle

The server is currently running in the background.

1. **Open the app:** Navigate to [http://localhost:3000](http://localhost:3000) in your web browser.
2. **Discover Podcasts:** Click on the **Discover** tab and search for your favorite podcasts. Click "Subscribe" to add them.
3. **Listen:** Go to the **Podcasts** tab, select a podcast, and click play on an episode.
4. **Cast:** Click the Cast icon in the bottom right of the player bar to stream the audio to your Google Home or Chromecast devices!
5. **Sync Profiles:** In the **Profile** tab, you'll see your unique Profile GUID. You can enter this GUID on any other device on your network (e.g., your phone) to sync your subscriptions and listening progress!

> [!TIP]
> **PodcastIndex API Key:** For more comprehensive search results, you can sign up for a free API key at [PodcastIndex.org](https://podcastindex.org/) and enter it in the **Profile** tab.

Enjoy your new podcast app! Let me know if you'd like to add any more features or tweak the design.
