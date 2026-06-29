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

    contentEl.innerHTML = `
      <div class="profile-section">
        <div class="profile-card">
          <label class="profile-label">Your GUID</label>
          <div class="profile-guid-row">
            <input id="profile-guid" class="input" value="${user.guid}" readonly>
            <button id="btn-copy-guid" class="btn btn-outline">Copy</button>
          </div>
          <p class="text-secondary mb-4">Your profile is identified by the GUID below. Enter this GUID on another device to sync your podcasts and progress.</p>
        </div>
      </div>

      <div class="profile-section">
        <h2 class="profile-section-title">Switch Profile</h2>
        <div class="profile-card">
          <label class="profile-label">Existing GUID</label>
          <div class="profile-guid-row field">
            <input id="input-switch-guid" class="input" placeholder="Paste another GUID">
          </div>
            <button id="btn-switch-guid" class="btn btn-outline button is-success">Switch</button>
        </div>
      </div>

      <div class="profile-section">
        <h2 class="profile-section-title">Playback Settings</h2>
        <form id="form-playback-settings" class="profile-card">
          <div class="field">
            <label class="label">Skip back (seconds)</label>
            <input id="setting-skip-back" class="input" type="number" min="0" value="${settings.skipBack || 15}">
          </div>
          <div class="field">
            <label class="label">Skip forward (seconds)</label>
            <input id="setting-skip-forward" class="input" type="number" min="0" value="${settings.skipForward || 45}">
          </div>
          <button type="submit" class="button is-success btn btn-primary">Save</button>
          <div id="playback-save-msg" class="success-banner" style="opacity: 0; margin: 8px 0 0;">Saved</div>
        </form>
      </div>

      <div class="profile-section">
        <h2 class="profile-section-title">Podcast Search API</h2>
        <p class="text-secondary mb-4">By default, Podwaffle uses the iTunes Search API. For better results, you can provide a free <a href="https://podcastindex.org/api" target="_blank" style="color:var(--accent-blue);">PodcastIndex.org</a> API key.</p>
        <form id="form-api-settings" class="profile-card">
          <div class="field">
            <label class="label">PodcastIndex API Key</label>
            <input type="password" id="setting-api-key" class="form-control input" value="${settings.podcastIndexApiKey || ''}" placeholder="Enter API Key">
          </div>
          <div class="field">
            <label class="label">PodcastIndex API Secret</label>
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
