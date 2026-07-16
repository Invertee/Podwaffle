/* Podwaffle Android Firebase data-message bridge. */
(function initializeFirebaseSyncBridge() {
  let plugin = null;
  let initialized = false;

  function parseValue(value) {
    if (typeof value !== 'string') return value;
    try { return JSON.parse(value); } catch (_) { return value; }
  }

  function handleMessage(raw) {
    const message = raw || {};
    if (message.type === 'token_refresh' && message.token) {
      registerToken(message.token);
      return;
    }
    if (message.type === 'media_command') {
      window.castClient?._handleHaCommand?.({
        guid: localStorage.getItem('podwaffle_guid') || '',
        command: message.command,
        value: parseValue(message.value),
        position: parseValue(message.position),
        volume: parseValue(message.volume),
        targetClientId: message.targetClientId || null,
      });
      return;
    }
    if (message.type === 'podwaffle_command') {
      const payload = parseValue(message.payload) || {};
      if ((message.command === 'cache_episode' || message.command === 'cache_podcast') && window.cacheManager) {
        const episodes = message.command === 'cache_episode' ? [payload.episode || payload] : (payload.episodes || []);
        window.cacheManager.prefetchEpisodes(episodes, episodes.length).catch((err) => {
          console.warn('[firebaseSync] Cache command failed:', err?.message || err);
        });
      }
      window.dispatchEvent(new CustomEvent('podwaffle:push-command', { detail: { ...message, payload } }));
    }
  }

  async function registerToken(token) {
    const guid = localStorage.getItem('podwaffle_guid') || '';
    if (!guid || !token || !window.api?.registerPushDevice) return;
    const clientId = window.getPodwaffleClientId ? window.getPodwaffleClientId() : (localStorage.getItem('podwaffle_client_id') || '');
    await window.api.registerPushDevice(guid, token, clientId);
    localStorage.setItem('podwaffle_fcm_token', token);
  }

  async function start() {
    if (initialized) return;
    const cap = window.Capacitor;
    if (!cap?.isNativePlatform?.()) return;
    plugin = cap.Plugins?.FirebaseSync;
    if (!plugin || !window.api?.getPushConfig) return;
    const guid = localStorage.getItem('podwaffle_guid') || '';
    if (!guid) return;
    const config = await window.api.getPushConfig();
    if (!config?.enabled) return;
    initialized = true;
    await plugin.addListener('messageReceived', handleMessage);
    const result = await plugin.initialize(config);
    if (result?.token) await registerToken(result.token);
    const pending = await plugin.getPendingMessages();
    (pending?.messages || []).forEach(handleMessage);
  }

  window.addEventListener('load', () => start().catch((err) => console.warn('[firebaseSync] Initialization failed:', err?.message || err)));
  window.addEventListener('podwaffle:sync-state', () => start().catch(() => {}));
  window.firebaseSync = { start, handleMessage };
})();
