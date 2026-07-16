'use strict';

/* Keep local playback at full media volume and expose volume controls only for Cast. */
(function installCastVolumeControl() {
  const player = window.player;
  const playerBar = window.playerBar;
  if (!player || !playerBar || player.__castVolumeControlInstalled) return;

  const clampVolume = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 1;
    return Math.max(0, Math.min(1, numeric));
  };

  const setElementVisible = (element, visible) => {
    if (!element) return;
    element.hidden = !visible;
    element.setAttribute('aria-hidden', String(!visible));
  };

  const forceSystemVolume = () => {
    if (player.mode !== 'local') return;
    player.volume = 1;
    player._localVolume = 1;
    if (player.audio) player.audio.volume = 1;
    try { localStorage.removeItem('podwaffle_volume'); } catch (_) {}
  };

  const syncControls = (state = {}) => {
    const casting = state.mode === 'cast';
    const volume = clampVolume(state.volume);

    const desktopSlider = document.getElementById('pb-volume');
    const desktopIcon = desktopSlider?.previousElementSibling || null;
    const mobileSlider = document.getElementById('pb-mobile-volume');
    const mobileWrap = mobileSlider?.closest?.('.player-mobile-volume-wrap') || null;

    setElementVisible(desktopIcon, casting);
    setElementVisible(desktopSlider, casting);
    setElementVisible(mobileWrap, casting);

    if (casting) {
      if (desktopSlider && document.activeElement !== desktopSlider) {
        desktopSlider.value = String(Math.round(volume * 100));
      }
      if (mobileSlider && document.activeElement !== mobileSlider) {
        mobileSlider.value = String(Math.round(volume * 100));
      }
    }
  };

  forceSystemVolume();

  const originalSetVolume = player.setVolume.bind(player);
  player.setVolume = function setCastVolumeOnly(level) {
    if (this.mode === 'local') {
      forceSystemVolume();
      this._notifyStateChange?.();
      return undefined;
    }
    return originalSetVolume(clampVolume(level));
  };

  const originalApplyCastState = player.applyCastState?.bind(player);
  if (originalApplyCastState) {
    player.applyCastState = function applyCastStateWithVolume(status = {}) {
      const normalized = status.volume == null
        ? status
        : { ...status, volume: clampVolume(status.volume) };
      return originalApplyCastState(normalized);
    };
  }

  const originalSwitchToLocal = player.switchToLocal?.bind(player);
  if (originalSwitchToLocal) {
    player.switchToLocal = async function switchToLocalAtSystemVolume(...args) {
      const result = await originalSwitchToLocal(...args);
      forceSystemVolume();
      this._notifyStateChange?.();
      return result;
    };
  }

  const originalBarRender = playerBar.render.bind(playerBar);
  playerBar.render = function renderWithCastVolume(...args) {
    const result = originalBarRender(...args);
    syncControls({ mode: player.mode, volume: player.volume });
    return result;
  };

  const originalBarUpdate = playerBar.update.bind(playerBar);
  playerBar.update = function updateWithCastVolume(state) {
    const result = originalBarUpdate(state);
    syncControls(state || {});
    return result;
  };

  player.onStateChange?.((state) => {
    if (state?.mode === 'local') forceSystemVolume();
    syncControls(state || {});
  });

  player.__castVolumeControlInstalled = true;
  window.castVolumeControl = { clampVolume, forceSystemVolume, syncControls };
})();
