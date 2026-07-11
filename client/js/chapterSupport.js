/* Podcast chapters: discovery, transport controls, indicator, and queue-panel tab. */
(function installChapterSupport(root) {
  'use strict';
  const player = root.player;
  const api = root.api;
  if (!player || !api || player.__chapterSupportInstalled) return;

  const cache = new Map();
  const inflight = new Map();
  let activeTab = 'queue';

  const esc = (value) => String(value || '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const local