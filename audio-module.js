/* =============================================================
   Audio Module — Architects Lab
   Self-contained: injects back-button + audio section into
   every topic page via  <script src="../audio-module.js">
   ============================================================= */
(function () {
  'use strict';

  /* ── Config ─────────────────────────────────────────────── */
  const GH_OWNER  = 'ankurkumar222';
  const GH_REPO   = 'advanced-architects-lab';
  const GH_BRANCH = 'creative';

  /* ── Shared PAT keys (same as sql_indexes_deep_dive) ─────── */
  const LS_TOKEN_LOCAL   = 'alab_gh_token_local';
  const LS_TOKEN_SESSION = 'alab_gh_token_session';

  /* ── Page key + storage + GitHub path ───────────────────── */
  const PAGE_KEY = (function () {
    const name = location.pathname.split('/').filter(Boolean).pop() || 'page';
    return name.replace(/\.html?$/i, '');
  })();

  const GH_FILE = 'audio-data/' + PAGE_KEY + '.json';
  const LS_DATA = 'alab_audio_v1_' + PAGE_KEY;

  /* ── Helpers ─────────────────────────────────────────────── */
  function uid() {
    return 'a_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
  }

  function b64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    bytes.forEach(b => (bin += String.fromCodePoint(b)));
    return btoa(bin);
  }

  /* ── Storage ─────────────────────────────────────────────── */
  function loadData() {
    try { return JSON.parse(localStorage.getItem(LS_DATA)) || []; }
    catch { return []; }
  }
  function saveData(arr) { localStorage.setItem(LS_DATA, JSON.stringify(arr)); }

  /* ── Google Drive ─────────────────────────────────────────── */
  function extractFileId(url) {
    if (!url) return null;
    url = url.trim();
    let m = url.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
    if (m) return m[1];
    m = url.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
    if (m) return m[1];
    if (/^[a-zA-Z0-9_-]{15,}$/.test(url)) return url;
    return null;
  }
  function streamUrl(fid) {
    return 'https://drive.usercontent.google.com/download?id=' + fid + '&export=download&authuser=0';
  }
  function driveViewUrl(fid) {
    return 'https://drive.google.com/file/d/' + fid + '/view';
  }

  /* ── PAT ──────────────────────────────────────────────────── */
  function getToken() {
    return sessionStorage.getItem(LS_TOKEN_SESSION) || localStorage.getItem(LS_TOKEN_LOCAL) || '';
  }
  function setToken(token, remember) {
    sessionStorage.removeItem(LS_TOKEN_SESSION);
    localStorage.removeItem(LS_TOKEN_LOCAL);
    if (token) {
      if (remember) localStorage.setItem(LS_TOKEN_LOCAL, token);
      else sessionStorage.setItem(LS_TOKEN_SESSION, token);
    }
  }

  /* ── CSS ─────────────────────────────────────────────────── */
  const CSS = `
/* == Architects Lab — Audio Module == */
.am-back{
  position:fixed;top:18px;left:18px;z-index:200;
  display:flex;align-items:center;gap:7px;
  background:var(--panel,#fff);border:1px solid var(--border,#DEDACC);
  color:var(--text,#242420);
  font-family:'IBM Plex Mono',monospace;font-size:.75rem;font-weight:600;
  padding:8px 14px;border-radius:20px;text-decoration:none;
  box-shadow:0 2px 8px rgba(0,0,0,.12);
  transition:border-color .15s,color .15s;
}
.am-back:hover{border-color:#9A62D6;color:#9A62D6;}

.am-section{margin-top:56px;padding-top:36px;border-top:1px solid var(--border,#DEDACC);}

.am-hdr{display:flex;align-items:center;gap:10px;margin-bottom:18px;}
.am-hdr-title{
  font-family:'IBM Plex Mono',monospace;font-size:.78rem;font-weight:600;
  letter-spacing:.1em;text-transform:uppercase;color:var(--muted,#75736A);flex:1;
}
.am-count{
  font-family:'IBM Plex Mono',monospace;font-size:.68rem;
  color:var(--muted,#75736A);
  background:var(--panel-2,#F2F0E8);border:1px solid var(--border,#DEDACC);
  padding:1px 7px;border-radius:10px;
}
.am-btn{
  font-family:'IBM Plex Mono',monospace;font-size:.72rem;font-weight:600;
  padding:5px 12px;border-radius:4px;
  border:1px solid var(--border,#DEDACC);
  background:var(--panel,#fff);color:var(--text,#242420);
  cursor:pointer;white-space:nowrap;
  transition:background .15s,color .15s,border-color .15s;
}
.am-btn:hover{border-color:#9A62D6;color:#9A62D6;}
.am-btn.add{border-color:#2E8B82;color:#2E8B82;}
.am-btn.add:hover{background:#2E8B82;color:#fff;}
.am-btn.sync{border-color:#6366F1;color:#6366F1;}
.am-btn.sync:hover{background:#6366F1;color:#fff;}
.am-btn.danger{border-color:#C1543A;color:#C1543A;}
.am-btn.danger:hover{background:#C1543A;color:#fff;}
.am-btn:disabled{opacity:.4;cursor:not-allowed;}

.am-list{display:flex;flex-direction:column;gap:12px;}
.am-empty{
  font-family:'IBM Plex Mono',monospace;font-size:.78rem;
  color:var(--muted,#75736A);padding:10px 0;
}
.am-item{
  background:var(--panel,#fff);border:1px solid var(--border,#DEDACC);
  border-radius:8px;padding:13px 15px;
}
.am-item-top{display:flex;align-items:center;gap:8px;margin-bottom:10px;}
.am-item-label{
  font-family:'IBM Plex Mono',monospace;font-size:.78rem;font-weight:600;
  color:var(--text,#242420);flex:1;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
.am-item-actions{display:flex;gap:4px;flex-shrink:0;}
.am-ctl{
  background:none;border:none;cursor:pointer;
  color:var(--muted,#75736A);font-size:.85rem;
  width:26px;height:26px;border-radius:4px;
  display:flex;align-items:center;justify-content:center;
  transition:color .15s,background .15s;
}
.am-ctl:hover{color:var(--text,#242420);background:var(--panel-2,#F2F0E8);}
.am-ctl:disabled{opacity:.35;cursor:default;}

.am-player{display:flex;flex-direction:column;gap:7px;}
.am-row1{display:flex;align-items:center;gap:8px;}
.am-play{
  width:30px;height:30px;border-radius:50%;
  border:1px solid var(--border,#DEDACC);
  background:var(--panel-2,#F2F0E8);color:var(--text,#242420);
  display:flex;align-items:center;justify-content:center;
  font-size:.85rem;cursor:pointer;flex-shrink:0;
  transition:background .15s,color .15s,border-color .15s;
}
.am-play:hover{background:#9A62D6;border-color:#9A62D6;color:#fff;}
.am-seek{
  flex:1;height:4px;-webkit-appearance:none;appearance:none;
  background:var(--border,#DEDACC);border-radius:2px;cursor:pointer;outline:none;
}
.am-seek::-webkit-slider-thumb{
  -webkit-appearance:none;width:12px;height:12px;
  border-radius:50%;background:#9A62D6;cursor:pointer;
}
.am-seek::-moz-range-thumb{
  width:12px;height:12px;border-radius:50%;background:#9A62D6;border:none;cursor:pointer;
}
.am-time{
  font-family:'IBM Plex Mono',monospace;font-size:.65rem;
  color:var(--muted,#75736A);white-space:nowrap;min-width:80px;text-align:right;flex-shrink:0;
}
.am-row2{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.am-vol{
  width:70px;height:3px;-webkit-appearance:none;appearance:none;
  background:var(--border,#DEDACC);border-radius:2px;cursor:pointer;outline:none;
}
.am-vol::-webkit-slider-thumb{
  -webkit-appearance:none;width:10px;height:10px;
  border-radius:50%;background:var(--muted,#75736A);
}
.am-vol::-moz-range-thumb{
  width:10px;height:10px;border-radius:50%;background:var(--muted,#75736A);border:none;
}
.am-speed{
  font-family:'IBM Plex Mono',monospace;font-size:.68rem;
  background:var(--panel-2,#F2F0E8);border:1px solid var(--border,#DEDACC);
  color:var(--text,#242420);border-radius:4px;padding:2px 5px;cursor:pointer;
}
.am-drive-link{
  font-family:'IBM Plex Mono',monospace;font-size:.68rem;
  color:var(--muted,#75736A);text-decoration:none;margin-left:auto;
}
.am-drive-link:hover{color:#9A62D6;}
.am-msg{font-family:'IBM Plex Mono',monospace;font-size:.7rem;padding:5px 0;display:none;}
.am-msg.err{color:#C1543A;}
.am-msg.info{color:var(--muted,#75736A);}

.am-add-row{
  display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;
  padding-top:14px;border-top:1px dashed var(--border,#DEDACC);
  align-items:center;
}
.am-input{
  font-family:'IBM Plex Mono',monospace;font-size:.78rem;
  background:var(--panel-2,#F2F0E8);border:1px solid var(--border,#DEDACC);
  color:var(--text,#242420);border-radius:4px;padding:6px 9px;outline:none;
  transition:border-color .15s;
}
.am-input:focus{border-color:#9A62D6;}
.am-input.am-title{width:160px;flex-shrink:0;}
.am-input.am-url{flex:1;min-width:200px;}

.am-footer{
  display:flex;align-items:center;gap:10px;flex-wrap:wrap;
  margin-top:16px;padding-top:14px;border-top:1px solid var(--border,#DEDACC);
}
.am-status{
  font-family:'IBM Plex Mono',monospace;font-size:.68rem;
  color:var(--muted,#75736A);flex:1;
}
.am-status.ok{color:#2E8B82;}
.am-status.err{color:#C1543A;}

.am-modal-bg{
  position:fixed;inset:0;background:rgba(0,0,0,.5);
  display:flex;align-items:center;justify-content:center;z-index:500;
}
.am-modal{
  background:var(--panel,#fff);border:1px solid var(--border,#DEDACC);
  border-radius:10px;padding:26px;width:min(420px,94vw);
  box-shadow:0 16px 48px rgba(0,0,0,.28);
}
.am-modal h3{
  font-family:'IBM Plex Mono',monospace;font-size:.85rem;font-weight:600;
  letter-spacing:.06em;text-transform:uppercase;margin:0 0 18px;color:var(--text,#242420);
}
.am-field{margin-bottom:14px;}
.am-field label{
  display:block;font-family:'IBM Plex Mono',monospace;font-size:.68rem;
  color:var(--muted,#75736A);letter-spacing:.08em;text-transform:uppercase;margin-bottom:5px;
}
.am-field .am-input{width:100%;box-sizing:border-box;}
.am-field .am-input.am-remember{width:auto;}
.am-field small{
  display:block;font-family:'IBM Plex Mono',monospace;font-size:.62rem;
  color:var(--muted,#75736A);margin-top:4px;line-height:1.5;
}
.am-modal-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:18px;}
.am-modal-msg{
  font-family:'IBM Plex Mono',monospace;font-size:.68rem;
  min-height:16px;color:#2E8B82;margin-top:10px;
}

@media(max-width:600px){
  .am-back{bottom:18px;top:auto;}
  .am-add-row{flex-direction:column;}
  .am-input.am-title{width:100%;}
}
`;

  /* ── Inject styles ─────────────────────────────────────────── */
  function injectStyles() {
    if (document.getElementById('am-styles')) return;
    const s = document.createElement('style');
    s.id = 'am-styles';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* ── Back button ───────────────────────────────────────────── */
  function injectBackButton() {
    if (document.getElementById('am-back')) return;
    const segs  = location.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
    const depth = segs.length;
    const href  = depth <= 1 ? 'index.html'
      : Array(depth - 1).fill('..').join('/') + '/index.html';
    const a = document.createElement('a');
    a.id        = 'am-back';
    a.className = 'am-back';
    a.href      = href;
    a.innerHTML = '&#8592; Index';
    document.body.appendChild(a);
  }

  /* ── Section refs ──────────────────────────────────────────── */
  let sectionEl, listEl, statusEl, countEl;

  /* ── Inject section ────────────────────────────────────────── */
  function injectSection() {
    if (document.getElementById('am-section')) return;
    const wrap = document.querySelector('.wrap') || document.body;
    const sec  = document.createElement('div');
    sec.id        = 'am-section';
    sec.className = 'am-section';
    sec.innerHTML = `
      <div class="am-hdr">
        <span class="am-hdr-title">&#127911; Audio Recordings</span>
        <span class="am-count" id="am-count">0</span>
        <button class="am-btn add" id="am-focus-add">+ Add</button>
      </div>
      <div class="am-list" id="am-list"></div>
      <div class="am-add-row">
        <input class="am-input am-title" type="text"
               id="am-new-title" placeholder="Label (optional)">
        <input class="am-input am-url" type="url"
               id="am-new-url" placeholder="Paste Google Drive share link">
        <button class="am-btn add" id="am-add-confirm">Add recording</button>
      </div>
      <div class="am-footer">
        <span class="am-status" id="am-status">Local — not yet synced to GitHub</span>
        <button class="am-btn" id="am-pat-btn"
                style="font-size:.65rem;opacity:.75;" title="Set GitHub token">&#9881; Token</button>
        <button class="am-btn sync" id="am-sync-btn">Sync to GitHub</button>
      </div>`;
    wrap.appendChild(sec);

    sectionEl = sec;
    listEl    = document.getElementById('am-list');
    statusEl  = document.getElementById('am-status');
    countEl   = document.getElementById('am-count');

    document.getElementById('am-focus-add').addEventListener('click', () =>
      document.getElementById('am-new-url').focus()
    );
    document.getElementById('am-add-confirm').addEventListener('click', addFromForm);
    document.getElementById('am-new-url').addEventListener('keydown', e => {
      if (e.key === 'Enter') addFromForm();
    });
    document.getElementById('am-pat-btn').addEventListener('click', showPatModal);
    document.getElementById('am-sync-btn').addEventListener('click', syncToGitHub);
  }

  /* ── Add from inline form ──────────────────────────────────── */
  function addFromForm() {
    const titleEl = document.getElementById('am-new-title');
    const urlEl   = document.getElementById('am-new-url');
    const url     = urlEl.value.trim();
    if (!url) { urlEl.focus(); return; }
    const fileId  = extractFileId(url);
    if (!fileId) {
      urlEl.style.borderColor = '#C1543A';
      setTimeout(() => (urlEl.style.borderColor = ''), 2000);
      alert('Could not find a Google Drive file ID in that link.\nPaste the full sharing link from Drive.');
      return;
    }
    const data = loadData();
    data.push({ id: uid(), title: titleEl.value.trim(), url, fileId });
    saveData(data);
    titleEl.value = '';
    urlEl.value   = '';
    renderList();
    setUnsaved();
  }

  /* ── Render list ───────────────────────────────────────────── */
  function renderList() {
    const data = loadData();
    countEl.textContent = data.length;
    listEl.innerHTML = data.length === 0
      ? '<div class="am-empty">No recordings yet — paste a Google Drive link above to attach audio.</div>'
      : data.map((item, i) => itemHtml(item, i, data.length)).join('');
    data.forEach(item => wirePlayer(item.id));
  }

  /* ── Single item HTML ──────────────────────────────────────── */
  function itemHtml(item, idx, total) {
    const label  = esc(item.title || 'Recording ' + (idx + 1));
    const fid    = item.fileId || extractFileId(item.url || '');
    const src    = fid ? streamUrl(fid)   : '';
    const pUrl   = fid ? driveViewUrl(fid): (item.url || '#');

    const player = src
      ? `<audio id="am-audio-${item.id}" preload="none" src="${esc(src)}" style="display:none;"></audio>
         <div class="am-player">
           <div class="am-row1">
             <button class="am-play" id="am-play-${item.id}" title="Play / Pause">&#9654;</button>
             <button class="am-ctl"  id="am-stop-${item.id}" title="Stop">&#9632;</button>
             <input  type="range" class="am-seek"
                     id="am-seek-${item.id}" min="0" max="100" value="0" step="0.1">
             <span class="am-time"   id="am-time-${item.id}">0:00 / 0:00</span>
           </div>
           <div class="am-row2">
             <span style="font-size:.8rem;color:var(--muted,#75736A);">&#128266;</span>
             <input type="range" class="am-vol"
                    id="am-vol-${item.id}" min="0" max="1" step="0.05" value="1">
             <select class="am-speed" id="am-speed-${item.id}" title="Playback speed">
               <option value="0.5">0.5×</option>
               <option value="0.75">0.75×</option>
               <option value="1" selected>1×</option>
               <option value="1.25">1.25×</option>
               <option value="1.5">1.5×</option>
               <option value="2">2×</option>
             </select>
             <a class="am-drive-link" href="${esc(pUrl)}"
                target="_blank" rel="noopener" title="Open in Google Drive">&#8599; Drive</a>
           </div>
           <div class="am-msg" id="am-msg-${item.id}"></div>
         </div>`
      : `<div class="am-msg err" style="display:block;">
           &#9888; Couldn't parse a Drive file ID —
           <a href="#" class="am-edit-lnk" data-id="${item.id}"
              style="color:#C1543A;">edit link</a>
         </div>`;

    return `<div class="am-item" data-id="${item.id}">
      <div class="am-item-top">
        <span class="am-item-label" title="${label}">${label}</span>
        <div class="am-item-actions">
          <button class="am-ctl" data-action="up"   data-id="${item.id}"
                  title="Move up"   ${idx === 0          ? 'disabled' : ''}>&#8593;</button>
          <button class="am-ctl" data-action="down" data-id="${item.id}"
                  title="Move down" ${idx === total - 1  ? 'disabled' : ''}>&#8595;</button>
          <button class="am-ctl" data-action="edit" data-id="${item.id}"
                  title="Edit">&#9998;</button>
          <button class="am-ctl danger" data-action="del" data-id="${item.id}"
                  title="Delete" style="color:#C1543A;">&#10005;</button>
        </div>
      </div>
      ${player}
    </div>`;
  }

  /* ── Wire player controls ──────────────────────────────────── */
  function wirePlayer(id) {
    const audio = document.getElementById('am-audio-' + id);
    if (!audio) return;

    const playBtn = document.getElementById('am-play-' + id);
    const stopBtn = document.getElementById('am-stop-' + id);
    const seek    = document.getElementById('am-seek-' + id);
    const timeEl  = document.getElementById('am-time-' + id);
    const vol     = document.getElementById('am-vol-'  + id);
    const speed   = document.getElementById('am-speed-'+ id);
    const msg     = document.getElementById('am-msg-'  + id);

    let loaded = false;
    function ensureLoaded() {
      if (!loaded) { audio.load(); loaded = true; }
    }

    if (playBtn) playBtn.addEventListener('click', () => {
      ensureLoaded();
      audio.paused
        ? audio.play().catch(() =>
            showMsg(msg, 'err',
              '&#9888; Cannot stream — sign into Google with the account that has file access, then retry.'))
        : audio.pause();
    });

    if (stopBtn) stopBtn.addEventListener('click', () => {
      audio.pause();
      audio.currentTime = 0;
      if (seek)   seek.value = 0;
      if (timeEl) timeEl.textContent = '0:00 / ' + fmt(audio.duration || 0);
    });

    if (seek) seek.addEventListener('input', () => {
      if (!isNaN(audio.duration))
        audio.currentTime = (parseFloat(seek.value) / 100) * audio.duration;
    });

    if (vol)   vol.addEventListener  ('input',  () => { audio.volume       = parseFloat(vol.value);   });
    if (speed) speed.addEventListener('change', () => { audio.playbackRate = parseFloat(speed.value); });

    audio.addEventListener('play',        () => { if (playBtn) playBtn.innerHTML = '&#9646;&#9646;'; hideMsg(msg); });
    audio.addEventListener('pause',       () => { if (playBtn) playBtn.innerHTML = '&#9654;'; });
    audio.addEventListener('ended',       () => {
      if (playBtn) playBtn.innerHTML = '&#9654;';
      if (seek)    seek.value = 0;
    });
    audio.addEventListener('timeupdate',  () => {
      if (!isNaN(audio.duration) && seek) {
        seek.value = (audio.currentTime / audio.duration) * 100;
        if (timeEl) timeEl.textContent = fmt(audio.currentTime) + ' / ' + fmt(audio.duration);
      }
    });
    audio.addEventListener('loadedmetadata', () => {
      if (timeEl) timeEl.textContent = '0:00 / ' + fmt(audio.duration);
      hideMsg(msg);
    });
    audio.addEventListener('waiting', () => showMsg(msg, 'info', '&#8987; Loading&#8230;'));
    audio.addEventListener('canplay', () => hideMsg(msg));
    audio.addEventListener('error',   () => {
      const codes = ['ABORTED', 'NETWORK', 'DECODE', 'UNSUPPORTED'];
      const code  = audio.error ? (codes[audio.error.code - 1] || 'UNKNOWN') : 'UNKNOWN';
      showMsg(msg, 'err',
        (code === 'NETWORK' || code === 'UNSUPPORTED')
          ? '&#9888; Cannot stream — make sure you are signed into Google Drive with the account that has file access.'
          : '&#9888; Audio error (' + code + ').');
    });
  }

  function showMsg(el, cls, txt) { if (el) { el.className = 'am-msg ' + cls; el.innerHTML = txt; el.style.display = ''; } }
  function hideMsg(el)           { if (el) el.style.display = 'none'; }

  /* ── List click delegation ─────────────────────────────────── */
  function bindListClicks() {
    listEl.addEventListener('click', function onListClick(e) {
      const btn  = e.target.closest('[data-action]');
      const link = e.target.closest('.am-edit-lnk');
      if (btn) {
        const { action, id } = btn.dataset;
        if (action === 'up')   { moveItem(id, -1); return; }
        if (action === 'down') { moveItem(id,  1); return; }
        if (action === 'edit') { showEditModal(id); return; }
        if (action === 'del')  { deleteItem(id);   return; }
      }
      if (link) { e.preventDefault(); showEditModal(link.dataset.id); }
    });
  }

  /* ── CRUD ──────────────────────────────────────────────────── */
  function deleteItem(id) {
    if (!confirm('Remove this recording? (Local-only until you click Sync to GitHub.)')) return;
    saveData(loadData().filter(x => x.id !== id));
    renderList();
    setUnsaved();
  }

  function moveItem(id, dir) {
    const data = loadData();
    const idx  = data.findIndex(x => x.id === id);
    const to   = idx + dir;
    if (idx === -1 || to < 0 || to >= data.length) return;
    [data[idx], data[to]] = [data[to], data[idx]];
    saveData(data);
    renderList();
    setUnsaved();
  }

  function showEditModal(id) {
    const data = loadData();
    const item = data.find(x => x.id === id);
    if (!item) return;

    const bg = document.createElement('div');
    bg.className = 'am-modal-bg';
    bg.innerHTML = `
      <div class="am-modal" role="dialog" aria-modal="true">
        <h3>Edit Recording</h3>
        <div class="am-field">
          <label>Title / Label (optional)</label>
          <input class="am-input" type="text" id="am-e-title"
                 value="${esc(item.title || '')}" placeholder="e.g. Session 1 — Core concepts">
        </div>
        <div class="am-field">
          <label>Google Drive URL</label>
          <input class="am-input" type="url" id="am-e-url"
                 value="${esc(item.url || '')}" placeholder="https://drive.google.com/file/d/…">
        </div>
        <div class="am-modal-actions">
          <button class="am-btn" id="am-e-cancel">Cancel</button>
          <button class="am-btn add" id="am-e-save">Save</button>
        </div>
        <div class="am-modal-msg" id="am-e-msg"></div>
      </div>`;
    document.body.appendChild(bg);
    bg.querySelector('#am-e-url').focus();

    const close = () => bg.remove();
    bg.querySelector('#am-e-cancel').addEventListener('click', close);
    bg.addEventListener('click', e => { if (e.target === bg) close(); });

    bg.querySelector('#am-e-save').addEventListener('click', () => {
      const url    = bg.querySelector('#am-e-url').value.trim();
      const fileId = extractFileId(url);
      if (!url || !fileId) {
        bg.querySelector('#am-e-msg').textContent = 'Enter a valid Google Drive sharing link.';
        return;
      }
      const idx  = data.findIndex(x => x.id === id);
      data[idx]  = { ...item, title: bg.querySelector('#am-e-title').value.trim(), url, fileId };
      saveData(data);
      renderList();
      setUnsaved();
      close();
    });
  }

  /* ── Status helper ─────────────────────────────────────────── */
  function setUnsaved() {
    statusEl.className   = 'am-status';
    statusEl.textContent = 'Unsaved local changes — click Sync to push to GitHub';
  }

  /* ── PAT modal ─────────────────────────────────────────────── */
  function showPatModal() {
    const current    = getToken();
    const remembered = !!localStorage.getItem(LS_TOKEN_LOCAL);

    const bg = document.createElement('div');
    bg.className = 'am-modal-bg';
    bg.innerHTML = `
      <div class="am-modal" role="dialog" aria-modal="true">
        <h3>GitHub Token</h3>
        <div class="am-field">
          <label>Personal Access Token (classic — repo scope)</label>
          <input class="am-input" type="password" id="am-p-token"
                 value="${esc(current)}" placeholder="ghp_…" autocomplete="off">
          <small>Used only from this page to call the GitHub API at api.github.com.
                 Never sent anywhere else.</small>
        </div>
        <div class="am-field">
          <label>
            <input class="am-input am-remember" type="checkbox"
                   id="am-p-remember" ${remembered ? 'checked' : ''}>
            &nbsp;Remember on this device (localStorage)
          </label>
        </div>
        <div class="am-modal-actions">
          <button class="am-btn" id="am-p-cancel">Cancel</button>
          <button class="am-btn danger" id="am-p-clear">Clear</button>
          <button class="am-btn add" id="am-p-save">Save</button>
        </div>
        <div class="am-modal-msg" id="am-p-msg"></div>
      </div>`;
    document.body.appendChild(bg);
    bg.querySelector('#am-p-token').focus();

    const close = () => bg.remove();
    bg.querySelector('#am-p-cancel').addEventListener('click', close);
    bg.addEventListener('click', e => { if (e.target === bg) close(); });

    bg.querySelector('#am-p-clear').addEventListener('click', () => {
      setToken('', false);
      bg.querySelector('#am-p-msg').textContent = 'Token cleared.';
      setTimeout(close, 700);
    });

    bg.querySelector('#am-p-save').addEventListener('click', () => {
      const token    = bg.querySelector('#am-p-token').value.trim();
      const remember = bg.querySelector('#am-p-remember').checked;
      setToken(token, remember);
      bg.querySelector('#am-p-msg').textContent = token ? 'Saved.' : 'Cleared.';
      setTimeout(close, 700);
    });
  }

  /* ── GitHub sync ───────────────────────────────────────────── */
  async function syncToGitHub() {
    const token = getToken();
    if (!token) { showPatModal(); return; }

    const syncBtn = document.getElementById('am-sync-btn');
    syncBtn.disabled   = true;
    syncBtn.textContent= 'Syncing…';
    statusEl.className = 'am-status';
    statusEl.textContent = 'Connecting to GitHub…';

    const hdr = {
      'Authorization'       : 'Bearer ' + token,
      'Accept'              : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };

    try {
      /* 1 — Ensure creative branch exists */
      const branchRes = await fetch(
        `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/git/refs/heads/${GH_BRANCH}`,
        { headers: hdr }
      );
      if (branchRes.status === 404) {
        statusEl.textContent = 'Creating "creative" branch…';
        const mainRes = await fetch(
          `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/git/refs/heads/main`,
          { headers: hdr }
        );
        if (!mainRes.ok) throw new Error('Cannot read main branch — check token permissions.');
        const { object: { sha: mainSha } } = await mainRes.json();
        const cr = await fetch(
          `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/git/refs`,
          {
            method : 'POST',
            headers: { ...hdr, 'Content-Type': 'application/json' },
            body   : JSON.stringify({ ref: 'refs/heads/' + GH_BRANCH, sha: mainSha }),
          }
        );
        if (!cr.ok) {
          const e = await cr.json().catch(() => ({}));
          throw new Error('Create branch: ' + (e.message || cr.status));
        }
      } else if (!branchRes.ok) {
        throw new Error('Cannot verify branch (HTTP ' + branchRes.status + ').');
      }

      /* 2 — Get existing file SHA */
      statusEl.textContent = 'Reading remote file…';
      let existingSha = null;
      const getRes = await fetch(
        `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_FILE}?ref=${GH_BRANCH}`,
        { headers: hdr }
      );
      if (getRes.ok) existingSha = (await getRes.json()).sha;

      /* 3 — Build payload & commit */
      statusEl.textContent = 'Committing…';
      const payload = JSON.stringify({
        updatedAt : new Date().toISOString(),
        page      : PAGE_KEY,
        recordings: loadData(),
      }, null, 2);

      const putBody = {
        message: 'sync: audio-data/' + PAGE_KEY + ' [' + new Date().toISOString().slice(0, 10) + ']',
        content : b64(payload),
        branch  : GH_BRANCH,
      };
      if (existingSha) putBody.sha = existingSha;

      const putRes = await fetch(
        `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_FILE}`,
        {
          method : 'PUT',
          headers: { ...hdr, 'Content-Type': 'application/json' },
          body   : JSON.stringify(putBody),
        }
      );
      if (!putRes.ok) {
        const e = await putRes.json().catch(() => ({}));
        throw new Error(e.message || 'GitHub PUT failed (' + putRes.status + ').');
      }

      statusEl.className   = 'am-status ok';
      statusEl.textContent = 'Synced ✓ — committed to "' + GH_BRANCH + '" at ' + new Date().toLocaleTimeString();

    } catch (err) {
      statusEl.className   = 'am-status err';
      statusEl.textContent = '✗ Sync failed: ' + err.message;
    } finally {
      syncBtn.disabled    = false;
      syncBtn.textContent = 'Sync to GitHub';
    }
  }

  /* ── Suppress extension-runtime noise ─────────────────────────
     Chrome extensions intercepting Drive requests via async message
     listeners sometimes kill their service worker before calling
     sendResponse. Chrome then rejects a Promise and logs it to the
     page console. Swallow it here — real page errors never carry
     this exact message text so nothing legitimate is hidden.        */
  window.addEventListener('unhandledrejection', function (event) {
    var msg = event && event.reason && event.reason.message;
    if (typeof msg === 'string' && msg.indexOf('message channel closed') !== -1) {
      event.preventDefault();
    }
  });

  /* ── Init ──────────────────────────────────────────────────── */
  function init() {
    injectStyles();
    injectBackButton();
    injectSection();
    renderList();
    bindListClicks();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
