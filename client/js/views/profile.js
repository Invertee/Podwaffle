async function renderProfile(container) {
  const guid = window.appState?.guid || localStorage.getItem('podwaffle_guid');
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[char]);
  const formatDateTime = (value) => {
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : '—';
  };

  container.innerHTML = '<div class="loading-state"><div class="spinner spin"></div><p>Loading admin...</p></div>';

  try {
    const [user, profilesResult, diagnostics] = await Promise.all([
      window.api.getUser(guid),
      window.api.getProfiles().catch(() => ({ profiles: [{ id: guid, name: window.appState?.user?.name || guid }] })),
      window.api.getAdminStatus().catch(() => null),
    ]);
    const profiles = profilesResult?.profiles || [];
    const settings = user.settings || {};
    const stats = user.stats || {};
    const progress = user.progress || {};
    const history = Array.isArray(user.history) ? user.history : [];
    const subscriptions = Array.isArray(user.subscriptions) ? user.subscriptions : [];
    const config = window.api.getServerConnectionConfig();
    const transport = window.castClient?.getTransportStatus?.() || { method: 'offline', connected: false };
    const firebase = window.firebaseSync?.getStatus?.() || { available: false, registered: false };
    const cache = window.offlineStore?.getStatus?.() || { queuedMutations: 0, source: 'cache' };
    const serverProfile = diagnostics?.profiles?.find((profile) => profile.id === guid);
    const notificationProfile = diagnostics?.notifications?.profiles?.[guid];
    const session = user.playbackSession || null;
    const listenedSeconds = Math.max(0, Number(stats.totalListenedSeconds || 0));
    const skippedSeconds = Math.max(0, Number(stats.totalSkippedSeconds || 0));
    const completedEpisodes = Object.values(progress).filter((entry) => entry?.played).length;
    const events = (diagnostics?.events || []).filter((event) => !event.profileId || event.profileId === guid).slice(0, 12);

    container.innerHTML = `
      <div class="view-header"></div><br>
      <div class="profile-view">
        <div class="profile-section">
          <h2 class="profile-section-title has-text-light">Listening Stats</h2>
          <div class="stats-grid">
            <div class="stat-card"><div class="stat-value">${(listenedSeconds / 3600).toFixed(1)}</div><div class="stat-label">Hours Listened</div></div>
            <div class="stat-card"><div class="stat-value">${(skippedSeconds / 3600).toFixed(1)}</div><div class="stat-label">Hours Skipped</div></div>
            <div class="stat-card"><div class="stat-value">${completedEpisodes}</div><div class="stat-label">Episodes Completed</div></div>
            <div class="stat-card"><div class="stat-value">${subscriptions.length}</div><div class="stat-label">Subscriptions</div></div>
            <div class="stat-card"><div class="stat-value">${history.length}</div><div class="stat-label">History Entries</div></div>
          </div>
        </div>

        <div class="profile-section">
          <h2 class="profile-section-title has-text-light">Active Profile</h2>
          <div class="profile-card">
            <div class="field"><label class="label has-text-light">Profile</label><input class="input" value="${escapeHtml(user.name || guid)}" readonly></div>
            <div class="field"><label class="label has-text-light">Profile ID</label><input class="input" value="${escapeHtml(guid)}" readonly></div>
            <div class="field">
              <label class="label has-text-light">Switch profile</label>
              <select id="profile-switch" class="input">${profiles.map((profile) => `<option value="${escapeHtml(profile.id)}" ${profile.id === guid ? 'selected' : ''}>${escapeHtml(profile.name)}</option>`).join('')}</select>
            </div>
            <button id="profile-switch-button" class="button is-success">Switch</button>
          </div>
        </div>

        <div class="profile-section">
          <h2 class="profile-section-title has-text-light">Server Connection</h2>
          <form id="server-form" class="profile-card">
            <div class="field"><label class="label has-text-light">Server URL</label><input id="server-url" class="input" value="${escapeHtml(config.baseUrl || '')}" placeholder="Blank when opened from the add-on"></div>
            <div class="field"><label class="label has-text-light">Access key</label><input id="server-key" class="input" type="password" placeholder="${config.accessKey ? 'Saved — enter to replace' : 'Configured in the add-on'}"></div>
            <div class="profile-guid-row" style="gap:8px;flex-wrap:wrap">
              <button class="button is-success" type="submit">Save & reconnect</button>
              <button class="button btn btn-outline" id="server-test" type="button">Test</button>
              <button class="button btn btn-outline" id="sync-now" type="button">Sync now</button>
            </div>
            <div id="server-message" class="success-banner" style="display:none;margin-top:12px"></div>
          </form>
        </div>

        <div class="profile-section">
          <h2 class="profile-section-title has-text-light">Connection & Sync Health</h2>
          <div class="stats-grid">
            <div class="stat-card"><div class="stat-value" id="admin-transport">${escapeHtml(transport.method)}</div><div class="stat-label">Client transport</div></div>
            <div class="stat-card"><div class="stat-value">${transport.connected ? 'Open' : 'Closed'}</div><div class="stat-label">WebSocket</div></div>
            <div class="stat-card"><div class="stat-value">${firebase.registered ? 'Registered' : (firebase.available ? 'Available' : 'Unavailable')}</div><div class="stat-label">Firebase</div></div>
            <div class="stat-card"><div class="stat-value">${notificationProfile?.registeredDevices || 0}</div><div class="stat-label">Push devices</div></div>
            <div class="stat-card"><div class="stat-value">${cache.queuedMutations || 0}</div><div class="stat-label">Offline changes</div></div>
            <div class="stat-card"><div class="stat-value">${serverProfile?.sync?.userRevision ?? '—'}</div><div class="stat-label">Sync revision</div></div>
            <div class="stat-card"><div class="stat-value">${escapeHtml(formatDateTime(serverProfile?.sync?.lastChangedAt))}</div><div class="stat-label">Last server change</div></div>
            <div class="stat-card"><div class="stat-value">${escapeHtml(session?.mode || 'idle')}</div><div class="stat-label">Player mode</div></div>
            <div class="stat-card"><div class="stat-value">${escapeHtml(session?.ownerClientId || session?.clientId || 'None')}</div><div class="stat-label">Session owner</div></div>
          </div>
        </div>

        <div class="profile-section">
          <h2 class="profile-section-title has-text-light">Playback Log</h2>
          <div class="profile-card">
            ${events.length ? events.map((event) => `<div style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,.08)"><strong>${escapeHtml(event.type)}</strong><div class="text-secondary">${escapeHtml(formatDateTime(event.at))} · ${escapeHtml(event.episodeGuid || event.clientId || event.ownerClientId || '')}</div></div>`).join('') : '<p class="text-secondary">No recent server session events.</p>'}
          </div>
        </div>

        <div class="profile-section">
          <h2 class="profile-section-title has-text-light">Playback Settings</h2>
          <form id="playback-form" class="profile-card">
            <div class="field"><label class="label has-text-light">Skip back (seconds)</label><input id="skip-back" class="input" type="number" min="0" value="${Number(settings.skipBack || 15)}"></div>
            <div class="field"><label class="label has-text-light">Skip forward (seconds)</label><input id="skip-forward" class="input" type="number" min="0" value="${Number(settings.skipForward || 45)}"></div>
            <button class="button is-success" type="submit">Save</button>
          </form>
        </div>
      </div>`;

    const showMessage = (text, error = false) => {
      const element = document.getElementById('server-message');
      element.textContent = text;
      element.className = error ? 'error-banner' : 'success-banner';
      element.style.display = 'block';
    };

    document.getElementById('profile-switch-button').addEventListener('click', () => {
      const next = document.getElementById('profile-switch').value;
      if (!next || next === guid) return;
      window.player?.pause?.();
      localStorage.setItem('podwaffle_guid', next);
      window.location.reload();
    });

    document.getElementById('server-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const nextKey = document.getElementById('server-key').value;
      window.api.saveServerConnectionConfig({
        baseUrl: document.getElementById('server-url').value.trim(),
        accessKey: nextKey || config.accessKey,
      });
      const health = await window.api.checkConnectionHealth();
      if (!health.ok) return showMessage(health.message, true);
      window.castClient?.disconnect?.();
      window.castClient?.connect?.();
      showMessage(`Connected in ${health.latencyMs}ms.`);
    });

    document.getElementById('server-test').addEventListener('click', async () => {
      const health = await window.api.checkConnectionHealth();
      showMessage(health.ok ? `Connected in ${health.latencyMs}ms.` : health.message, !health.ok);
    });

    document.getElementById('sync-now').addEventListener('click', async () => {
      try {
        await window.offlineStore?.flushOutbox?.();
        await window.offlineStore?.refreshProfile?.(guid);
        window.castClient?.requestSync?.('admin-sync');
        showMessage('Profile is up to date.');
      } catch (err) {
        showMessage(err.message || 'Sync failed.', true);
      }
    });

    document.getElementById('playback-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const next = {
        skipBack: Math.max(0, Number(document.getElementById('skip-back').value) || 15),
        skipForward: Math.max(0, Number(document.getElementById('skip-forward').value) || 45),
      };
      await window.api.updateSettings(guid, next);
      if (window.player) {
        window.player.skipBackSecs = next.skipBack;
        window.player.skipForwardSecs = next.skipForward;
      }
    });
  } catch (err) {
    container.innerHTML = `<div class="error-state"><h2>Admin unavailable</h2><p>${escapeHtml(err.message || err)}</p></div>`;
  }
}

window.renderProfile = renderProfile;
