/* =============================================================
   Audio Module — Architects Lab
   Self-contained: injects back-button + audio section into
   every topic page via  <script src="../audio-module.js">

   Private Google Drive files are played via Drive's own preview
   iframe (drive.google.com/file/d/ID/preview), which makes
   authenticated same-origin requests using the browser's
   existing Google session — no CORS / ORB issues.

   Live recording: MediaRecorder → Blob → Drive API upload
   (requires Google OAuth2 with drive.file scope)
   ============================================================= */
(function () {
  'use strict';

  /* ── Config ─────────────────────────────────────────────── */
  const GH_OWNER         = 'ankurkumar222';
  const GH_REPO          = 'advanced-architects-lab';
  const GH_BRANCH        = 'creative';
  const GOOGLE_CLIENT_ID = '586782835490-8bab6ubs872d1lv58375876ujirm8g24.apps.googleusercontent.com';

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

  /* ── Google Drive helpers ─────────────────────────────────── */
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

  /* iframe src — authenticated via browser's Google session */
  function previewUrl(fid) {
    return 'https://drive.google.com/file/d/' + fid + '/preview';
  }
  /* open-in-Drive link */
  function viewUrl(fid) {
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

  /* ── Google OAuth2 (for Drive upload) ────────────────────── */
  let _gsiLoaded   = false;
  let _tokenClient = null;
  let _cachedToken = null;
  let _tokenExpiry = 0;

  function loadGsi() {
    return new Promise((resolve, reject) => {
      if (_gsiLoaded && window.google && google.accounts) { resolve(); return; }
      /* Script already in DOM (e.g. loaded by index.html) — wait for it */
      if (document.querySelector('script[src*="accounts.google.com/gsi/client"]')) {
        const id = setInterval(() => {
          if (window.google && google.accounts) { _gsiLoaded = true; clearInterval(id); resolve(); }
        }, 50);
        setTimeout(() => { clearInterval(id); reject(new Error('Google library load timed out.')); }, 10000);
        return;
      }
      const s   = document.createElement('script');
      s.src     = 'https://accounts.google.com/gsi/client';
      s.onload  = () => { _gsiLoaded = true; resolve(); };
      s.onerror = () => reject(new Error('Could not load the Google Sign-In library.'));
      document.head.appendChild(s);
    });
  }

  async function getOAuthToken() {
    await loadGsi();
    if (_cachedToken && Date.now() < _tokenExpiry - 60000) return _cachedToken;
    return new Promise((resolve, reject) => {
      if (!_tokenClient) {
        _tokenClient = google.accounts.oauth2.initTokenClient({
          client_id : GOOGLE_CLIENT_ID,
          scope     : 'https://www.googleapis.com/auth/drive.file',
          callback  : '', /* set per-call below */
        });
      }
      _tokenClient.callback = (r) => {
        if (r.error) {
          reject(new Error('Google sign-in failed: ' + (r.error_description || r.error)));
        } else {
          _cachedToken = r.access_token;
          _tokenExpiry = Date.now() + ((r.expires_in || 3600) * 1000);
          resolve(_cachedToken);
        }
      };
      _tokenClient.requestAccessToken({ prompt: '' });
    });
  }

  async function uploadToDrive(blob, fileName) {
    const token = await getOAuthToken();
    const form  = new FormData();
    form.append(
      'metadata',
      new Blob([JSON.stringify({ name: fileName, mimeType: blob.type || 'audio/webm' })],
               { type: 'application/json' })
    );
    form.append('file', blob, fileName);
    const res = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name',
      { method: 'POST', headers: { 'Authorization': 'Bearer ' + token }, body: form }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err.error && err.error.message) || 'Drive upload failed (' + res.status + ')');
    }
    return (await res.json()).id;
  }

  /* ── Recording state ─────────────────────────────────────── */
  let _recState    = 'idle'; /* idle | recording | done */
  let _recRecorder = null;
  let _recStream   = null;
  let _recChunks   = [];
  let _recBlob     = null;
  let _recTimerInt = null;
  let _recSeconds  = 0;

  function _recExt(blob) {
    const t = (blob && blob.type) || '';
    if (t.includes('ogg')) return '.ogg';
    if (t.includes('mp4')) return '.m4a';
    return '.webm';
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
.am-btn.rec-on{border-color:#C1543A;color:#C1543A;}
.am-btn.rec-on:hover{background:#C1543A;color:#fff;}
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

/* Drive iframe player */
.am-drive-frame{
  display:block;width:100%;height:80px;
  border:1px solid var(--border,#DEDACC);border-radius:6px;
  background:var(--panel-2,#F2F0E8);
}
.am-frame-row{
  display:flex;align-items:center;justify-content:space-between;
  margin-top:7px;gap:10px;
}
.am-drive-link{
  font-family:'IBM Plex Mono',monospace;font-size:.68rem;
  color:var(--muted,#75736A);text-decoration:none;
}
.am-drive-link:hover{color:#9A62D6;}
.am-drive-note{
  font-family:'IBM Plex Mono',monospace;font-size:.63rem;
  color:var(--muted,#75736A);opacity:.75;
}
.am-msg-block{
  font-family:'IBM Plex Mono',monospace;font-size:.7rem;
  color:#C1543A;padding:8px 0;
}

/* Add section: mode tabs + two panels */
.am-add-section{
  margin-top:14px;padding-top:14px;
  border-top:1px dashed var(--border,#DEDACC);
}
.am-mode-tabs{display:flex;gap:4px;margin-bottom:12px;}
.am-tab{
  font-family:'IBM Plex Mono',monospace;font-size:.7rem;font-weight:600;
  padding:4px 12px;border-radius:20px;
  border:1px solid var(--border,#DEDACC);
  background:none;color:var(--muted,#75736A);
  cursor:pointer;
  transition:border-color .15s,color .15s,background .15s;
}
.am-tab.am-tab-active{
  background:var(--panel-2,#F2F0E8);
  border-color:var(--text,#242420);color:var(--text,#242420);
}
.am-tab:hover:not(.am-tab-active){border-color:#9A62D6;color:#9A62D6;}

.am-add-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}
.am-input{
  font-family:'IBM Plex Mono',monospace;font-size:.78rem;
  background:var(--panel-2,#F2F0E8);border:1px solid var(--border,#DEDACC);
  color:var(--text,#242420);border-radius:4px;padding:6px 9px;outline:none;
  transition:border-color .15s;
}
.am-input:focus{border-color:#9A62D6;}
.am-input.am-title{width:160px;flex-shrink:0;}
.am-input.am-url{flex:1;min-width:200px;}

/* Recording panel */
.am-rec-panel{display:flex;flex-direction:column;gap:10px;}
.am-rec-row1{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.am-rec-dot{
  width:9px;height:9px;border-radius:50%;
  background:#C1543A;display:none;flex-shrink:0;
}
.am-rec-dot.on{display:inline-block;animation:am-blink 1s ease-in-out infinite;}
@keyframes am-blink{0%,100%{opacity:1}50%{opacity:.2}}
.am-rec-timer{
  font-family:'IBM Plex Mono',monospace;font-size:.78rem;
  color:var(--text,#242420);min-width:44px;visibility:hidden;
}
.am-rec-timer.on{visibility:visible;}
.am-rec-after{display:flex;flex-direction:column;gap:10px;}
.am-rec-preview{width:100%;max-width:100%;}
.am-rec-upload-row{display:flex;gap:8px;flex-wrap:wrap;}
.am-rec-status{
  font-family:'IBM Plex Mono',monospace;font-size:.7rem;
  color:var(--muted,#75736A);min-height:18px;
}
.am-rec-status.err{color:#C1543A;}
.am-rec-status.ok{color:#2E8B82;}

/* Footer */
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

/* Modal */
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
  .am-rec-row1{flex-direction:column;align-items:flex-start;}
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
      </div>
      <div class="am-list" id="am-list"></div>

      <div class="am-add-section">
        <div class="am-mode-tabs">
          <button class="am-tab am-tab-active" id="am-tab-link">&#128206; Paste link</button>
          <button class="am-tab" id="am-tab-record">&#127897; Record</button>
        </div>

        <!-- Panel A: paste a Drive link -->
        <div class="am-add-row" id="am-panel-link">
          <input class="am-input am-title" type="text"
                 id="am-new-title" placeholder="Label (optional)">
          <input class="am-input am-url" type="url"
                 id="am-new-url" placeholder="Paste Google Drive share link">
          <button class="am-btn add" id="am-add-confirm">Add</button>
        </div>

        <!-- Panel B: record live audio -->
        <div class="am-rec-panel" id="am-panel-record" style="display:none;">
          <div class="am-rec-row1">
            <input class="am-input am-title" type="text"
                   id="am-rec-label" placeholder="Label (optional)">
            <button class="am-btn" id="am-rec-btn">&#9679; Record</button>
            <span class="am-rec-dot" id="am-rec-dot" aria-hidden="true"></span>
            <span class="am-rec-timer" id="am-rec-timer">0:00</span>
          </div>
          <div class="am-rec-after" id="am-rec-after" style="display:none;">
            <audio id="am-rec-preview" controls class="am-rec-preview"></audio>
            <div class="am-rec-upload-row">
              <button class="am-btn add" id="am-rec-upload">&#8593; Upload to Drive</button>
              <button class="am-btn danger" id="am-rec-discard">&#10005; Discard</button>
            </div>
          </div>
          <div class="am-rec-status" id="am-rec-status"></div>
        </div>
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

    /* Paste-link tab events */
    document.getElementById('am-add-confirm').addEventListener('click', addFromForm);
    document.getElementById('am-new-url').addEventListener('keydown', e => {
      if (e.key === 'Enter') addFromForm();
    });
    document.getElementById('am-pat-btn').addEventListener('click', showPatModal);
    document.getElementById('am-sync-btn').addEventListener('click', syncToGitHub);

    /* Mode tabs */
    document.getElementById('am-tab-link').addEventListener('click',   () => switchTab('link'));
    document.getElementById('am-tab-record').addEventListener('click', () => switchTab('record'));

    /* Recording events */
    bindRecordEvents();
  }

  /* ── Tab switching ─────────────────────────────────────────── */
  function switchTab(tab) {
    document.getElementById('am-tab-link')  .classList.toggle('am-tab-active', tab === 'link');
    document.getElementById('am-tab-record').classList.toggle('am-tab-active', tab === 'record');
    document.getElementById('am-panel-link')  .style.display = tab === 'link'   ? '' : 'none';
    document.getElementById('am-panel-record').style.display = tab === 'record' ? '' : 'none';
  }

  /* ── Recording events ──────────────────────────────────────── */
  function bindRecordEvents() {
    document.getElementById('am-rec-btn').addEventListener('click', async () => {
      if (_recState === 'idle')      { await startRecording(); }
      else if (_recState === 'recording') { stopRecording(); }
      else if (_recState === 'done') { resetRecording(); await startRecording(); }
    });
    document.getElementById('am-rec-upload') .addEventListener('click', doUpload);
    document.getElementById('am-rec-discard').addEventListener('click', resetRecording);
  }

  async function startRecording() {
    const statusEl2 = document.getElementById('am-rec-status');
    const recBtn    = document.getElementById('am-rec-btn');
    const dot       = document.getElementById('am-rec-dot');
    const timer     = document.getElementById('am-rec-timer');
    const after     = document.getElementById('am-rec-after');

    statusEl2.className = statusEl2.className.replace(/\s*(err|ok)\b/g, '');
    statusEl2.textContent = '';

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      statusEl2.className   = 'am-rec-status err';
      statusEl2.textContent = 'Your browser does not support audio recording.';
      return;
    }

    try {
      _recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      statusEl2.className   = 'am-rec-status err';
      statusEl2.textContent = 'Microphone access denied: ' + err.message;
      return;
    }

    _recChunks  = [];
    _recSeconds = 0;

    const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', '']
      .find(t => t === '' || MediaRecorder.isTypeSupported(t));

    _recRecorder = new MediaRecorder(_recStream, mimeType ? { mimeType } : {});
    _recRecorder.addEventListener('dataavailable', e => {
      if (e.data && e.data.size > 0) _recChunks.push(e.data);
    });
    _recRecorder.addEventListener('stop', () => {
      _recBlob  = new Blob(_recChunks, { type: _recRecorder.mimeType || 'audio/webm' });
      _recState = 'done';

      const preview = document.getElementById('am-rec-preview');
      if (preview) preview.src = URL.createObjectURL(_recBlob);

      document.getElementById('am-rec-after').style.display = '';
      document.getElementById('am-rec-btn').textContent     = '&#9679; Record again';
      document.getElementById('am-rec-btn').className       = 'am-btn';
      document.getElementById('am-rec-dot').classList.remove('on');
      document.getElementById('am-rec-timer').classList.remove('on');

      clearInterval(_recTimerInt); _recTimerInt = null;
      if (_recStream) { _recStream.getTracks().forEach(t => t.stop()); _recStream = null; }

      const s = document.getElementById('am-rec-status');
      if (s) { s.className = 'am-rec-status'; s.textContent = 'Review and upload, or discard.'; }
    });

    _recRecorder.start(100);
    _recState = 'recording';

    recBtn.textContent    = '&#9632; Stop';
    recBtn.className      = 'am-btn rec-on';
    after.style.display   = 'none';
    dot.classList.add('on');
    timer.textContent = '0:00';
    timer.classList.add('on');

    _recTimerInt = setInterval(() => {
      _recSeconds++;
      const el = document.getElementById('am-rec-timer');
      if (el) el.textContent = Math.floor(_recSeconds / 60) + ':' + String(_recSeconds % 60).padStart(2, '0');
    }, 1000);

    statusEl2.className   = 'am-rec-status';
    statusEl2.textContent = 'Recording… click Stop when done.';
  }

  function stopRecording() {
    if (_recRecorder && _recRecorder.state !== 'inactive') _recRecorder.stop();
    clearInterval(_recTimerInt); _recTimerInt = null;
    if (_recStream) { _recStream.getTracks().forEach(t => t.stop()); _recStream = null; }
  }

  function resetRecording() {
    stopRecording();
    _recState    = 'idle';
    _recRecorder = null;
    _recChunks   = [];
    _recBlob     = null;
    _recSeconds  = 0;

    const recBtn  = document.getElementById('am-rec-btn');
    const dot     = document.getElementById('am-rec-dot');
    const timer   = document.getElementById('am-rec-timer');
    const after   = document.getElementById('am-rec-after');
    const status  = document.getElementById('am-rec-status');
    const preview = document.getElementById('am-rec-preview');

    if (recBtn)  { recBtn.textContent = '&#9679; Record'; recBtn.className = 'am-btn'; }
    if (dot)     dot.classList.remove('on');
    if (timer)   { timer.textContent = '0:00'; timer.classList.remove('on'); }
    if (after)   after.style.display = 'none';
    if (status)  { status.textContent = ''; status.className = 'am-rec-status'; }
    if (preview && preview.src) { URL.revokeObjectURL(preview.src); preview.src = ''; }
  }

  async function doUpload() {
    if (_recState !== 'done' || !_recBlob) return;

    const status  = document.getElementById('am-rec-status');
    const upload  = document.getElementById('am-rec-upload');
    const discard = document.getElementById('am-rec-discard');
    const label   = (document.getElementById('am-rec-label') || {}).value || '';

    status.className = status.className.replace(/\s*(err|ok)\b/g, '');
    status.textContent = 'Signing in to Google…';
    upload.disabled  = true;
    discard.disabled = true;

    try {
      const ext  = _recExt(_recBlob);
      const name = ((label.trim() || 'Recording') + ' — ' + new Date().toISOString().slice(0, 10) + ext)
        .replace(/[<>:"/\\|?*]/g, '-');

      status.textContent = 'Uploading to Google Drive…';
      const fileId = await uploadToDrive(_recBlob, name);

      const data = loadData();
      data.push({
        id: uid(),
        title  : label.trim() || name.slice(0, -ext.length),
        url    : viewUrl(fileId),
        fileId : fileId,
      });
      saveData(data);
      renderList();
      setUnsaved();

      status.className   = 'am-rec-status ok';
      status.textContent = 'Uploaded ✓ — saved to Drive and added to recordings.';

      /* Reset after a moment so the user can see the success */
      setTimeout(() => {
        const lbl = document.getElementById('am-rec-label');
        if (lbl) lbl.value = '';
        resetRecording();
      }, 1800);

    } catch (err) {
      status.className   = 'am-rec-status err';
      status.textContent = '✗ Upload failed: ' + err.message;
      upload.disabled  = false;
      discard.disabled = false;
    }
  }

  /* ── Add from paste-link form ──────────────────────────────── */
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
      ? '<div class="am-empty">No recordings yet — paste a Drive link or record directly above.</div>'
      : data.map((item, i) => itemHtml(item, i, data.length)).join('');
  }

  /* ── Single item HTML (iframe player) ─────────────────────── */
  function itemHtml(item, idx, total) {
    const label = esc(item.title || 'Recording ' + (idx + 1));
    const fid   = item.fileId || extractFileId(item.url || '');

    const player = fid
      ? `<iframe class="am-drive-frame"
                 src="${esc(previewUrl(fid))}"
                 allow="autoplay"
                 loading="lazy"
                 title="${label}"
                 sandbox="allow-scripts allow-same-origin allow-popups allow-forms"></iframe>
         <div class="am-frame-row">
           <span class="am-drive-note">Sign in to Google Drive in this browser to play private files.</span>
           <a class="am-drive-link" href="${esc(viewUrl(fid))}"
              target="_blank" rel="noopener">&#8599; Open in Drive</a>
         </div>`
      : `<div class="am-msg-block">
           &#9888; Couldn't parse a Drive file ID &mdash;
           <a href="#" class="am-edit-lnk" data-id="${item.id}"
              style="color:#C1543A;">edit link</a>
         </div>`;

    return `<div class="am-item" data-id="${item.id}">
      <div class="am-item-top">
        <span class="am-item-label" title="${label}">${label}</span>
        <div class="am-item-actions">
          <button class="am-ctl" data-action="up"   data-id="${item.id}"
                  title="Move up"   ${idx === 0         ? 'disabled' : ''}>&#8593;</button>
          <button class="am-ctl" data-action="down" data-id="${item.id}"
                  title="Move down" ${idx === total - 1 ? 'disabled' : ''}>&#8595;</button>
          <button class="am-ctl" data-action="edit" data-id="${item.id}"
                  title="Edit">&#9998;</button>
          <button class="am-ctl danger" data-action="del" data-id="${item.id}"
                  title="Delete" style="color:#C1543A;">&#10005;</button>
        </div>
      </div>
      ${player}
    </div>`;
  }

  /* ── List click delegation ─────────────────────────────────── */
  function bindListClicks() {
    listEl.addEventListener('click', function (e) {
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
      const idx = data.findIndex(x => x.id === id);
      data[idx] = { ...item, title: bg.querySelector('#am-e-title').value.trim(), url, fileId };
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
          <label>Personal Access Token (classic &mdash; repo scope)</label>
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
    syncBtn.disabled     = true;
    syncBtn.textContent  = 'Syncing…';
    statusEl.className   = 'am-status';
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

  /* ── Suppress Chrome-extension runtime noise ───────────────────
     Some extensions intercept Drive network requests and kill their
     service worker before calling sendResponse. Chrome rejects the
     resulting promise and logs it to the page console. Swallow it —
     real page errors never carry this exact message string.         */
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
