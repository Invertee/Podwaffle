async function renderProfile(container) {
  container.innerHTML = `
    <div class="view-header">
    </div>
    <br>
    <div id="profile-content" class="profile-view">
      <div class="loading-state">
        <div class="spinner spin"></div>
        <p>Loading profile...</p>
      </div>
    </div>
  `;

  const contentEl = document.getElementById('profile-content');
  const guid = window.appState ? window.appState.guid : localStorage.getItem('podwaffle_guid');
  
  try {
    const user = await window.api.getUser(guid);
    const settings = user.settings || {};
    const stats = user.stats || {};
    const progress = user.progress || {};
    const history = Array.isArray(user.history) ? user.history : [];
    const subscriptions = Array.isArray(user.subscriptions) ? user.subscriptions : [];

    const listenedSeconds = Math.max(0, Number(stats.totalListenedSeconds || 0));
    const skippedSeconds = Math.max(0, Number(stats.totalSkippedSeconds || 0));
    const completedEpisodes = Object.values(progress).filter((entry) => entry && entry.played).length;

    const listenedHours = listenedSeconds / 3600;
    const listenedDays = listenedSeconds / 86400;
    const skippedHours = skippedSeconds / 3600;
    const skippedDays = skippedSeconds / 86400;

    const fmt1 = (n) => (Number.isFinite(n) ? n.toFixed(1) : '0.0');
    const fmt2 = (n) => (Number.isFinite(n) ? n.toFixed(2) : '0.00');

    contentEl.innerHTML = `
      <div class="profile-section">
        <h2 class="profile-section-title has-text-light">Listening Stats</h2>
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-value">${fmt1(listenedHours)}</div>
            <div class="stat-label">Hours Listened</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${fmt2(listenedDays)}</div>
            <div class="stat-label">Days Listened</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${fmt1(skippedHours)}</div>
            <div class="stat-label">Hours Skipped</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${fmt2(skippedDays)}</div>
            <div class="stat-label">Days Skipped</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${completedEpisodes}</div>
            <div class="stat-label">Episodes Completed</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${history.length}</div>
            <div class="stat-label">History Entries</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${subscriptions.length}</div>
            <div class="stat-label">Subscribed Podcasts</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${Object.keys(progress).length}</div>
            <div class="stat-label">Episodes Tracked</div>
          </div>
        </div>
      </div>

      <div class="profile-section">
        <div class="profile-card">
        <h2 class="profile-section-title has-text-light">User Profile</h2>

        <div class="field">
          <label class="profile-label">Your GUID</label>
        
          <div class="profile-guid-row">
            <input id="profile-guid" class="input" value="${user.guid}" readonly>
          </div>
          <p class="text-secondary mb-4">Your profile is identified by the GUID below. Enter this GUID on another device to sync your podcasts and progress.</p>
          <br>
          <button id="btn-copy-guid" class="button btn btn-outline">Copy</button>

        </div>



          
        </div>
      </div>

      <div class="profile-section">
        <h2 class="profile-section-title">Switch Profile</h2>
        <div class="profile-card">
        <div class="field">
          <label class="profile-label">Existing GUID</label>
          <div class="profile-guid-row field">
            <input id="input-switch-guid" class="input" placeholder="Paste another GUID">
          </div>
            <button id="btn-switch-guid" class="btn btn-outline button is-success">Switch</button>
        </div>

        </div>
      </div>

      <div class="profile-section">
        <h2 class="profile-section-title has-text-light">Playback Settings</h2>
        <form id="form-playback-settings" class="profile-card">
          <div class="field">
            <label class="label has-text-light">Skip back (seconds)</label>
            <input id="setting-skip-back" class="input" type="number" min="0" value="${settings.skipBack || 15}">
          </div>
          <div class="field">
            <label class="label has-text-light">Skip forward (seconds)</label>
            <input id="setting-skip-forward" class="input" type="number" min="0" value="${settings.skipForward || 45}">
          </div>
          <button type="submit" class="button is-success btn btn-primary">Save</button>
          <div id="playback-save-msg" class="success-banner" style="opacity: 0; margin: 8px 0 0;">Saved</div>
        </form>
      </div>

      <div class="profile-section">
        <h2 class="profile-section-title has-text-light">Podcast Search API</h2>
        <p class="text-secondary mb-4">By default, Podwaffle uses the iTunes Search API. For better results, you can provide a free <a href="https://podcastindex.org/api" target="_blank" style="color:var(--accent-blue);">PodcastIndex.org</a> API key.</p>
        <form id="form-api-settings" class="profile-card">
          <div class="field">
            <label class="label has-text-light">PodcastIndex API Key</label>
            <input type="password" id="setting-api-key" class="form-control input" value="${settings.podcastIndexApiKey || ''}" placeholder="Enter API Key">
          </div>
          <div class="field">
            <label class="label has-text-light">PodcastIndex API Secret</label>
            <input type="password" id="setting-api-secret" class="form-control input" value="${settings.podcastIndexApiSecret || ''}" placeholder="Enter API Secret">
          </div>
          <button type="submit" class="btn button is-success btn-primary">Save</button>
          <div id="api-save-msg" class="success-banner" style="opacity: 0; margin: 8px 0 0;">Saved!</div>
        </form>
      </div>
    `;

    document.getElementById('btn-copy-guid').addEventListener('click', async (e) => {
      const text = document.getElementById('profile-guid').value;
      await navigator.clipboard.writeText(text);
      const btn = e.target;
      btn.textContent = 'Copied!';
      setTimeout(() => btn.textContent = 'Copy', 2000);
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
        window.location.reload();
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
          window.player.skipBackSecs = sb;
          window.player.skipForwardSecs = sf;
          window.player._notifyStateChange();
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
