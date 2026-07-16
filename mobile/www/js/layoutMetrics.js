/* Keep player-adjacent controls aligned with the rendered player and mobile nav. */
(function initLayoutMetrics() {
  const root = document.documentElement;
  let observer = null;
  let frame = null;

  function px(value) {
    return `${Math.max(0, Math.ceil(Number(value) || 0))}px`;
  }

  function isVisible(element) {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function updateConnectionHealthGrid() {
    const mode = document.getElementById('conn-mode');
    const grid = mode?.closest('.stats-grid');
    if (grid) grid.classList.add('connection-health-grid');
  }

  function measure() {
    frame = null;
    const player = document.getElementById('player-bar');
    const bottomNav = document.getElementById('bottom-nav');
    const playerHeight = player && isVisible(player) ? player.getBoundingClientRect().height : 0;
    const navHeight = bottomNav && isVisible(bottomNav) ? bottomNav.getBoundingClientRect().height : 0;

    root.style.setProperty('--player-rendered-height', px(playerHeight));
    root.style.setProperty('--bottom-nav-rendered-height', px(navHeight));
    updateConnectionHealthGrid();
  }

  function scheduleMeasure() {
    if (frame != null) return;
    frame = window.requestAnimationFrame(measure);
  }

  function observe() {
    if (typeof ResizeObserver !== 'function') return;
    observer?.disconnect();
    observer = new ResizeObserver(scheduleMeasure);
    const player = document.getElementById('player-bar');
    const bottomNav = document.getElementById('bottom-nav');
    if (player) observer.observe(player);
    if (bottomNav) observer.observe(bottomNav);
  }

  function refresh() {
    observe();
    scheduleMeasure();
  }

  document.addEventListener('DOMContentLoaded', refresh);
  window.addEventListener('resize', scheduleMeasure, { passive: true });
  window.addEventListener('hashchange', () => {
    window.setTimeout(refresh, 0);
    window.setTimeout(scheduleMeasure, 100);
  });

  const mutationObserver = new MutationObserver(() => {
    updateConnectionHealthGrid();
    scheduleMeasure();
  });

  document.addEventListener('DOMContentLoaded', () => {
    mutationObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
  });

  window.podwaffleLayoutMetrics = { refresh, measure };
})();
