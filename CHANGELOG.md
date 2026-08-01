# Changelog

## Unreleased

- Switched Android podcast downloads to DownloadManager's hidden-notification mode,
  declared the normal install-time permission it requires, and removed the unused
  Podwaffle download channel while retaining durable background download behavior.
- Matched the Android mini-player, Now Playing transport controls, system media
  actions and Cast glyphs to the web player's icon language; updated Android to
  version 0.4.4 and native runtime 0.4-native-7.
- Registered the Android MediaSessionService with an in-process MediaController so
  Media3 can publish the foreground media notification, lock-screen metadata and
  system play/pause/seek controls during local playback.
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
