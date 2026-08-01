# Changelog

## Unreleased

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
