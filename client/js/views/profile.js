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
  const formatDateTime = (value) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString();
  };

  const profileSyncState = (() => {
    try {
      const raw = localStorage.getItem('podwaffle_profile_sync_state');
      return raw ? JSON.parse(raw) : {};
    } catch (_) {
      return {};
    }
  })();
  
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
        <h2 class="profile-section-title has-text-light">Server Connection</h2>
        <form id="form-server-connection" class="profile-card">
          <div class="field">
            <label class="checkbox has-text-light">
              <input id="setting-server-enabled" type="checkbox">
              Enable backend sync
            </label>
          </div>
          <div id="server-connection-fields" style="display: none; margin-top: 16px;">
        
          <div class="field">
            <label class="label has-text-light">Server URL or IP</label>
            <input id="setting-server-host" class="input" value="${window.api.getServerConnectionConfig().host || ''}" placeholder="e.g. 192.168.1.50 or podwaffle.local">
          </div>
          <div class="field">
            <label class="label has-text-light">Port</label>
            <input id="setting-server-port" class="input" type="number" min="1" max="65535" value="${window.api.getServerConnectionConfig().port || '3000'}" placeholder="3000">
          </div>
          <div class="field">
            <label class="checkbox has-text-light">
              <input id="setting-server-secure" type="checkbox" ${window.api.getServerConnectionConfig().secure ? 'checked' : ''}>
              Use HTTPS/WSS
            </label>
          </div>
          <div class="profile-guid-row" style="gap: 8px; flex-wrap: wrap;">
            <button type="submit" id="btn-connect-server" class="button is-success btn btn-primary">Connect</button>
            <button type="button" id="btn-test-server" class="button btn btn-outline">Test</button>
            <button type="button" id="btn-disconnect-server" class="button btn btn-outline">Disconnect</button>
          </div>
          <div id="server-connection-msg" class="success-banner" style="display: none; margin: 12px 0 0;"></div>
          <div id="server-connection-err" class="error-banner" style="display: none; margin: 12px 0 0;"></div>
          </div>
        </form>
      </div>

      <div class="profile-section">
        <h2 class="profile-section-title has-text-light">Connection & Sync Health</h2>
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-value" id="conn-mode">${window.api.getServerConnectionConfig().enabled ? 'Connected' : 'Local'}</div>
            <div class="stat-label">Client Mode</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" id="conn-latency">—</div>
            <div class="stat-label">Latency</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" id="conn-ws">${window.castClient && window.castClient.ws && window.castClient.ws.readyState === WebSocket.OPEN ? 'Open' : 'Closed'}</div>
            <div class="stat-label">WebSocket</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" id="conn-last-check">${formatDateTime(profileSyncState.lastCheckAt)}</div>
            <div class="stat-label">Last Check</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" id="conn-last-sync">${formatDateTime(profileSyncState.lastProfileSyncAt)}</div>
            <div class="stat-label">Last Profile Sync</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" id="conn-target">${window.api.getServerConnectionConfig().enabled && window.api.getServerConnectionConfig().host ? `${window.api.getServerConnectionConfig().host}${window.api.getServerConnectionConfig().port ? ':' + window.api.getServerConnectionConfig().port : ''}` : '—'}</div>
            <div class="stat-label">Target Server</div>
          </div>
        </div>
        
        <h2 class="profile-section-title has-text-light">Sync & Data</h2>
        <div class="profile-card">
          <div class="field">
            <p class="text-secondary mb-4">Sync your subscriptions, listening progress, and stats with the connected server.</p>
            <div class="profile-guid-row" style="gap: 8px; flex-wrap: wrap;">
              <button id="btn-sync-now" class="button is-success btn btn-primary">Sync Now</button>
              <button type="button" id="btn-clear-local-data" class="button btn btn-outline">Clear Local Data</button>
            </div>
            <div id="sync-progress" style="display: none; margin-top: 12px;">
              <div class="spinner spin" style="display: inline-block; margin-right: 8px;"></div>
              <span id="sync-progress-text">Syncing...</span>
            </div>
            <div id="sync-result-msg" class="success-banner" style="display: none; margin: 12px 0 0;"></div>
            <div id="sync-result-err" class="error-banner" style="display: none; margin: 12px 0 0;"></div>
          </div>
          <div id="sync-details" style="display: none; margin-top: 16px;">
            <h3 class="text-secondary" style="font-size: 12px; font-weight: 600; text-transform: uppercase; margin-bottom: 8px;">Sync Summary</h3>
            <div style="font-size: 13px; color: var(--text-secondary); line-height: 1.6;">
              <div>✓ Subscriptions: <span id="sync-subs-added">0</span> added</div>
              <div>✓ Progress: <span id="sync-progress-merged">0</span> entries merged</div>
              <div>✓ Stats: merged</div>
              <div style="margin-top: 8px; font-size: 12px; color: var(--text-muted);">Completed in <span id="sync-duration-ms">0</span>ms</div>
            </div>
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

    `;

    document.getElementById('btn-copy-guid').addEventListener('click', async (e) => {
      const text = document.getElementById('profile-guid').value;
      await navigator.clipboard.writeText(text);
      const btn = e.target;
      btn.textContent = 'Copied!';
      setTimeout(() => btn.textContent = 'Copy', 2000);
    });

    const connectionMsg = document.getElementById('server-connection-msg');
    const connectionErr = document.getElementById('server-connection-err');
    const updateHealthCards = (status, extra = {}) => {
      const modeEl = document.getElementById('conn-mode');
      const latencyEl = document.getElementById('conn-latency');
      const wsEl = document.getElementById('conn-ws');
      const lastCheckEl = document.getElementById('conn-last-check');
      const lastSyncEl = document.getElementById('conn-last-sync');
      const targetEl = document.getElementById('conn-target');
      const cfg = window.api.getServerConnectionConfig();
      if (modeEl) modeEl.textContent = cfg.enabled ? (status && status.ok ? 'Connected' : 'Configured') : 'Local';
      if (latencyEl) latencyEl.textContent = status && status.latencyMs != null ? `${status.latencyMs}ms` : '—';
      if (wsEl) wsEl.textContent = window.castClient && window.castClient.ws && window.castClient.ws.readyState === WebSocket.OPEN ? 'Open' : 'Closed';
      if (lastCheckEl) lastCheckEl.textContent = formatDateTime(extra.lastCheckAt || (status && status.checkedAt));
      if (lastSyncEl) lastSyncEl.textContent = formatDateTime(extra.lastProfileSyncAt || profileSyncState.lastProfileSyncAt);
      if (targetEl) targetEl.textContent = cfg.enabled && cfg.host ? `${cfg.host}${cfg.port ? ':' + cfg.port : ''}` : '—';
    };

    const showConnectionMessage = (message, isError = false) => {
      connectionMsg.style.display = isError ? 'none' : 'block';
      connectionErr.style.display = isError ? 'block' : 'none';
      if (isError) {
        connectionErr.textContent = message;
      } else {
        connectionMsg.textContent = message;
      }
    };

    const runHealthCheck = async () => {
      const health = await window.api.checkConnectionHealth();
      const nextSyncState = {
        ...profileSyncState,
        lastCheckAt: health.checkedAt || new Date().toISOString(),
      };
      localStorage.setItem('podwaffle_profile_sync_state', JSON.stringify(nextSyncState));
      updateHealthCards(health, nextSyncState);
      return health;
    };

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

    document.getElementById('form-server-connection').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!serverEnabledCheckbox.checked) {
        window.api.clearServerConnectionConfig();
        document.getElementById('sync-data-section').style.display = 'none';
        if (window.castClient) {
          window.castClient.disconnect();
          window.castClient.connect();
        }
        showConnectionMessage('Backend sync is disabled. Enable it to connect to a server.');
        updateHealthCards({ ok: true, checkedAt: new Date().toISOString() }, { lastCheckAt: new Date().toISOString() });
        return;
      }

      const host = document.getElementById('setting-server-host').value.trim();
      const port = document.getElementById('setting-server-port').value.trim();
      const secure = document.getElementById('setting-server-secure').checked;

      if (!host) {
        showConnectionMessage('Please enter a server URL or IP address.', true);
        return;
      }

      window.api.saveServerConnectionConfig({
        enabled: true,
        host,
        port,
        secure,
      });

      try {
        const health = await runHealthCheck();
        if (!health.ok) {
          showConnectionMessage(`Connection test failed: ${health.message}`, true);
          return;
        }

        await window.api.getUser(guid);
        const syncState = {
          ...(JSON.parse(localStorage.getItem('podwaffle_profile_sync_state') || '{}')),
          lastProfileSyncAt: new Date().toISOString(),
        };
        localStorage.setItem('podwaffle_profile_sync_state', JSON.stringify(syncState));
        updateHealthCards(health, syncState);

        if (window.castClient) {
          window.castClient.disconnect();
          window.castClient.connect();
        }

        document.getElementById('sync-data-section').style.display = 'block';
        showConnectionMessage('Connected to server and profile verified.');
      } catch (err) {
        showConnectionMessage(`Connected to server, but profile check failed: ${err.message}`, true);
      }
    });

    document.getElementById('btn-test-server').addEventListener('click', async () => {
      const health = await runHealthCheck();
      if (health.ok) {
        showConnectionMessage(`Connection healthy${health.latencyMs != null ? ` (${health.latencyMs}ms)` : ''}.`);
      } else {
        showConnectionMessage(`Connection failed: ${health.message}`, true);
      }
    });

    document.getElementById('btn-disconnect-server').addEventListener('click', () => {
      window.api.clearServerConnectionConfig();
      const syncState = {
        ...(JSON.parse(localStorage.getItem('podwaffle_profile_sync_state') || '{}')),
        lastCheckAt: new Date().toISOString(),
      };
      localStorage.setItem('podwaffle_profile_sync_state', JSON.stringify(syncState));
      updateHealthCards({ ok: true, checkedAt: syncState.lastCheckAt }, syncState);
      if (window.castClient) {
        window.castClient.disconnect();
        window.castClient.connect();
      }
      showConnectionMessage('Disconnected from remote server. Client is now in local mode.');
      document.getElementById('sync-data-section').style.display = 'none';
    });

    runHealthCheck().catch(() => {});

    // ─ Sync handlers
    const updateSyncUI = (isVisible, isLoading, resultMsg, isError, detailsObj) => {
      const progressEl = document.getElementById('sync-progress');
      const resultEl = !isError ? document.getElementById('sync-result-msg') : document.getElementById('sync-result-err');
      const detailsEl = document.getElementById('sync-details');
      const otherResultEl = isError ? document.getElementById('sync-result-msg') : document.getElementById('sync-result-err');

      if (progressEl) progressEl.style.display = isLoading ? 'block' : 'none';
      if (otherResultEl) otherResultEl.style.display = 'none';
      if (resultEl) {
        resultEl.textContent = resultMsg;
        resultEl.style.display = resultMsg ? 'block' : 'none';
      }

      if (detailsObj && detailsEl) {
        document.getElementById('sync-subs-added').textContent = detailsObj.subscriptionsAdded || 0;
        document.getElementById('sync-progress-merged').textContent = detailsObj.progressMerged || 0;
        document.getElementById('sync-duration-ms').textContent = detailsObj.durationMs || 0;
        detailsEl.style.display = resultMsg && !isError ? 'block' : 'none';
      }
    };

    const syncBtn = document.getElementById('btn-sync-now');
    if (syncBtn) {
      syncBtn.addEventListener('click', async () => {
        if (!window.syncManager || !guid) return;

        syncBtn.disabled = true;
        updateSyncUI(true, true, '', false, null);

        try {
          const result = await window.syncManager.performSync(guid);

          if (result.ok) {
            const nextSyncState = {
              ...(JSON.parse(localStorage.getItem('podwaffle_profile_sync_state') || '{}')),
              lastProfileSyncAt: result.endedAt,
              lastSyncDataSummary: result.changes,
            };
            localStorage.setItem('podwaffle_profile_sync_state', JSON.stringify(nextSyncState));

            const msg = `Sync completed. ${result.changes.subscriptionsAdded.length} subscription(s), ${result.changes.progressMerged} progress entry(ies) merged.`;
            updateSyncUI(true, false, msg, false, {
              subscriptionsAdded: result.changes.subscriptionsAdded.length,
              progressMerged: result.changes.progressMerged,
              durationMs: result.durationMs,
            });

            if (window.appState.user) {
              window.appState.user.subscriptions = window.appState.subscriptions;
              window.appState.user.progress = window.appState.progress;
            }
          } else {
            const errMsg = result.errors && result.errors.length > 0
              ? `Sync failed: ${result.errors[0]}`
              : 'Sync failed';
            updateSyncUI(true, false, errMsg, true, null);
          }
        } catch (err) {
          updateSyncUI(true, false, `Sync error: ${err.message}`, true, null);
        } finally {
          syncBtn.disabled = false;
        }
      });
    }

    const clearDataBtn = document.getElementById('btn-clear-local-data');
    if (clearDataBtn) {
      clearDataBtn.addEventListener('click', () => {
        const confirmed = confirm(
          'This will delete all local subscriptions, progress, and stats. Your profile on any connected server will not be affected.\n\nContinue?'
        );
        if (!confirmed) return;

        try {
          if (window.appState) {
            window.appState.subscriptions = [];
            window.appState.progress = {};
            if (window.appState.user) {
              window.appState.user.subscriptions = [];
              window.appState.user.progress = {};
              window.appState.user.stats = { totalListenedSeconds: 0, totalSkippedSeconds: 0 };
            }
          }

          if (window.cacheManager && typeof window.cacheManager.clearAll === 'function') {
            window.cacheManager.clearAll();
          }

          updateSyncUI(false, false, 'Local data cleared. Reload the app to see changes.', false, null);
          clearDataBtn.disabled = true;
        } catch (err) {
          updateSyncUI(false, false, `Failed to clear data: ${err.message}`, true, null);
        }
      });
    }

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

    // Save Server settings
    const serverEnabledCheckbox = document.getElementById('setting-server-enabled');
    const serverConfigFields = document.getElementById('server-connection-fields');
    const serverHostInput = document.getElementById('setting-server-host');
    const serverPortInput = document.getElementById('setting-server-port');
    const serverSecureCheckbox = document.getElementById('setting-server-secure');

    // Load current server config
    const currentServerConfig = window.api.getServerConnectionConfig();
    if (currentServerConfig && currentServerConfig.enabled) {
      serverEnabledCheckbox.checked = true;
      serverConfigFields.style.display = 'block';
      serverHostInput.value = currentServerConfig.host || '';
      serverPortInput.value = currentServerConfig.port || '';
      serverSecureCheckbox.checked = currentServerConfig.secure || false;
    }

    if (!currentServerConfig || !currentServerConfig.enabled) {
      serverConfigFields.style.display = 'none';
    }

    // Toggle fields when checkbox changes
    serverEnabledCheckbox.addEventListener('change', (e) => {
      serverConfigFields.style.display = e.target.checked ? 'block' : 'none';
    });

  } catch (err) {
    console.error('Failed to load profile:', err);
    contentEl.innerHTML = `<div class="error-state">Failed to load profile.</div>`;
  }
}

window.renderProfile = renderProfile;
