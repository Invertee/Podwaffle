/* Local-first podcast data bridge with explicit backend refresh support. */
(function installPodcastDataRuntimeV2(root) {
  'use strict';

  const api = root && root.api;
  if (!api || api.__podcastDataRuntimeV2Installed) return;

  const CATALOG_KEY = 'podwaffle_podcast_catalog';
  const hydrationTasks = new Map();
  const lastHydrationAt = new Map();
  const HYDRATION_COOLDOWN_MS = 30000;
  let rerenderScheduled = false;

  function readJson(key, fallback) {
    try {
      const raw