const nav = {
  render(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Icons using simple SVG paths
    const icons = {
      podcasts: `<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>`,
      inProgress: `<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polygon points="10 8 16 12 10 16 10 8"></polygon></svg>`,
      discover: `<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`,
      history: `<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`,
      profile: `<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`
    };

    const items = [
      { id: 'podcasts', label: 'Podcasts', icon: icons.podcasts, hash: '#/podcasts' },
      { id: 'in-progress', label: 'In Progress', icon: icons.inProgress, hash: '#/in-progress' },
      { id: 'discover', label: 'Discover', icon: icons.discover, hash: '#/discover' },
      { id: 'history', label: 'History', icon: icons.history, hash: '#/history', mobileHidden: true },
      { id: 'profile', label: 'Profile', icon: icons.profile, hash: '#/profile' }
    ];

    const isSidebar = containerId === 'sidebar';
    
    let html = '';
    
    if (isSidebar) {
      html += `
        <div class="sidebar-logo">
          <img src="icons/icon-t.png" alt="Podwaffle Logo" class="sidebar-logo-img" width="52" height="52">
          <span style="font-weight: 700; font-size: 1.2rem; color: var(--text-primary);">Podwaffle</span>
        </div>
        <ul class="sidebar-nav">
      `;
      items.forEach(item => {
        html += `
          <li>
            <a href="${item.hash}" class="sidebar-nav-item" data-nav-id="${item.id}">
              ${item.icon}
              <span>${item.label}</span>
            </a>
          </li>
        `;
      });
      html += `</ul>`;
    } else {
      // Bottom nav (mobile)
      items.forEach(item => {
        const hiddenClass = item.mobileHidden ? 'mobile-hidden' : '';
        html += `
          <a href="${item.hash}" class="bottom-nav-item ${hiddenClass}" data-nav-id="${item.id}">
            ${item.icon}
            <span>${item.label}</span>
          </a>
        `;
      });
    }
    
    container.innerHTML = html;

    if (!isSidebar) {
      container.querySelectorAll('.bottom-nav-item').forEach((item) => {
        item.addEventListener('click', () => {
          if (window.playerBar && window.playerBar.isFullscreenOpen) {
            window.playerBar.closeFullscreenControls();
          }
        });
      });
    }
  },

  setActive(routeName) {
    // Determine the base route id from routeName
    let activeId = 'podcasts';
    if (routeName === 'podcasts' || routeName.startsWith('podcast/')) activeId = 'podcasts';
    else if (routeName === 'in-progress') activeId = 'in-progress';
    else if (routeName === 'discover') activeId = 'discover';
    else if (routeName === 'history') activeId = 'history';
    else if (routeName === 'profile') activeId = 'profile';

    // Update sidebar
    document.querySelectorAll('.sidebar-nav-item').forEach(el => {
      if (el.dataset.navId === activeId) el.classList.add('active');
      else el.classList.remove('active');
    });

    // Update bottom nav
    document.querySelectorAll('.bottom-nav-item').forEach(el => {
      if (el.dataset.navId === activeId) el.classList.add('active');
      else el.classList.remove('active');
    });
  }
};

window.nav = nav;
