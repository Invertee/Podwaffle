# Changelog

## Unreleased

- Repaired SQLite queue trigger conflict handling when playback switches to an
  already-queued episode, restored immutable caching for generated web assets,
  distinguished revoked credentials from an unsigned session lookup, added the
  schema 4 repair migration, and bumped the Home Assistant add-on to 5.0.19.
- Unified current playback and the shared queue so the active episode is always
  queue item zero across Android, web and Cast, protected it during queue edits,
  fixed Android's offline native transition ordering, updated Android to 0.4.17 /
  versionCode 21 / native runtime 0.4-native-19, and bumped the Home Assistant
  add-on to 5.0.18.
- Made Android local playback offline-first, enabled uninterrupted native queue
  advancement, retained paused media controls as a foreground session, added
  media-button playback resumption, promoted completed queue downloads into the
  active native playlist, proactively warmed podcast artwork on disk, and updated
  Android to 0.4.16 / versionCode 20 / native runtime 0.4-native-18.
- Made the complete Android mini-player surface open Now Playing, expanded the
  swipe-down collapse gesture across the full player surface, kept the main bottom
  navigation visible on Now Playing, and updated Android to 0.4.15 / versionCode 19.
- Redesigned the Android playback chrome with podcast artwork and centred controls,
  added swipe-up expansion and swipe-down collapse for Now Playing, removed the
  duplicate collapsed controls while expanded, added library Cast access and an
  episode-information sheet, centred the Now Playing info/Cast actions, removed
  the Now Playing download action, and updated Android to 0.4.14 / versionCode 18 /
  native runtime 0.4-native-17.
- Restored Android Auto discovery through an isolated Media3 library service,
  re-enabled the Podcasts-to-Episodes browse tree with play/resume and queue
  actions, automatically cached episodes queued from the car, and updated Android
  to 0.4.13 / versionCode 17 / native runtime 0.4-native-16.
- Automatically cached Android queue episodes using the existing bounded download
  store and updated Android to 0.4.12 / versionCode 16 / native runtime
  0.4-native-15.
- Remapped Bluetooth, headset and car previous/next media keys to the configured
  backward/forward skip intervals and updated Android to 0.4.11 / versionCode 15 /
  native runtime 0.4-native-14.
- Added explicit Android notification/lock-screen skip-back and skip-forward
  actions using profile-synchronised intervals, removed direct timeline seeking
  from the notification controller where System UI permits, routed foreground
  Android volume keys to an active Cast receiver, limited web volume controls to
  Cast playback, updated Android to 0.4.10 / versionCode 14 / native runtime
  0.4-native-13, and bumped the Home Assistant web add-on to 5.0.17.
- Stabilised the Android startup subscriptions selector to stop a render loop
  that blocked keyboard focus and press handlers, and updated Android to 0.4.9 /
  versionCode 13 / native runtime 0.4-native-12.
- Disabled Android Auto service discovery after the first integration could stall
  the normal Android UI during startup; retained the implementation for an isolated
  rework and updated Android to 0.4.8 / versionCode 12 / native runtime 0.4-native-11.
- Added Android Auto media browsing with profile podcast tiles, compact episode
  lists, local playback and shared queue actions; kept Cast and episode-detail
  actions out of the car interface, added a cached offline catalogue, and updated
  Android to 0.4.7 / versionCode 11 / native runtime 0.4-native-10.
- Updated Android to 0.4.6 / versionCode 10 / native runtime 0.4-native-9,
  aligned the launcher and splash artwork with the shared web/Home Assistant
  Podwaffle icon, and bumped the Home Assistant web add-on to 5.0.16.
- Bounded and compacted Android's offline episode cache, migrated away from the
  unbounded v1 cache, pruned oldest entries before writes, and prevented a local
  SQLite cache failure from hiding a successfully fetched episode list.
- Added profile-synchronised skip intervals across web and Android, repaired
  targeted device handoff, and added remote-position dead reckoning in the web
  player while preserving server state as the authoritative playback position.
- Changed Android system media actions to seek backward/play-pause/seek forward,
  used podcast artwork for system media metadata, removed the Downloads tab, and
  warmed compact offline episode catalogues for subscribed podcasts.
- Removed the pre-application Android media-controller bootstrap that raced Expo
  module initialization in release builds, registered the MediaSession directly
  with MediaSessionService, and updated Android to 0.4.5 / native runtime 0.4-native-8.
- Refreshed the web listening-statistics query after confirmed skip movements so
  skipped-forward totals update immediately without reloading the profile page.
- Switched Android podcast downloads to DownloadManager's hidden-notification mode,
  declared the normal install-time permission it requires, and removed the unused
  Podwaffle download channel while retaining durable background download behavior.
- Matched the Android mini-player, Now Playing transport controls, system media
  actions and Cast glyphs to the web player's icon language; updated Android to
  version 0.4.4 and native runtime 0.4-native-7.
- Added the platform media-browser service declaration and updated the Android
  application and native runtime version to 0.4.3.
- Restored the web Google Cast sender control and added Play on device pickers to
  both web and Android, with targeted live handoff between profile clients.
- Added target-device playback commands and separated local command confirmation
  from Cast receiver confirmation so local transfers no longer require Cast state.
- Hardened Android Cast startup by using CAF's configured media-route button,
  restored public lock-screen media controls and metadata, and improved
  notification refreshes across player and metadata changes.
- Generalised playback-command relay to local and Cast owners, added live remote
  state and explicit Play Here takeover across Android and web, and added remote
  episode selection alongside transport commands.
- Completed the Android Milestones 23–26 finish pass: persistent navigation and
  mini-player chrome, compact artwork-free episode rows, web-aligned vector
  icons and styling, status-bar-safe layouts, animation-free detail navigation,
  Google Cast controls, and Media3 lock-screen/notification transport controls.
- Removed Android sleep-timer and playback-speed controls, suppressed background
  refresh spinners, and updated the Android application/runtime version to 0.4.0.
- Completed Android Milestones 19–23: authenticated live WebSocket recovery,
  native queue and cross-client playback coordination, a full Now Playing
  experience, persistent background downloads with offline playback and storage
  maintenance, and Google Cast sender playback with receiver-confirmed handoff.
- Completed Android Milestones 14–18: secure joining and cached sync, tile/list
  library ordering, podcast and episode browsing, Apple discovery, in-progress
  playback, profile statistics/device controls, a durable queue, and real Media3
  streaming with server playback leases, progress, movement and telemetry updates.
- Added Milestone 11 Google Cast Web Sender support with receiver metadata,
  transport/volume controls, local handoff, speaker reselection, owner-relayed
  cross-client commands, confirmed-result persistence and idle fallback.
- Added Milestones 9–10: lease-owned browser playback, persistent transport and
  Media Session controls, multi-tab coordination, deduplicated telemetry,
  confirmed movement accounting, daily roll-ups and profile statistics.
- Added Milestones 5–8: Apple discovery, RSS ingestion and conditional refresh,
  subscriptions and ordering, episode state/history, and a durable shared queue.
- Added a committed, isolated development configuration used automatically by
  `pnpm dev`.

## 0.1.0 - 2026-07-29

- Added the pnpm/TypeScript monorepo baseline.
- Added Home Assistant packaging and same-origin production web hosting.
- Added SQLite migrations, transactions and managed online backups.
- Added configured profiles, secure joining, device sessions and revocation.
- Added durable revision sync, idempotent commands and authenticated WebSockets.
- Added the responsive Phase 1 join and device-management web experience.
