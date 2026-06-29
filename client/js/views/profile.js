async function renderProfile(container) {
  container.innerHTML = `
    <div class="view-header">
      <h1 class="view-title">Profile</h1>
    </div>
    <div id="profile-content">
      <div class="loading-state">
        <div class="spinner spin"></div>
      </div>
    </div>
  `;

  const contentEl = document.getElementById('profile-content');
  const guid = window.appState ? window.appState.guid : localStorage.getItem('podwaffle_guid');
  
  try {
    const user = await window.api.getUser(guid);
    
    const stats = user.stats || { totalListenedSeconds: 0, totalSkippedSeconds: 0 };
    const settings = user.settings || { skipBack: 15, skipForward: 45 };
    
    const formatHours = (secs) => {
      if (!secs) return '0 hrs';
      const hours = Math.floor(secs / 3600);
      const mins = Math.floor((secs % 3600) / 60);
      if (hours > 0) return `${hours} hrs ${mins} mins`;
      return `${mins} mins`;
    };

    contentEl.innerHTML = `
      <div class="profile-section">
        <h2 class="profile-section-title">Account Sync</h2>
        <p class="text-secondary mb-4">Your profile is identified by the GUID below. Enter this GUID on another device to sync your podcasts and progress.</p>
        <div class="guid-display-wrapper mb-4">
          <code class="guid-display" id="profile-guid">${user.guid}</code>
          <button id="btn-copy-guid" class="btn btn-outline btn-small ml-2">Copy</button>
        </div>
        
        <div class="form-group row align-center mt-4">
          <input type="text" id="input-switch-guid" class="form-control" placeholder="Enter existing GUID..." style="max-width: 300px;">
          <button id="btn-switch-guid" class="btn btn-primary ml-2">Switch Profile</button>
        </div>
      </div>

      <div class="profile-section">
        <h2 class="profile-section-title">Listening Stats</h2>
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-value">${formatHours(stats.totalListenedSeconds)}</div>
            <div class="stat-label">Total Time Listened</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${formatHours(stats.totalSkippedSeconds)}</div>
            <div class="stat-label">Time Saved by Skipping</div>
          </div>
        </div>
      </div>

      <div class="profile-section">
        <h2 class="profile-section-title">Playback Settings</h2>
        <form id="form-playback-settings">
          <div class="form-group row align-center mb-3">
            <label class="form-label" style="width: 150px;">Skip Back (seconds)</label>
            <input type="number" id="setting-skip-back" class="form-control" value="${settings.skipBack}" style="width: 80px;" min="5" max="60">
          </div>
          <div class="form-group row align-center mb-4">
            <label class="form-label" style="width: 150px;">Skip Forward (seconds)</label>
            <input type="number" id="setting-skip-forward" class="form-control" value="${settings.skipForward}" style="width: 80px;" min="5" max="120">
          </div>
          <button type="submit" class="btn btn-primary">Save Playback Settings</button>
          <span id="playback-save-msg" class="text-success ml-3 fade" style="opacity:0; transition:opacity 0.3s;">Saved!</span>
        </form>
      </div>

      <div class="profile-section">
        <h2 class="profile-section-title">Podcast Search API</h2>
        <p class="text-secondary mb-4">By default, Podwaffle uses the iTunes Search API. For better results, you can provide a free <a href="https://podcastindex.org/api" target="_blank" style="color:var(--accent-blue);">PodcastIndex.org</a> API key.</p>
        
        <form id="form-api-settings">
          <div class="form-group mb-3">
            <label class="form-label">API Key</label>
            <input type="password" id="setting-api-key" class="form-control" value="${settings.podcastIndexApiKey || ''}" placeholder="Enter API Key">
          </div>
          <div class="form-group mb-4">
            <label class="form-label">API Secret</label>
            <input type="password" id="setting-api-secret" class="form-control" value="${settings.podcastIndexApiSecret || ''}" placeholder="Enter API Secret">
          </div>
          <button type="submit" class="btn btn-outline">Save API Settings</button>
          <span id="api-save-msg" class="text-success ml-3 fade" style="opacity:0; transition:opacity 0.3s;">Saved!</span>
        </form>
      </div>
      
      <div class="profile-section" style="border-bottom: none;">
        <p class="text-muted text-small text-center mt-6">Podwaffle v1.0.0</p>
      </div>
    `;

    // Copy GUID
    document.getElementById('btn-copy-guid').addEventListener('click', (e) => {
      navigator.clipboard.writeText(user.guid).then(() => {
        const btn = e.target;
        btn.textContent = 'Copied!';
        setTimeout(() => btn.textContent = 'Copy', 2000);
      });
    });

    // Switch profile
    document.getElementById('btn-switch-guid').addEventListener('click', async () => {
      const input = document.getElementById('input-switch-guid').value.trim();
      if (!input) return;
      
      try {
        // Validate it exists
        await window.api.getUser(input);
        localStorage.setItem('podwaffle_guid', input);
        window.appState.guid = input;
        window.location.reload(); // Hard reload to apply everywhere
      } catch(err) {
        alert('Invalid GUID or profile not found.');
      }
    });

    // Save Playback settings
    document.getElementById('form-playback-settings').addEventListener('submit', async (e) => {
      e.preventDefault();
      const sb = parseInt(document.getElementById('setting-skip-back').value) || 15;
      const sf = parseInt(document.getElementById('setting-skip-forward').value) || 45;
      
      try {
        await window.api.updateSettings(guid, { skipBack: sb, skipForward: sf });
        if (window.player) {
          window.player.skipBackSeconds = sb;
          window.player.skipForwardSeconds = sf;
          window.player._notifyStateChange(); // Update player bar UI
        }
        const msg = document.getElementById('playback-save-msg');
        msg.style.opacity = 1;
        setTimeout(() => msg.style.opacity = 0, 2000);
      } catch(err) {
        alert('Failed to save settings');
      }
    });

    // Save API settings
    document.getElementById('form-api-settings').addEventListener('submit', async (e) => {
      e.preventDefault();
      const key = document.getElementById('setting-api-key').value.trim();
      const sec = document.getElementById('setting-api-secret').value.trim();
      
      try {
        await window.api.updateSettings(guid, { 
          podcastIndexApiKey: key, 
          podcastIndexApiSecret: sec 
        });
        const msg = document.getElementById('api-save-msg');
        msg.style.opacity = 1;
        setTimeout(() => msg.style.opacity = 0, 2000);
      } catch(err) {
        alert('Failed to save API keys');
      }
    });

  } catch (err) {
    console.error('Failed to load profile:', err);
    contentEl.innerHTML = `<div class="error-state">Failed to load profile.</div>`;
  }
}

window.renderProfile = renderProfile;
