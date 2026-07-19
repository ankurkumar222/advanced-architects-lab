/**
 * audio-sync.js — shared audio panel + GitHub sync logic
 *
 * Usage in each HTML note:
 *   <script>
 *   window.ALAB_PAGE_CONFIG = {
 *     storageKey: 'alab_audio_data_my_note_v1',
 *     metaKey:    'alab_audio_meta_my_note_v1',
 *     topicIds:   ['s1','s2','s3'],
 *     ghPath:     'audio-data/my_note.json'
 *   };
 *   </script>
 *   <script src="../audio-sync.js"></script>
 *
 * The script injects the sync-bar and GitHub-settings modal into the
 * DOM automatically, so no extra HTML is needed in the note file.
 */
(function () {
  'use strict';

  var cfg   = window.ALAB_PAGE_CONFIG || {};
  var AUDIO_KEY  = cfg.storageKey || 'alab_audio_data_default_v1';
  var META_KEY   = cfg.metaKey   || 'alab_audio_meta_default_v1';
  var GH_CFG_KEY = 'alab_gh_config_v1';
  var GH_TOK_SS  = 'alab_gh_token_session';
  var GH_TOK_LS  = 'alab_gh_token_local';
  var TOPIC_IDS  = cfg.topicIds  || [];
  var DEFAULT_GH_PATH = cfg.ghPath || 'audio-data/notes.json';

  /* ── Inject fixed UI into the page ──────────────────────────── */
  function injectUI() {
    var html = [
      '<div id="sync-bar">',
      '  <button id="sync-btn" onclick="window._alab.handleSync()">&#x21EA; Sync to GitHub</button>',
      '  <button id="load-btn" onclick="window._alab.handleLoad()" title="Load recordings from GitHub into this browser">&#x2193; Load from GitHub</button>',
      '  <span id="sync-status" class="sync-status">no local changes</span>',
      '  <button id="sync-settings-btn" title="GitHub sync settings" onclick="window._alab.openSettings()">&#9881;</button>',
      '</div>',
      '<div id="gh-modal-overlay" class="gh-modal-overlay" style="display:none">',
      '  <div class="gh-modal">',
      '    <h3>GitHub Sync Settings</h3>',
      '    <label>Owner<input id="gh-owner" type="text" placeholder="e.g. ankurkumar222"></label>',
      '    <label>Repo<input id="gh-repo" type="text" placeholder="e.g. advanced-architects-lab"></label>',
      '    <label>Branch<input id="gh-branch" type="text" value="main"></label>',
      '    <label>File path<input id="gh-path" type="text" placeholder="audio-data/notes.json"></label>',
      '    <label>Personal Access Token<input id="gh-token" type="password" placeholder="ghp_..."></label>',
      '    <label class="gh-remember"><input id="gh-remember" type="checkbox"> Remember token on this device</label>',
      '    <p class="gh-note">Token is used only from this page to call the GitHub API directly.',
      '      Use a token scoped to just this repo\'s contents.</p>',
      '    <div class="gh-modal-actions">',
      '      <button onclick="window._alab.closeSettings()">Cancel</button>',
      '      <button class="primary" onclick="window._alab.saveSettings()">Save</button>',
      '    </div>',
      '    <p id="gh-modal-msg" class="gh-modal-msg"></p>',
      '  </div>',
      '</div>'
    ].join('\n');
    var el = document.createElement('div');
    el.innerHTML = html;
    while (el.firstChild) document.body.appendChild(el.firstChild);
  }

  /* ── Storage helpers ─────────────────────────────────────────── */
  function loadData() {
    try { return JSON.parse(localStorage.getItem(AUDIO_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function saveData(data) {
    localStorage.setItem(AUDIO_KEY, JSON.stringify(data));
    markDirty();
  }
  function loadMeta() {
    try { return JSON.parse(localStorage.getItem(META_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function saveMeta(m) { localStorage.setItem(META_KEY, JSON.stringify(m)); }
  function markDirty() {
    var m = loadMeta(); m.dirty = true; saveMeta(m); updateSyncStatus();
  }

  function getTopicAudios(id) { return loadData()[id] || []; }
  function setTopicAudios(id, list) {
    var data = loadData(); data[id] = list; saveData(data);
  }
  function uid() { return 'a_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36); }

  /* ── Google Drive helpers ────────────────────────────────────── */
  function extractFileId(url) {
    if (!url) return null;
    url = url.trim();
    var m = url.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
    if (m) return m[1];
    m = url.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
    if (m) return m[1];
    if (/^[a-zA-Z0-9_-]{15,}$/.test(url)) return url;
    return null;
  }

  function esc(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ── Render ──────────────────────────────────────────────────── */
  function renderPanel(topicId) {
    var container = document.getElementById('audio-panel-' + topicId);
    if (!container) return;
    var list = getTopicAudios(topicId);

    var html = '<div class="audio-panel-head">'
             + '<span class="audio-panel-title">&#127911; Audio Recordings</span>'
             + '<span class="audio-count">' + list.length + '</span>'
             + '</div>'
             + '<div class="audio-list">';

    if (list.length === 0) {
      html += '<p class="audio-empty">No recordings yet — paste a Google Drive share link below.</p>';
    } else {
      list.forEach(function (item, idx) {
        html += renderItem(topicId, item, idx, list.length);
      });
    }
    html += '</div>' + renderAddForm(topicId);
    container.innerHTML = html;
  }

  function renderItem(topicId, item, idx, total) {
    var fileId = item.fileId || extractFileId(item.url);
    var src    = fileId ? 'https://drive.google.com/file/d/' + fileId + '/preview' : null;
    var link   = fileId ? 'https://drive.google.com/file/d/' + fileId + '/view'    : (item.url || '#');
    var tid    = esc(topicId);
    var iid    = esc(item.id);
    var title  = esc(item.title || '');

    var player = src
      ? '<iframe class="audio-drive-frame" src="' + src + '" allow="autoplay" loading="lazy"'
        + ' title="' + (title || 'audio player') + '"'
        + ' sandbox="allow-scripts allow-same-origin allow-popups allow-forms"></iframe>'
        + '<div class="audio-frame-row">'
        + '<span class="audio-frame-note">Sign in to Google Drive to play private files.</span>'
        + '<a class="audio-open-link" href="' + link + '" target="_blank" rel="noopener">&#8599; Open in Drive</a>'
        + '</div>'
      : '<div class="audio-fallback">&#9888; Could not read a Drive file ID &mdash; '
        + '<a href="#" onclick="window._alab.editUrl(\'' + tid + '\',\'' + iid + '\');return false">edit link</a></div>';

    return '<div class="audio-item" data-id="' + iid + '">'
      + '<div class="audio-item-top">'
      + '<input type="text" class="audio-title-input" value="' + title + '" placeholder="Untitled recording"'
      + ' onchange="window._alab.updateTitle(\'' + tid + '\',\'' + iid + '\',this.value)">'
      + '<div class="audio-item-actions">'
      + '<button class="ai-btn" title="Move up"   ' + (idx === 0           ? 'disabled' : '') + ' onclick="window._alab.move(\'' + tid + '\',\'' + iid + '\',-1)">&#8593;</button>'
      + '<button class="ai-btn" title="Move down" ' + (idx === total - 1   ? 'disabled' : '') + ' onclick="window._alab.move(\'' + tid + '\',\'' + iid + '\',1)">&#8595;</button>'
      + '<button class="ai-btn" title="Edit link" onclick="window._alab.editUrl(\'' + tid + '\',\'' + iid + '\')">&#9998;</button>'
      + '<button class="ai-btn danger" title="Delete" onclick="window._alab.del(\'' + tid + '\',\'' + iid + '\')">&#10005;</button>'
      + '</div></div>'
      + player
      + '</div>';
  }

  function renderAddForm(topicId) {
    var tid = esc(topicId);
    return '<div class="audio-add">'
      + '<input type="text" class="audio-add-title" id="add-title-' + tid + '" placeholder="Label (optional)">'
      + '<input type="text" class="audio-add-url" id="add-url-' + tid + '" placeholder="Paste Google Drive share link"'
      + ' onkeydown="if(event.key===\'Enter\')window._alab.add(\'' + tid + '\')">'
      + '<button class="audio-add-btn" onclick="window._alab.add(\'' + tid + '\')">+ Add recording</button>'
      + '</div>';
  }

  /* ── CRUD ────────────────────────────────────────────────────── */
  function addAudio(topicId) {
    var titleEl = document.getElementById('add-title-' + topicId);
    var urlEl   = document.getElementById('add-url-'   + topicId);
    var url = urlEl.value.trim();
    if (!url) { urlEl.focus(); return; }
    var fileId = extractFileId(url);
    if (!fileId) { alert('Could not find a Google Drive file ID. Paste the full share link from Drive.'); return; }
    var list = getTopicAudios(topicId);
    list.push({ id: uid(), title: titleEl.value.trim(), url: url, fileId: fileId });
    setTopicAudios(topicId, list);
    renderPanel(topicId);
  }
  function updateTitle(topicId, id, value) {
    var list = getTopicAudios(topicId);
    var item = list.find(function (a) { return a.id === id; });
    if (item) { item.title = value; setTopicAudios(topicId, list); }
  }
  function editUrl(topicId, id) {
    var list = getTopicAudios(topicId);
    var item = list.find(function (a) { return a.id === id; });
    if (!item) return;
    var newUrl = prompt('Google Drive share link:', item.url || '');
    if (newUrl === null) return;
    var fileId = extractFileId(newUrl.trim());
    if (!fileId) { alert('Could not find a Google Drive file ID in that link.'); return; }
    item.url = newUrl.trim(); item.fileId = fileId;
    setTopicAudios(topicId, list);
    renderPanel(topicId);
  }
  function delAudio(topicId, id) {
    if (!confirm('Delete this recording? Changes stay local until you click Sync.')) return;
    setTopicAudios(topicId, getTopicAudios(topicId).filter(function (a) { return a.id !== id; }));
    renderPanel(topicId);
  }
  function moveAudio(topicId, id, dir) {
    var list = getTopicAudios(topicId);
    var idx  = list.findIndex(function (a) { return a.id === id; });
    var to   = idx + dir;
    if (idx === -1 || to < 0 || to >= list.length) return;
    var item = list.splice(idx, 1)[0];
    list.splice(to, 0, item);
    setTopicAudios(topicId, list);
    renderPanel(topicId);
  }

  /* ── GitHub sync ─────────────────────────────────────────────── */
  function loadGhConfig() {
    try { return JSON.parse(localStorage.getItem(GH_CFG_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function getToken() {
    return sessionStorage.getItem(GH_TOK_SS) || localStorage.getItem(GH_TOK_LS) || '';
  }
  function openSettings() {
    var c = loadGhConfig();
    document.getElementById('gh-owner').value   = c.owner  || '';
    document.getElementById('gh-repo').value    = c.repo   || '';
    document.getElementById('gh-branch').value  = c.branch || 'main';
    document.getElementById('gh-path').value    = c.path   || DEFAULT_GH_PATH;
    document.getElementById('gh-token').value   = getToken();
    document.getElementById('gh-remember').checked = !!localStorage.getItem(GH_TOK_LS);
    document.getElementById('gh-modal-msg').textContent = '';
    document.getElementById('gh-modal-overlay').style.display = 'flex';
  }
  function closeSettings() {
    document.getElementById('gh-modal-overlay').style.display = 'none';
  }
  function saveSettings() {
    var c = {
      owner:  document.getElementById('gh-owner').value.trim(),
      repo:   document.getElementById('gh-repo').value.trim(),
      branch: document.getElementById('gh-branch').value.trim() || 'main',
      path:   document.getElementById('gh-path').value.trim()
    };
    if (!c.owner || !c.repo || !c.path) {
      document.getElementById('gh-modal-msg').textContent = 'Owner, repo, and file path are required.';
      return;
    }
    localStorage.setItem(GH_CFG_KEY, JSON.stringify(c));
    var token   = document.getElementById('gh-token').value.trim();
    var remember = document.getElementById('gh-remember').checked;
    sessionStorage.removeItem(GH_TOK_SS);
    localStorage.removeItem(GH_TOK_LS);
    if (token) {
      if (remember) localStorage.setItem(GH_TOK_LS, token);
      else          sessionStorage.setItem(GH_TOK_SS, token);
    }
    document.getElementById('gh-modal-msg').textContent = 'Saved.';
    setTimeout(closeSettings, 500);
  }

  function b64(str) { return btoa(unescape(encodeURIComponent(str))); }

  async function handleSync() {
    var c     = loadGhConfig();
    var token = getToken();
    if (!c.owner || !c.repo || !c.path || !token) { openSettings(); return; }
    var btn    = document.getElementById('sync-btn');
    var status = document.getElementById('sync-status');
    btn.disabled = true; status.textContent = 'syncing…';
    try {
      var payload = JSON.stringify({ updatedAt: new Date().toISOString(), topics: loadData() }, null, 2);
      var path    = c.path.replace(/^\/+/, '');
      var base    = 'https://api.github.com/repos/'
                  + encodeURIComponent(c.owner) + '/' + encodeURIComponent(c.repo)
                  + '/contents/' + path.split('/').map(encodeURIComponent).join('/');

      // Always bypass cache so we never use a stale SHA
      var fetchLiveSha = async function () {
        var r = await fetch(
          base + '?ref=' + encodeURIComponent(c.branch) + '&_=' + Date.now(),
          { headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' },
            cache: 'no-store' }
        );
        if (r.status === 200) return (await r.json()).sha;
        if (r.status === 404) return null;
        var ej = await r.json().catch(function () { return {}; });
        throw new Error('GET failed (' + r.status + ') ' + (ej.message || ''));
      };

      var doPut = async function (sha) {
        var body = { message: 'chore(audio): sync — ' + new Date().toISOString(),
                     content: b64(payload), branch: c.branch };
        if (sha) body.sha = sha;
        return fetch(base, { method: 'PUT',
          headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json',
                     'Content-Type': 'application/json' },
          body: JSON.stringify(body) });
      };

      var sha = await fetchLiveSha();
      var pr  = await doPut(sha);

      // 409 means SHA drifted between our GET and PUT — fetch fresh and retry once
      if (pr.status === 409) {
        status.textContent = 'conflict — retrying…';
        sha = await fetchLiveSha();
        pr  = await doPut(sha);
      }

      if (!pr.ok) {
        var ej2 = await pr.json().catch(function () { return {}; });
        throw new Error('Commit failed (' + pr.status + ') ' + (ej2.message || ''));
      }
      var m = loadMeta(); m.dirty = false; m.lastSyncTime = new Date().toISOString();
      saveMeta(m); updateSyncStatus();
    } catch (err) {
      console.error('GitHub sync error', err);
      status.textContent = 'sync failed — ' + err.message;
    } finally {
      btn.disabled = false;
    }
  }

  async function handleLoad() {
    var c     = loadGhConfig();
    var token = getToken();
    if (!c.owner || !c.repo || !c.path) { openSettings(); return; }
    var btn    = document.getElementById('load-btn');
    var status = document.getElementById('sync-status');
    btn.disabled = true; status.textContent = 'loading from GitHub…';
    try {
      var path = c.path.replace(/^\/+/, '');
      var url  = 'https://api.github.com/repos/'
               + encodeURIComponent(c.owner) + '/' + encodeURIComponent(c.repo)
               + '/contents/' + path.split('/').map(encodeURIComponent).join('/')
               + '?ref=' + encodeURIComponent(c.branch) + '&_=' + Date.now();
      var headers = { Accept: 'application/vnd.github+json' };
      if (token) headers.Authorization = 'Bearer ' + token;
      var r = await fetch(url, { headers: headers, cache: 'no-store' });
      if (r.status === 404) throw new Error('File not found on GitHub — sync first to create it');
      if (!r.ok) {
        var ej = await r.json().catch(function () { return {}; });
        throw new Error('GitHub fetch failed (' + r.status + ') ' + (ej.message || ''));
      }
      var json     = await r.json();
      var decoded  = decodeURIComponent(escape(atob(json.content.replace(/\s/g, ''))));
      var remote   = JSON.parse(decoded);
      if (!remote.topics || typeof remote.topics !== 'object') throw new Error('Unexpected file format');

      var existing = localStorage.getItem(AUDIO_KEY);
      if (existing && existing !== '{}') {
        var ok = window.confirm(
          'This browser already has local recordings for this page.\n\n' +
          'Load from GitHub will REPLACE them with the synced version.\n\n' +
          'Continue?'
        );
        if (!ok) { status.textContent = 'load cancelled'; btn.disabled = false; return; }
      }

      localStorage.setItem(AUDIO_KEY, JSON.stringify(remote.topics));
      var m = loadMeta(); m.dirty = false; m.lastSyncTime = remote.updatedAt || new Date().toISOString();
      saveMeta(m);
      TOPIC_IDS.forEach(renderPanel);
      updateSyncStatus();
      status.textContent = 'loaded from GitHub ✓';
    } catch (err) {
      console.error('GitHub load error', err);
      status.textContent = 'load failed — ' + err.message;
    } finally {
      btn.disabled = false;
    }
  }

  function timeAgo(iso) {
    var diff = Date.now() - new Date(iso).getTime();
    var min  = Math.floor(diff / 60000);
    if (min < 1)  return 'just now';
    if (min < 60) return min + 'm ago';
    var hr = Math.floor(min / 60);
    if (hr < 24)  return hr + 'h ago';
    return Math.floor(hr / 24) + 'd ago';
  }
  function updateSyncStatus() {
    var el = document.getElementById('sync-status');
    if (!el) return;
    var m = loadMeta();
    if (m.dirty)          { el.textContent = 'unsynced local changes'; el.classList.add('dirty'); }
    else if (m.lastSyncTime) { el.textContent = 'synced ' + timeAgo(m.lastSyncTime); el.classList.remove('dirty'); }
    else                  { el.textContent = 'no local changes'; el.classList.remove('dirty'); }
  }

  /* ── Public API (called from inline event handlers) ─────────── */
  window._alab = {
    add:         addAudio,
    updateTitle: updateTitle,
    editUrl:     editUrl,
    del:         delAudio,
    move:        moveAudio,
    handleSync:  handleSync,
    handleLoad:  handleLoad,
    openSettings:  openSettings,
    closeSettings: closeSettings,
    saveSettings:  saveSettings
  };

  /* ── Boot ────────────────────────────────────────────────────── */
  injectUI();
  TOPIC_IDS.forEach(renderPanel);
  updateSyncStatus();

})();
