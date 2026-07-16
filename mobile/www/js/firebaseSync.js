/* Podwaffle Android Firebase data-message bridge. */
(function initializeFirebaseSyncBridge() {
  let initialized = false;
  function parse(value) { if (typeof value !== 'string') return value; try { return JSON.parse(value); } catch (_) { return value; } }
  async function registerToken(token) {
    const guid = localStorage.getItem('podwaffle_guid') || '';
    if (!guid || !token || !window.api?.registerPushDevice) return;
    const clientId = window.getPodwaffleClientId ? window.getPodwaffleClientId() : (localStorage.getItem('podwaffle_client_id') || '');
    await window.api.registerPushDevice(guid, token, clientId);
    localStorage.setItem('podwaffle_fcm_token', token);
  }
  function handleMessage(message = {}) {
    if (message.type === 'token_refresh' && message.token) return void registerToken(message.token);
    if (message.type === 'media_command') {
      window.castClient?._handleHaCommand?.({ guid: localStorage.getItem('podwaffle_guid') || '', command: message.command, value: parse(message.value), position: parse(message.position), volume: parse(message.volume), targetClientId: message.targetClientId || null });
      return;
    }
    if (message.type === 'podwaffle_command') {
      const payload = parse(message.payload) || {};
      if ((message.command === 'cache_episode' || message.command === 'cache_podcast') && window.cacheManager) {
        const episodes = message.command === 'cache_episode' ? [payload.episode || payload] : (payload.episodes || []);
        window.cacheManager.prefetchEpisodes(episodes, episodes.length).catch((err) => console.warn('[firebaseSync] Cache command failed:', err?.message || err));
      }
      window.dispatchEvent(new CustomEvent('podwaffle:push-command', { detail: { ...message, payload } }));
    }
  }
  async function start() {
    if (initialized || !window.Capacitor?.isNativePlatform?.()) return;
    const plugin = window.Capacitor.Plugins?.FirebaseSync;
    const guid = localStorage.getItem('podwaffle_guid') || '';
    if (!plugin || !guid || !window.api?.getPushConfig) return;
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
