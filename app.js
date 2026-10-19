
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyATIJH" + "LsHQJx7qbXa" + "lP8CnR1Ewg3JpUveI",
  authDomain: "agenda-pessoal-95eae.firebaseapp.com",
  projectId: "agenda-pessoal-95eae",
  storageBucket: "agenda-pessoal-95eae.firebasestorage.app",
  messagingSenderId: "747342807491",
  appId: "1:747342807491:web:ee625e19779ca35d627d76"
};

const FB_ON = !!(FIREBASE_CONFIG.apiKey);
let auth = null, db = null, storage = null, currentUser = null;
if (FB_ON) {
  firebase.initializeApp(FIREBASE_CONFIG);
  auth = firebase.auth();
  db = firebase.firestore();
  storage = firebase.storage();
}

/* ────── Storage keys ────── */
const SK = 'agenda_v3_days';
const SK_THEME = 'agenda_v3_theme';
const SK_MODE = 'agenda_v3_mode'; // 'online' | 'offline'

/* ────── Helpers ────── */
const pad = n => String(n).padStart(2, '0');
const $ = id => document.getElementById(id);
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function yesterdayKey() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function keyToDate(k) { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); }
function fmtFull(k) { return keyToDate(k).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }
function fmtShort(k) {
  const today = todayKey(); if (k === today) return 'Hoje';
  const y = new Date(); y.setDate(y.getDate() - 1);
  const yk = `${y.getFullYear()}-${pad(y.getMonth() + 1)}-${pad(y.getDate())}`;
  if (k === yk) return 'Ontem';
  return keyToDate(k).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: '2-digit' });
}
function fmtTab(k) { if (k === todayKey()) return 'Hoje'; return keyToDate(k).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); }
function toPlain(html) { const d = document.createElement('div'); d.innerHTML = html; return d.textContent || ''; }
function cWords(t) { return t.trim().split(/\s+/).filter(Boolean).length; }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

/* ────── Local Storage ────── */
function localKey() { return currentUser ? `${SK}_${currentUser.uid}` : SK; }
function loadLocal() { try { return JSON.parse(localStorage.getItem(localKey())) || {}; } catch { return {}; } }
function saveLocal(d) { localStorage.setItem(localKey(), JSON.stringify(d)); }
function localGetDay(k) { return loadLocal()[k] || { content: '', updatedAt: null, tags: [], images: [], checklist: [] }; }
function localSetDay(k, content, tags, images, checklist) {
  const d = loadLocal();
  const existingImages = d[k] && Array.isArray(d[k].images) ? d[k].images : [];
  const existingChecklist = d[k] && Array.isArray(d[k].checklist) ? d[k].checklist : [];
  d[k] = { 
    content, 
    updatedAt: new Date().toISOString(), 
    tags: tags || [], 
    images: images !== undefined ? images : existingImages,
    checklist: checklist !== undefined ? checklist : existingChecklist
  };
  saveLocal(d);
}
function localDelDay(k) { const d = loadLocal(); delete d[k]; saveLocal(d); }
function allKeys() { return Object.keys(loadLocal()).sort().reverse(); }

/* ────── Firestore Sync & Realtime Listener ────── */
function userDaysRef() { return db.collection('users').doc(currentUser.uid).collection('days'); }

let realtimeUnsubscribe = null;
let isApplyingRemoteChange = false;

function setSyncStatus(state) {
  const bar = $('syncBar'); const txt = $('syncText');
  if (bar && txt) {
    bar.className = 'sync-bar ' + state;
    if (state === 'synced') txt.textContent = 'Sincronizado ✓';
    else if (state === 'syncing') txt.textContent = 'Sincronizando...';
    else txt.textContent = 'Modo local';
  }
  const mob = $('mobileSyncIndicator');
  if (mob) {
    mob.className = 'mobile-sync-badge ' + state;
    mob.title = state === 'synced' ? 'Nuvem sincronizada ✓' : (state === 'syncing' ? 'Sincronizando com nuvem...' : 'Modo offline (toque para conectar)');
  }
}

function isContentEmpty(html) {
  if (!html) return true;
  if (/<(img|svg|table|audio|video|iframe|input|hr)\b/i.test(html)) return false;
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const text = (tmp.textContent || tmp.innerText || '').replace(/[\s\u200B-\u200D\uFEFF]/g, '');
  return text.length === 0;
}

function mergeRemoteDay(key, remoteDoc, localData) {
  const localDoc = localData[key];
  if (!localDoc) {
    localData[key] = remoteDoc;
    return true;
  }
  
  const remoteEmpty = isContentEmpty(remoteDoc.content) && (!remoteDoc.checklist || remoteDoc.checklist.length === 0) && (!remoteDoc.images || remoteDoc.images.length === 0);
  const localEmpty = isContentEmpty(localDoc.content) && (!localDoc.checklist || localDoc.checklist.length === 0) && (!localDoc.images || localDoc.images.length === 0);
  
  // Rule 1: A placeholder/empty local note NEVER overwrites a cloud note with content
  if (localEmpty && !remoteEmpty) {
    localData[key] = { ...localDoc, ...remoteDoc };
    return true;
  }
  
  // Rule 2: If cloud note has no content while local note does, keep local note
  if (!localEmpty && remoteEmpty) {
    return false;
  }
  
  // Rule 3: Compare timestamps
  const remoteTime = remoteDoc.updatedAt ? new Date(remoteDoc.updatedAt).getTime() : 0;
  const localTime = localDoc.updatedAt ? new Date(localDoc.updatedAt).getTime() : 0;
  
  if (remoteTime >= localTime || (!localTime && remoteTime)) {
    if (localDoc.content !== remoteDoc.content ||
        JSON.stringify(localDoc.tags || []) !== JSON.stringify(remoteDoc.tags || []) ||
        JSON.stringify(localDoc.images || []) !== JSON.stringify(remoteDoc.images || []) ||
        JSON.stringify(localDoc.checklist || []) !== JSON.stringify(remoteDoc.checklist || [])) {
      localData[key] = { ...localDoc, ...remoteDoc };
      return true;
    }
  }
  return false;
}

function startRealtimeSync() {
  if (!db || !currentUser || !FB_ON) return;
  if (realtimeUnsubscribe) {
    try { realtimeUnsubscribe(); } catch (e) {}
    realtimeUnsubscribe = null;
  }

  setSyncStatus('syncing');

  try {
    realtimeUnsubscribe = userDaysRef().onSnapshot(snapshot => {
      setSyncStatus('synced');
      let hasChanges = false;
      const local = loadLocal();
      let activeTabChanged = false;

      snapshot.docChanges().forEach(change => {
        const doc = change.doc;
        // Ignore local pending writes to avoid self-echoing while typing
        if (doc.metadata && doc.metadata.hasPendingWrites) return;

        const key = doc.id;
        if (change.type === 'removed') {
          if (local[key]) {
            delete local[key];
            hasChanges = true;
            if (activeTab === key) activeTabChanged = true;
          }
        } else {
          const raw = doc.data();
          const remote = {
            content: raw.content || '',
            tags: raw.tags || [],
            images: raw.images || [],
            checklist: raw.checklist || [],
            updatedAt: raw.updatedAt?.toDate?.()?.toISOString() || raw.updatedAt || null
          };

          if (mergeRemoteDay(key, remote, local)) {
            hasChanges = true;
            if (activeTab === key) activeTabChanged = true;
          }
        }
      });

      if (hasChanges) {
        saveLocal(local);
        renderSidebar($('searchInput')?.value || '');
        renderTagFilterBar();
        renderCalendar();

        if (activeTabChanged && activeTab && local[activeTab]) {
          const isUserTyping = document.activeElement === $('editor');
          if (!isUserTyping) {
            isApplyingRemoteChange = true;
            const day = local[activeTab];
            $('editor').innerHTML = day.content || '';
            currentTags = day.tags ? [...day.tags] : [];
            renderTagsInEditor();
            currentChecklist = day.checklist ? [...day.checklist] : [];
            if (typeof renderChecklist === 'function') renderChecklist();
            if (typeof renderGallery === 'function') renderGallery();
            updateWC();
            $('currentDaySubtitle').textContent = day.updatedAt ? `Última edição: ${new Date(day.updatedAt).toLocaleString('pt-BR')}` : 'Sincronizado';
            isApplyingRemoteChange = false;
          }
        }
      }
    }, err => {
      console.warn('Realtime sync warning:', err);
      setSyncStatus('offline');
    });
  } catch (err) {
    console.error('Failed to attach realtime sync:', err);
    setSyncStatus('offline');
  }
}

async function checkAndSyncCloud() {
  if (!currentUser || !FB_ON) return;
  try {
    setSyncStatus('syncing');
    const snap = await userDaysRef().get();
    const local = loadLocal();
    let hasChanges = false;
    let activeTabChanged = false;

    snap.forEach(doc => {
      const raw = doc.data();
      const remote = {
        content: raw.content || '',
        tags: raw.tags || [],
        images: raw.images || [],
        checklist: raw.checklist || [],
        updatedAt: raw.updatedAt?.toDate?.()?.toISOString() || raw.updatedAt || null
      };
      if (mergeRemoteDay(doc.id, remote, local)) {
        hasChanges = true;
        if (activeTab === doc.id) activeTabChanged = true;
      }
    });

    if (hasChanges) {
      saveLocal(local);
      renderSidebar($('searchInput')?.value || '');
      renderTagFilterBar();
      renderCalendar();

      if (activeTabChanged && activeTab && local[activeTab] && document.activeElement !== $('editor')) {
        isApplyingRemoteChange = true;
        const day = local[activeTab];
        $('editor').innerHTML = day.content || '';
        currentTags = day.tags ? [...day.tags] : [];
        renderTagsInEditor();
        currentChecklist = day.checklist ? [...day.checklist] : [];
        if (typeof renderChecklist === 'function') renderChecklist();
        if (typeof renderGallery === 'function') renderGallery();
        updateWC();
        $('currentDaySubtitle').textContent = day.updatedAt ? `Última edição: ${new Date(day.updatedAt).toLocaleString('pt-BR')}` : 'Sincronizado';
        isApplyingRemoteChange = false;
      }
    }
    setSyncStatus('synced');
  } catch (err) {
    console.warn('checkAndSyncCloud warning:', err);
    setSyncStatus('offline');
  }
}

async function cloudSaveDay(key, content, tags, images, checklist) {
  if (!db || !currentUser) return;
  try {
    setSyncStatus('syncing');
    await userDaysRef().doc(key).set({ 
      content: content || '', 
      tags: tags || [], 
      images: images || [], 
      checklist: checklist || [], 
      updatedAt: firebase.firestore.FieldValue.serverTimestamp() 
    }, { merge: true });
    setSyncStatus('synced');
  } catch (e) {
    console.error('cloudSaveDay error:', e);
    setSyncStatus('offline');
  }
}

async function cloudDeleteDay(key) {
  if (!db || !currentUser) return;
  try { await userDaysRef().doc(key).delete(); } catch (e) { }
}

async function cloudLoadAll() {
  if (!db || !currentUser) return null;
  try {
    setSyncStatus('syncing');
    const snap = await userDaysRef().get();
    const result = {};
    snap.forEach(doc => { result[doc.id] = { ...doc.data(), updatedAt: doc.data().updatedAt?.toDate?.()?.toISOString() || null }; });
    setSyncStatus('synced');
    return result;
  } catch (e) { setSyncStatus('offline'); return null; }
}

/* ────── Combined get/set (local + cloud) ────── */
async function getDay(k) { return localGetDay(k); }
async function setDay(k, content, tags, images, checklist) {
  localSetDay(k, content, tags, images, checklist);
  if (currentUser) cloudSaveDay(k, content, tags, images, checklist);
}
async function delDay(k) {
  localDelDay(k);
  if (currentUser) cloudDeleteDay(k);
}

/* ────── Theme ────── */
function loadTheme() {
  const saved = localStorage.getItem(SK_THEME); document.documentElement.classList.toggle('light', saved === 'light' || !saved);
  updateThemeBtn();
}
function toggleTheme() {
  const isL = document.documentElement.classList.toggle('light');
  localStorage.setItem(SK_THEME, isL ? 'light' : 'dark');
  $('themeColorMeta').content = isL ? '#f0f2f8' : '#0d0f1a';
  updateThemeBtn();
}
function updateThemeBtn() {
  const isL = document.documentElement.classList.contains('light');
  const lightSvg = '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
  const darkSvg = '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  const iconHtml = isL ? lightSvg : darkSvg;

  if ($('themeToggleBtn')) $('themeToggleBtn').innerHTML = iconHtml;
  if ($('mobileThemeBtn')) $('mobileThemeBtn').innerHTML = iconHtml;
  if ($('authThemeToggleBtn')) $('authThemeToggleBtn').innerHTML = iconHtml;

  const sb = $('settingsThemeBtn');
  if (sb) sb.textContent = isL ? 'Mudar para Escuro' : 'Mudar para Claro';
}

/* ────── Tag colors & Palette ────── */
const TAG_PALETTE = [
  { name: 'blue',   bg: 'rgba(59, 130, 246, 0.16)', text: '#3b82f6', border: 'rgba(59, 130, 246, 0.35)' },
  { name: 'green',  bg: 'rgba(16, 185, 129, 0.16)', text: '#10b981', border: 'rgba(16, 185, 129, 0.35)' },
  { name: 'amber',  bg: 'rgba(245, 158, 11, 0.16)', text: '#f59e0b', border: 'rgba(245, 158, 11, 0.35)' },
  { name: 'purple', bg: 'rgba(139, 92, 246, 0.16)', text: '#8b5cf6', border: 'rgba(139, 92, 246, 0.35)' },
  { name: 'pink',   bg: 'rgba(236, 72, 153, 0.16)', text: '#ec4899', border: 'rgba(236, 72, 153, 0.35)' },
  { name: 'teal',   bg: 'rgba(20, 184, 166, 0.16)', text: '#14b8a6', border: 'rgba(20, 184, 166, 0.35)' },
  { name: 'coral',  bg: 'rgba(239, 68, 68, 0.16)',  text: '#ef4444', border: 'rgba(239, 68, 68, 0.35)' },
  { name: 'indigo', bg: 'rgba(99, 102, 241, 0.16)', text: '#6366f1', border: 'rgba(99, 102, 241, 0.35)' },
  { name: 'cyan',   bg: 'rgba(6, 182, 212, 0.16)',  text: '#06b6d4', border: 'rgba(6, 182, 212, 0.35)' },
  { name: 'orange', bg: 'rgba(249, 115, 22, 0.16)', text: '#f97316', border: 'rgba(249, 115, 22, 0.35)' }
];

function getTagColors(tag) {
  const clean = (tag || '').toLowerCase().trim();
  if (/trabalho|work|trampo|job|empresa|reuniao|projeto/.test(clean)) return TAG_PALETTE[0];
  if (/estudo|facul|curso|livro|ler|aula|escola/.test(clean)) return TAG_PALETTE[1];
  if (/ideia|idea|insight|brainstorm|criativo/.test(clean)) return TAG_PALETTE[2];
  if (/pessoal|vida|saude|treino|familia|casa/.test(clean)) return TAG_PALETTE[3];
  if (/urgente|importante|meta|alerta|prioridade/.test(clean)) return TAG_PALETTE[6];
  if (/financa|dinheiro|grana|invest|banco|pagar/.test(clean)) return TAG_PALETTE[5];

  let hash = 0;
  for (let i = 0; i < clean.length; i++) {
    hash = (hash * 31 + clean.charCodeAt(i)) & 0xffffffff;
  }
  return TAG_PALETTE[Math.abs(hash) % TAG_PALETTE.length];
}

function renderTagChip(name, withDel) {
  const c = getTagColors(name);
  const del = withDel ? `<button class="tag-chip-del" data-tag="${esc(name)}" title="Remover" style="color:inherit;">&#x00D7;</button>` : '';
  return `<span class="tag-chip" style="background:${c.bg}; color:${c.text}; border-color:${c.border};">#${esc(name)}${del}</span>`;
}

/* ────── Toast ────── */
let toastT;
function toast(msg, icon = '✓') { $('toast-msg').textContent = msg; $('toast-icon').innerHTML = icon; $('toast').classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => { $('toast').classList.remove('show'); setTimeout(() => $('toast').classList.remove('error'), 300); }, 2800); }
function showToast(msg, isError = false) { if(isError) $('toast').classList.add('error'); else $('toast').classList.remove('error'); toast(msg, isError ? '!' : '✓'); }

/* ────── Modal ────── */
function openModal({ title, body = '', extra = '', actions }) {
  $('modal-title').textContent = title;
  $('modal-body').textContent = body;
  $('modal-extra').innerHTML = extra;
  $('modal-actions').innerHTML = '';
  actions.forEach(a => {
    const btn = document.createElement('button');
    btn.className = a.cls; btn.textContent = a.label;
    btn.addEventListener('click', () => { if (a.cb) a.cb(); closeModal(); });
    $('modal-actions').appendChild(btn);
  });
  $('modal-overlay').classList.add('show');
  setTimeout(() => { const inp = $('modal-extra').querySelector('input'); if (inp) inp.focus(); }, 60);
}
function closeModal() { $('modal-overlay').classList.remove('show'); }
$('modal-overlay').addEventListener('click', e => { if (e.target === $('modal-overlay')) closeModal(); });


/* ══════════ CÁPSULA DO TEMPO (Recordações do Passado) ══════════ */
function getPastMonthKey(y, m, d, monthsAgo) {
  const dt = new Date(y, m - 1 - monthsAgo, d);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

function checkTimeCapsule(key) {
  const banner = $('timeCapsuleBanner');
  if (!banner) return;
  banner.style.display = 'none';

  if (!key) return;
  const local = loadLocal();
  const [year, month, day] = key.split('-').map(Number);
  if (!year || !month || !day) return;

  const candidates = [
    { label: 'Há 1 ano', key: `${year - 1}-${pad(month)}-${pad(day)}` },
    { label: 'Há 2 anos', key: `${year - 2}-${pad(month)}-${pad(day)}` },
    { label: 'Há 1 mês', key: getPastMonthKey(year, month, day, 1) },
    { label: 'Há 6 meses', key: getPastMonthKey(year, month, day, 6) }
  ];

  for (const cand of candidates) {
    const pastDoc = local[cand.key];
    if (pastDoc && !isContentEmpty(pastDoc.content)) {
      const plain = toPlain(pastDoc.content).slice(0, 110).trim();
      if (plain) {
        if ($('timeCapsuleBadge')) $('timeCapsuleBadge').textContent = `Cápsula do Tempo · ${cand.label}`;
        if ($('timeCapsuleText')) $('timeCapsuleText').textContent = `Neste mesmo dia, você escreveu: "${plain}..."`;
        banner.style.display = 'flex';
        if ($('timeCapsuleViewBtn')) {
          $('timeCapsuleViewBtn').onclick = () => openTab(cand.key);
        }
        if ($('timeCapsuleCloseBtn')) {
          $('timeCapsuleCloseBtn').onclick = () => { banner.style.display = 'none'; };
        }
        return;
      }
    }
  }
}

/* ────── Settings ────── */
function openSettings() {
  const isCloud = !!(currentUser && !currentUser.isAnonymous && FB_ON);
  $('settingsAccountDesc').textContent = isCloud
    ? `Conectado: ${currentUser.email}`
    : (FB_ON ? 'Modo offline (sem conta)' : 'Firebase não configurado');
  $('settingsAuthBtn').textContent = isCloud ? 'Sair' : 'Entrar com conta';
  $('settingsAuthBtn').onclick = () => { closeSettings(); isCloud ? doLogout() : showAuthScreen(); };
  const d = loadLocal(); const days = Object.keys(d).length;
  const chars = Object.values(d).reduce((a, x) => a + toPlain(x.content || '').length, 0);
  $('dataStats').textContent = `${days} dia(s), ~${chars} caracteres`;
  updateThemeBtn();
  updateSpotifySettings();
  updateNotifSettings();
  $('settings-overlay').classList.add('show');
}
function closeSettings() { $('settings-overlay').classList.remove('show'); }
$('settings-overlay').addEventListener('click', e => { if (e.target === $('settings-overlay')) closeSettings(); });
$('settingsCloseBtn').addEventListener('click', closeSettings);
$('settingsBtn').addEventListener('click', openSettings);
$('settingsThemeBtn').addEventListener('click', () => { toggleTheme(); });
$('settingsBackupBtn').addEventListener('click', () => { closeSettings(); doBackup(); });
$('settingsRestoreBtn').addEventListener('click', () => { closeSettings(); doRestore(); });
if ($('settingsExportMdBtn')) {
  $('settingsExportMdBtn').addEventListener('click', () => { closeSettings(); exportAllMarkdown(); });
}

/* ────── AUTH SCREEN ────── */
let authMode = 'login';

function showAuthScreen() {
  if (!FB_ON) { goOffline(); return; }
  $('authScreen').style.display = 'flex';
  $('app').style.display = 'none';
}

function hideAuthScreen() {
  $('authScreen').style.display = 'none';
  $('app').style.display = 'flex';
}

$('tabLogin').addEventListener('click', () => setAuthMode('login'));
$('tabRegister').addEventListener('click', () => setAuthMode('register'));

function setAuthMode(mode) {
  authMode = mode;
  $('tabLogin').classList.toggle('active', mode === 'login');
  $('tabRegister').classList.toggle('active', mode === 'register');
  $('confirmField').style.display = mode === 'register' ? '' : 'none';
  $('authBtnLabel').textContent = mode === 'login' ? 'Entrar no PersonalMk' : 'Criar conta gratuita';
  $('authErr').textContent = '';
  $('authPassword').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
}

$('passToggle').addEventListener('click', () => {
  const inp = $('authPassword');
  inp.type = inp.type === 'password' ? 'text' : 'password';
});

$('authSubmitBtn').addEventListener('click', doAuth);
['authEmail', 'authPassword', 'authConfirm'].forEach(id => {
  $(id).addEventListener('keydown', e => { if (e.key === 'Enter') doAuth(); });
});

async function doAuth() {
  const email = $('authEmail').value.trim();
  const pass = $('authPassword').value;
  const confirm = $('authConfirm').value;
  const errEl = $('authErr');
  const btn = $('authSubmitBtn');

  if (!email || !pass) { errEl.textContent = 'Preencha email e senha.'; return; }
  if (authMode === 'register' && pass !== confirm) { errEl.textContent = 'As senhas não coincidem.'; return; }
  if (pass.length < 6) { errEl.textContent = 'Senha deve ter ao menos 6 caracteres.'; return; }

  btn.disabled = true;
  $('authBtnLabel').innerHTML = '<div class="auth-spinner"></div>';
  errEl.textContent = '';

  try {
    if (authMode === 'login') {
      await auth.signInWithEmailAndPassword(email, pass);
    } else {
      await auth.createUserWithEmailAndPassword(email, pass);
    }
    // auth.onAuthStateChanged will handle the rest
  } catch (e) {
    const msgs = {
      'auth/user-not-found': 'Email não encontrado.',
      'auth/wrong-password': 'Senha incorreta. Tente novamente.',
      'auth/email-already-in-use': 'Email já cadastrado.',
      'auth/invalid-email': 'Email inválido.',
      'auth/too-many-requests': 'Muitas tentativas. Tente mais tarde.',
      'auth/network-request-failed': 'Sem conexão de rede. Tente o modo offline.',
    };
    errEl.textContent = msgs[e.code] || 'Erro: ' + e.message;
    btn.disabled = false;
    $('authBtnLabel').textContent = authMode === 'login' ? 'Entrar no PersonalMk' : 'Criar conta gratuita';
  }
}

$('authOfflineBtn')?.addEventListener('click', goOffline);
$('authNavOfflineBtn')?.addEventListener('click', goOffline);
$('authThemeToggleBtn')?.addEventListener('click', toggleTheme);
$('mobileThemeBtn')?.addEventListener('click', toggleTheme);

function goOffline() {
  currentUser = null;
  localStorage.setItem(SK_MODE, 'offline');
  hideAuthScreen();
  setSyncStatus('offline');
  updateUserBar();
  initApp();
}

function doLogout() {
  if (realtimeUnsubscribe) {
    try { realtimeUnsubscribe(); } catch (e) {}
    realtimeUnsubscribe = null;
  }
  if (auth) auth.signOut();
  currentUser = null;
  localStorage.setItem(SK_MODE, 'offline');
  // Reset state
  openTabs = []; activeTab = null;
  renderTabs(); showWelcome();
  renderSidebar(); renderCalendar(); renderTagFilterBar();
  updateUserBar();
  if (FB_ON) showAuthScreen();
}

$('logoutBtn').addEventListener('click', () => {
  if (!currentUser) {
    showAuthScreen();
    return;
  }
  openModal({
    title: 'Sair da conta',
    body: 'Deseja sair? Seus dados locais continuarão salvos.',
    actions: [
      { label: 'Cancelar', cls: 'btn-cancel' },
      { label: 'Sair', cls: 'btn-danger', cb: doLogout }
    ]
  });
});

$('mobileSyncIndicator')?.addEventListener('click', () => {
  if (!currentUser) {
    showToast('Modo offline ativo. Faça login para sincronizar com o PC!', true);
    setTimeout(showAuthScreen, 600);
  } else {
    showToast(`Nuvem ativa (${currentUser.email || 'Conectado'}) · Sincronizando...`, false);
    checkAndSyncCloud();
  }
});


const avatarInput = document.createElement('input');
avatarInput.type = 'file';
avatarInput.accept = 'image/*';
avatarInput.style.display = 'none';
document.body.appendChild(avatarInput);

$('userAvatar').addEventListener('click', () => avatarInput.click());

avatarInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (event) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const size = 150;
      canvas.width = size;
      canvas.height = size;

      const minDim = Math.min(img.width, img.height);
      const startX = (img.width - minDim) / 2;
      const startY = (img.height - minDim) / 2;

      ctx.drawImage(img, startX, startY, minDim, minDim, 0, 0, size, size);
      const base64 = canvas.toDataURL('image/jpeg', 0.8);

      localStorage.setItem('userAvatarBase64', base64);
      $('userAvatar').innerHTML = '<img src="' + base64 + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';

      if (currentUser && FB_ON) {
        db.collection('users').doc(currentUser.uid).set({ avatar: base64 }, { merge: true });
      }
    };
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
});
function updateUserBar() {
  const bar = $('userBar');
  if (currentUser && !currentUser.isAnonymous) {
    bar.style.display = 'flex';
    const email = currentUser.email || '';
    $('userEmail').textContent = email;
    const savedAvatar = localStorage.getItem('userAvatarBase64');
    if (savedAvatar) $('userAvatar').innerHTML = '<img src="' + savedAvatar + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
    else $('userAvatar').textContent = (email[0] || '?').toUpperCase();
    $('userMode').textContent = FB_ON ? 'Sincronizado na nuvem' : 'Modo local';
    const lBtn = $('logoutBtn');
    if (lBtn) {
      lBtn.title = 'Sair da conta';
      lBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>';
    }
    setSyncStatus('synced');
  } else if (currentUser === null) {
    bar.style.display = 'flex';
    $('userEmail').textContent = 'Modo offline';
    $('userAvatar').innerHTML = '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
    $('userMode').textContent = 'Toque para entrar / sincronizar';
    const lBtn = $('logoutBtn');
    if (lBtn) {
      lBtn.title = 'Fazer Login / Conectar';
      lBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>';
    }
    setSyncStatus('offline');
  } else {
    bar.style.display = 'none';
  }
}
/* ────── Fuzzy Search Engine ────── */
function normalizeStr(str) {
  return (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function levenshteinDist(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const row = [];
  for (let i = 0; i <= b.length; i++) row[i] = i;

  for (let i = 1; i <= a.length; i++) {
    let prev = i;
    for (let j = 1; j <= b.length; j++) {
      let val;
      if (a[i - 1] === b[j - 1]) {
        val = row[j - 1];
      } else {
        val = Math.min(row[j - 1] + 1, prev + 1, row[j] + 1);
      }
      row[j - 1] = prev;
      prev = val;
    }
    row[b.length] = prev;
  }
  return row[b.length];
}

function fuzzyMatch(targetText, query) {
  const normTarget = normalizeStr(targetText);
  const normQuery = normalizeStr(query);
  if (!normQuery) return true;
  if (!normTarget) return false;

  // Direct substring match
  if (normTarget.includes(normQuery)) return true;

  const qTokens = normQuery.split(/\s+/).filter(Boolean);
  const tTokens = normTarget.split(/[\s,.;:!?\-_/\\()\[\]{}'"]+/).filter(Boolean);

  return qTokens.every(qTok => {
    if (qTok.length <= 2) {
      return normTarget.includes(qTok);
    }
    return tTokens.some(tTok => {
      if (tTok.includes(qTok) || qTok.includes(tTok)) return true;
      const maxDist = qTok.length >= 6 ? 2 : (qTok.length >= 4 ? 1 : 0);
      if (Math.abs(tTok.length - qTok.length) <= maxDist) {
        return levenshteinDist(qTok, tTok) <= maxDist;
      }
      return false;
    });
  });
}

function fuzzySearchNotes(query, activeTag) {
  const rawQ = (query || '').trim();
  const isTagOnly = rawQ.startsWith('#');
  const cleanQ = isTagOnly ? rawQ.slice(1) : rawQ;

  const data = loadLocal();
  const keys = Object.keys(data).sort().reverse();

  const results = [];
  keys.forEach(k => {
    const day = data[k] || {};
    const tags = day.tags || [];
    const content = toPlain(day.content || '');
    const checklistTexts = (day.checklist || []).map(item => item.text || '').join(' ');
    const fullDate = fmtFull(k);
    const shortDate = fmtShort(k);

    if (activeTag && !tags.includes(activeTag)) return;

    if (!cleanQ) {
      results.push({ key: k, day, matchScore: 1, preview: content.slice(0, 75).trim() || 'Sem conteúdo' });
      return;
    }

    if (isTagOnly) {
      const matchTag = tags.some(t => fuzzyMatch(t, cleanQ));
      if (matchTag) {
        results.push({ key: k, day, matchScore: 2, preview: content.slice(0, 75).trim() || 'Sem conteúdo' });
      }
      return;
    }

    const dateMatch = fuzzyMatch(fullDate, cleanQ) || fuzzyMatch(shortDate, cleanQ) || fuzzyMatch(k, cleanQ);
    const tagMatch = tags.some(t => fuzzyMatch(t, cleanQ));
    const contentMatch = fuzzyMatch(content, cleanQ);
    const checkMatch = fuzzyMatch(checklistTexts, cleanQ);

    if (dateMatch || tagMatch || contentMatch || checkMatch) {
      let score = 1;
      if (dateMatch) score += 3;
      if (tagMatch) score += 2;
      if (contentMatch) score += 1;

      let preview = content.slice(0, 75).trim();
      const normContent = normalizeStr(content);
      const normQ = normalizeStr(cleanQ);
      const idx = normContent.indexOf(normQ);
      if (idx !== -1) {
        const start = Math.max(0, idx - 25);
        const end = Math.min(content.length, idx + normQ.length + 50);
        preview = (start > 0 ? '...' : '') + content.slice(start, end).trim() + (end < content.length ? '...' : '');
      }

      results.push({ key: k, day, matchScore: score, preview: preview || 'Sem conteúdo' });
    }
  });

  return results.sort((a, b) => b.matchScore - a.matchScore);
}

let activeTagFilter = null;
function renderTagFilterBar() {
  const all = new Set();
  Object.values(loadLocal()).forEach(d => (d.tags || []).forEach(t => all.add(t)));
  const bar = $('tagFilterBar');
  if (!all.size) { bar.innerHTML = ''; return; }

  let html = [...all].map(t => {
    const c = getTagColors(t);
    const isAct = activeTagFilter === t;
    const ac = isAct ? ' active' : '';
    const style = isAct
      ? `background:${c.text}; color:#ffffff; border-color:${c.text};`
      : `background:${c.bg}; color:${c.text}; border-color:${c.border};`;
    return `<span class="tag-filter-chip${ac}" data-tag="${esc(t)}" style="${style}">#${esc(t)}</span>`;
  }).join('');

  if (activeTagFilter) {
    html += `<span class="tag-filter-clear" id="tagFilterClearBtn" title="Limpar filtro de tag">&#x00D7; Limpar</span>`;
  }

  bar.innerHTML = html;

  bar.querySelectorAll('.tag-filter-chip').forEach(el => {
    el.addEventListener('click', () => {
      activeTagFilter = activeTagFilter === el.dataset.tag ? null : el.dataset.tag;
      renderTagFilterBar();
      renderSidebar($('searchInput').value);
    });
  });

  const clearBtn = $('tagFilterClearBtn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      activeTagFilter = null;
      renderTagFilterBar();
      renderSidebar($('searchInput').value);
    });
  }
}

function renderSidebar(filter) {
  const results = fuzzySearchNotes(filter, activeTagFilter);
  if (!results.length) {
    $('daysList').innerHTML = `<div class="empty-msg">${filter || activeTagFilter ? 'Nenhum resultado encontrado.' : 'Nenhuma anotação ainda.<br>Clique em <b>Nova Anotação</b>.'}</div>`;
    return;
  }

  $('daysList').innerHTML = results.map(item => {
    const k = item.key;
    const d = item.day;
    const c = d.content || '';
    let preview = item.preview || toPlain(c).slice(0, 52).trim();
    if (!preview) {
      if (/<(img|svg)\b/i.test(c) || (d.images && d.images.length > 0)) {
        preview = 'Imagem anexada';
      } else if (d.checklist && d.checklist.length > 0) {
        const doneCount = d.checklist.filter(x => x.done).length;
        preview = `${doneCount}/${d.checklist.length} tarefas`;
      } else {
        preview = 'Sem conteúdo';
      }
    }
    const ac = k === activeTab ? ' active' : '';
    const hc = (c.trim().length || (d.images && d.images.length) || (d.checklist && d.checklist.length)) ? ' has-content' : '';

    const chips = tags.slice(0, 2).map(t => {
      const col = getTagColors(t);
      return `<span class="day-tag-chip" data-tag="${esc(t)}" style="background:${col.bg}; color:${col.text}; border-color:${col.border};">#${esc(t)}</span>`;
    }).join('');

    return `<div class="day-item${ac}${hc}" data-key="${k}" tabindex="0">
      <div class="day-dot"></div>
      <div class="day-item-info">
        <div class="day-item-date">${esc(fmtShort(k))}</div>
        <div class="day-item-meta">${chips}<span class="day-item-preview">${esc(preview)}</span></div>
      </div>
      <button class="day-item-del" data-del="${k}" title="Excluir anotação">&#x00D7;</button>
    </div>`;
  }).join('');

  $('daysList').querySelectorAll('.day-item').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('.day-item-del')) return;
      if (e.target.closest('.day-tag-chip')) {
        const tag = e.target.closest('.day-tag-chip').dataset.tag;
        activeTagFilter = activeTagFilter === tag ? null : tag;
        renderTagFilterBar();
        renderSidebar($('searchInput').value);
        return;
      }
      openTab(el.dataset.key);
    });
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') openTab(el.dataset.key); });
  });

  $('daysList').querySelectorAll('.day-item-del').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); confirmDelete(btn.dataset.del); });
  });
}

/* ────── Quick Search Modal (Ctrl+K / /) ────── */
let quickSearchSelectedIdx = 0;
let quickSearchResultsList = [];

function openQuickSearch() {
  const overlay = $('quicksearch-overlay');
  const input = $('quickSearchInput');
  if (!overlay || !input) return;
  overlay.classList.add('show');
  input.value = '';
  quickSearchSelectedIdx = 0;
  renderQuickSearchResults('');
  setTimeout(() => input.focus(), 60);
}

function closeQuickSearch() {
  const overlay = $('quicksearch-overlay');
  if (overlay) overlay.classList.remove('show');
}

function renderQuickSearchResults(query) {
  const container = $('quickSearchResults');
  if (!container) return;

  quickSearchResultsList = fuzzySearchNotes(query, null);
  if (!quickSearchResultsList.length) {
    container.innerHTML = `<div class="quicksearch-empty">Nenhuma anotação encontrada para "<b>${esc(query)}</b>"</div>`;
    return;
  }

  if (quickSearchSelectedIdx >= quickSearchResultsList.length) {
    quickSearchSelectedIdx = 0;
  }

  container.innerHTML = quickSearchResultsList.slice(0, 15).map((item, idx) => {
    const isAct = idx === quickSearchSelectedIdx ? ' active' : '';
    const tags = (item.day.tags || []).slice(0, 3).map(t => {
      const c = getTagColors(t);
      return `<span class="day-tag-chip" style="background:${c.bg}; color:${c.text}; border-color:${c.border}; font-size:10px;">#${esc(t)}</span>`;
    }).join('');

    return `<div class="quicksearch-item${isAct}" data-idx="${idx}" data-key="${item.key}">
      <div class="quicksearch-item-top">
        <div class="quicksearch-item-date">${esc(fmtFull(item.key))}</div>
        <div class="quicksearch-item-tags">${tags}</div>
      </div>
      <div class="quicksearch-item-preview">${esc(item.preview)}</div>
    </div>`;
  }).join('');

  container.querySelectorAll('.quicksearch-item').forEach(el => {
    el.addEventListener('click', () => {
      openTab(el.dataset.key);
      closeQuickSearch();
    });
  });
}

if ($('quickSearchInput')) {
  $('quickSearchInput').addEventListener('input', e => {
    quickSearchSelectedIdx = 0;
    renderQuickSearchResults(e.target.value);
  });

  $('quickSearchInput').addEventListener('keydown', e => {
    const items = $('quickSearchResults')?.querySelectorAll('.quicksearch-item');
    if (!items || !items.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      quickSearchSelectedIdx = (quickSearchSelectedIdx + 1) % items.length;
      items.forEach((el, idx) => el.classList.toggle('active', idx === quickSearchSelectedIdx));
      items[quickSearchSelectedIdx]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      quickSearchSelectedIdx = (quickSearchSelectedIdx - 1 + items.length) % items.length;
      items.forEach((el, idx) => el.classList.toggle('active', idx === quickSearchSelectedIdx));
      items[quickSearchSelectedIdx]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const activeEl = items[quickSearchSelectedIdx];
      if (activeEl) {
        openTab(activeEl.dataset.key);
        closeQuickSearch();
      }
    } else if (e.key === 'Escape') {
      closeQuickSearch();
    }
  });
}

if ($('quicksearch-overlay')) {
  $('quicksearch-overlay').addEventListener('click', e => {
    if (e.target === $('quicksearch-overlay')) closeQuickSearch();
  });
}


let calYear = new Date().getFullYear(), calMonth = new Date().getMonth();
let calView = 'days'; // 'days' | 'months' | 'years'
let calDecadeStart = Math.floor(calYear / 12) * 12;

const MONTH_NAMES_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function renderCalendar() {
  const notes = new Set(allKeys());
  const now = new Date();
  const nowYear = now.getFullYear();
  const nowMonth = now.getMonth();
  const today = todayKey();

  const labelEl = $('calMonthLabel');
  const labelTextEl = $('calMonthLabelText');

  if (labelEl) {
    labelEl.classList.toggle('open-view', calView !== 'days');
  }

  // Update Footer ("Hoje: DD/MM/AAAA")
  const todayBtn = $('calTodayBtn');
  if (todayBtn) {
    todayBtn.textContent = `Hoje: ${now.toLocaleDateString('pt-BR')}`;
  }

  if (calView === 'days') {
    // Label: "Outubro de 2026"
    const rawMonth = new Date(calYear, calMonth, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    const formattedTitle = rawMonth.charAt(0).toUpperCase() + rawMonth.slice(1);
    if (labelTextEl) labelTextEl.textContent = formattedTitle;
    else if (labelEl) labelEl.textContent = formattedTitle;

    const first = new Date(calYear, calMonth, 1).getDay();
    const days = new Date(calYear, calMonth + 1, 0).getDate();

    let html = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map(d => `<div class="cal-dow">${d}</div>`).join('');
    for (let i = 0; i < first; i++) html += `<div class="cal-day empty"></div>`;
    for (let d = 1; d <= days; d++) {
      const k = `${calYear}-${pad(calMonth + 1)}-${pad(d)}`;
      let cls = 'cal-day';
      if (k === today) cls += ' today';
      if (notes.has(k)) cls += ' has-note';
      if (k === activeTab) cls += ' active-day';
      html += `<div class="${cls}" data-key="${k}">${d}</div>`;
    }

    $('calGrid').className = 'cal-grid cal-grid-days';
    $('calGrid').innerHTML = html;
    $('calGrid').querySelectorAll('.cal-day:not(.empty)').forEach(el => {
      el.addEventListener('click', () => { createOrOpen(el.dataset.key); closeSidebar(); });
    });

  } else if (calView === 'months') {
    // Label: "2026"
    const formattedTitle = `${calYear}`;
    if (labelTextEl) labelTextEl.textContent = formattedTitle;
    else if (labelEl) labelEl.textContent = formattedTitle;

    let html = '';
    for (let m = 0; m < 12; m++) {
      const isSelected = (m === calMonth);
      const isCurrent = (calYear === nowYear && m === nowMonth);
      const prefix = `${calYear}-${pad(m + 1)}`;
      let hasNote = false;
      for (const k of notes) {
        if (k.startsWith(prefix)) { hasNote = true; break; }
      }

      let cls = 'cal-month-cell';
      if (isSelected) cls += ' selected-month';
      if (isCurrent) cls += ' current-month';
      if (hasNote) cls += ' has-note';

      html += `<div class="${cls}" data-month="${m}">${MONTH_NAMES_SHORT[m]}</div>`;
    }

    $('calGrid').className = 'cal-grid cal-grid-months';
    $('calGrid').innerHTML = html;
    $('calGrid').querySelectorAll('.cal-month-cell').forEach(el => {
      el.addEventListener('click', () => {
        calMonth = parseInt(el.dataset.month, 10);
        calView = 'days';
        renderCalendar();
      });
    });

  } else if (calView === 'years') {
    // Label: "2020 – 2031"
    const endYear = calDecadeStart + 11;
    const formattedTitle = `${calDecadeStart} – ${endYear}`;
    if (labelTextEl) labelTextEl.textContent = formattedTitle;
    else if (labelEl) labelEl.textContent = formattedTitle;

    let html = '';
    for (let y = calDecadeStart; y <= endYear; y++) {
      const isSelected = (y === calYear);
      const isCurrent = (y === nowYear);
      const prefix = `${y}-`;
      let hasNote = false;
      for (const k of notes) {
        if (k.startsWith(prefix)) { hasNote = true; break; }
      }

      let cls = 'cal-year-cell';
      if (isSelected) cls += ' selected-year';
      if (isCurrent) cls += ' current-year';
      if (hasNote) cls += ' has-note';

      html += `<div class="${cls}" data-year="${y}">${y}</div>`;
    }

    $('calGrid').className = 'cal-grid cal-grid-years';
    $('calGrid').innerHTML = html;
    $('calGrid').querySelectorAll('.cal-year-cell').forEach(el => {
      el.addEventListener('click', () => {
        calYear = parseInt(el.dataset.year, 10);
        calView = 'months';
        renderCalendar();
      });
    });
  }
}

$('calPrev').addEventListener('click', () => {
  if (calView === 'days') {
    calMonth--;
    if (calMonth < 0) { calMonth = 11; calYear--; }
  } else if (calView === 'months') {
    calYear--;
  } else if (calView === 'years') {
    calDecadeStart -= 12;
  }
  renderCalendar();
});

$('calNext').addEventListener('click', () => {
  if (calView === 'days') {
    calMonth++;
    if (calMonth > 11) { calMonth = 0; calYear++; }
  } else if (calView === 'months') {
    calYear++;
  } else if (calView === 'years') {
    calDecadeStart += 12;
  }
  renderCalendar();
});

$('calMonthLabel')?.addEventListener('click', () => {
  if (calView === 'days') {
    calView = 'months';
  } else if (calView === 'months') {
    calDecadeStart = Math.floor(calYear / 12) * 12;
    calView = 'years';
  } else {
    calView = 'days';
  }
  renderCalendar();
});

$('calTodayBtn')?.addEventListener('click', () => {
  const now = new Date();
  calYear = now.getFullYear();
  calMonth = now.getMonth();
  calView = 'days';
  renderCalendar();
  createOrOpen(todayKey());
  if (window.innerWidth <= 768) closeSidebar();
});

function openSidebar() {
  $('sidebar').classList.add('open');
  $('sidebarBackdrop').classList.add('show');
}
function closeSidebar() {
  $('sidebar').classList.remove('open');
  $('sidebarBackdrop').classList.remove('show');
  if (window.innerWidth <= 768 && location.hash !== '#editor') {
    history.pushState({ editor: true }, '', '#editor');
  }
}
window.addEventListener('popstate', (e) => {
  if (window.innerWidth <= 768) {
    if (location.hash !== '#editor') openSidebar();
    else closeSidebar();
  }
});
function toggleMobileSidebar() {
  $('sidebar').classList.contains('open') ? closeSidebar() : openSidebar();
}

$('hamburgerBtn')?.addEventListener('click', () => {
  if (window.innerWidth <= 768) {
    toggleMobileSidebar();
  } else {
    $('sidebar').classList.remove('collapsed');
  }
});
$('mobileMenuBtn')?.addEventListener('click', toggleMobileSidebar);
$('mobileCloseSidebarBtn')?.addEventListener('click', closeSidebar);
$('mobileNewDayBtn')?.addEventListener('click', () => { closeSidebar(); pickDateModal(); });
$('mobileSettingsBtn')?.addEventListener('click', () => { closeSidebar(); openSettings(); });

// Gestos touch de swipe para abrir/fechar sidebar no celular
let touchStartX = 0, touchStartY = 0;
document.addEventListener('touchstart', e => {
  if (e.touches && e.touches.length === 1) {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }
}, { passive: true });

document.addEventListener('touchend', e => {
  if (window.innerWidth > 768 || !e.changedTouches) return;
  const dx = e.changedTouches[0].clientX - touchStartX;
  const dy = e.changedTouches[0].clientY - touchStartY;
  if (Math.abs(dx) > 65 && Math.abs(dy) < 60) {
    if (dx > 0 && touchStartX < 55 && !$('sidebar').classList.contains('open')) {
      openSidebar();
    } else if (dx < 0 && $('sidebar').classList.contains('open')) {
      closeSidebar();
    }
  }
}, { passive: true });

$('collapseSidebarBtn').addEventListener('click', () => {
  $('sidebar').classList.add('collapsed');
});
$('sidebarBackdrop').addEventListener('click', closeSidebar);
$('daysList').addEventListener('click', () => { if (window.innerWidth <= 768) closeSidebar(); });
$('newDayBtn').addEventListener('click', () => { if (window.innerWidth <= 768) closeSidebar(); pickDateModal(); });

/* ────── Tabs ────── */
let openTabs = [], activeTab = null;
function renderTabs() {
  const ham = $('hamburgerBtn').cloneNode(true);
  $('tabsBar').innerHTML = '';
  $('tabsBar').appendChild(ham);
  ham.addEventListener('click', () => {
    if (window.innerWidth <= 768) {
      $('sidebar').classList.contains('open') ? closeSidebar() : openSidebar();
    } else {
      $('sidebar').classList.remove('collapsed');
    }
  });
  openTabs.forEach(k => {
    const ac = k === activeTab ? ' active' : '';
    const tab = document.createElement('div');
    tab.className = `tab${ac}`; tab.dataset.key = k; tab.tabIndex = 0;
    tab.innerHTML = `<span>${esc(fmtTab(k))}</span><span class="tab-close" data-close="${k}">&#x00D7;</span>`;
    tab.addEventListener('click', e => { if (e.target.closest('.tab-close')) return; activateTab(k); });
    tab.querySelector('.tab-close').addEventListener('click', e => { e.stopPropagation(); closeTab(k); });
    $('tabsBar').appendChild(tab);
  });
}

function openTab(key) {
  const d = loadLocal();
  if (!d[key]) { d[key] = { content: '', updatedAt: null, tags: [], images: [], checklist: [] }; saveLocal(d); }
  if (!openTabs.includes(key)) openTabs.push(key);
  activateTab(key);
}
function activateTab(key) {
  activeTab = key;
  const d = keyToDate(key);
  calYear = d.getFullYear();
  calMonth = d.getMonth();
  calView = 'days';
  renderTabs(); renderSidebar($('searchInput').value); renderCalendar(); showEditor(key);
}
function closeTab(key) {
  openTabs = openTabs.filter(k => k !== key);
  if (activeTab === key) activeTab = openTabs[openTabs.length - 1] || null;
  renderTabs();
  if (activeTab) { renderSidebar($('searchInput').value); showEditor(activeTab); }
  else { showWelcome(); renderSidebar($('searchInput').value); }
  renderCalendar();
}
function showWelcome() { 
  $('welcome').style.display = 'flex'; 
  $('editorPane').style.display = 'none'; 
  if ($('mobileHeaderTitle')) $('mobileHeaderTitle').textContent = 'PersonalMk';
}

let currentTags = [];
let currentChecklist = [];

function showEditor(key) {
  $('welcome').style.display = 'none'; $('editorPane').style.display = 'flex';
  const day = localGetDay(key);
  $('editor').innerHTML = day.content || '';
  const title = fmtFull(key);
  $('currentDayTitle').textContent = title;
  if ($('mobileHeaderTitle')) $('mobileHeaderTitle').textContent = 'PersonalMk';
  checkTimeCapsule(key);
  const upd = day.updatedAt ? new Date(day.updatedAt).toLocaleString('pt-BR') : null;
  $('currentDaySubtitle').textContent = upd ? `Última edição: ${upd}` : 'Novo registro';
  currentTags = [...(day.tags || [])];
  currentChecklist = [...(day.checklist || [])];
  renderTagsInEditor();
  if ($('tabChecklist') && $('tabChecklist').classList.contains('active')) {
    renderChecklist();
  }
  if ($('tabGallery') && $('tabGallery').classList.contains('active')) {
    renderGallery();
  }
  setSave('saved'); updateWC();
  if (window.innerWidth > 768) {
    $('editor').focus();
  }
}
function setSave(s) {
  $('saveStatus').className = '';
  const icon = $('saveStatusIcon');
  if (s === 'saved') {
    $('saveStatus').classList.add('saved');
    $('saveStatusText').textContent = 'Salvo';
    if (icon) icon.innerHTML = '<polyline points="20 6 9 17 4 12"></polyline>';
  } else {
    $('saveStatus').classList.add('saving');
    $('saveStatusText').textContent = 'Salvando...';
    if (icon) icon.innerHTML = '<path d="M21 12a9 9 0 1 1-6.219-8.56"></path>';
  }
}
function updateWC() {
  const t = toPlain($('editor').innerHTML); const w = cWords(t); const c = t.length;
  $('wc-words').textContent = `${w} ${w === 1 ? 'palavra' : 'palavras'}`;
  $('wc-chars').textContent = `${c} ${c === 1 ? 'caractere' : 'caracteres'}`;
}
async function saveCurrent() {
  if (!activeTab || isApplyingRemoteChange) return;
  const day = localGetDay(activeTab); 
  await setDay(activeTab, $('editor').innerHTML, currentTags, day.images, currentChecklist);
  setSave('saved'); renderSidebar($('searchInput').value); renderTagFilterBar(); renderCalendar();
  $('currentDaySubtitle').textContent = `Última edição: ${new Date().toLocaleString('pt-BR')}`;
}
const doSave = debounce(saveCurrent, 700);
function handleCalculator() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const node = sel.focusNode;
  if (node && node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent;
    const match = text.match(/([0-9][0-9\.\s\+\-\*\/\(\)]*)=$/);
    if (match) {
      try {
        const expr = match[1].replace(/[^-()\d/*+.]/g, '');
        if (!expr) return;
        const res = new Function('return ' + expr)();
        if (isFinite(res)) {
          const replaced = text.replace(match[0], match[0] + ' ' + res);
          node.textContent = replaced;
          const range = document.createRange();
          range.setStart(node, replaced.length);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      } catch (e) { }
    }
  }
}

$('editor').addEventListener('input', () => { handleCalculator(); setSave('saving'); updateWC(); doSave(); });

/* Tags in editor */
function renderTagsInEditor() {
  const tc = $('tagsContainer');
  tc.innerHTML = currentTags.map(t => renderTagChip(t, true)).join('');
  tc.querySelectorAll('.tag-chip-del').forEach(btn => {
    btn.addEventListener('click', () => {
      currentTags = currentTags.filter(x => x !== btn.dataset.tag);
      renderTagsInEditor(); saveCurrent();
    });
  });
}
$('tagInputWrap').addEventListener('click', () => $('tagInput').focus());
$('tagInput').addEventListener('keydown', e => {
  const val = $('tagInput').value.trim().replace(/^#/, '').toLowerCase().replace(/\s+/g, '-');
  if ((e.key === 'Enter' || e.key === ',') && val) {
    e.preventDefault();
    if (!currentTags.includes(val)) currentTags.push(val);
    $('tagInput').value = '';
    renderTagsInEditor(); renderTagFilterBar(); saveCurrent();
  }
  if (e.key === 'Backspace' && !$('tagInput').value && currentTags.length) {
    currentTags.pop(); renderTagsInEditor(); saveCurrent();
  }
});

/* ────── Toolbar ────── */
function cmd(c, v) { $('editor').focus(); document.execCommand(c, false, v || null); }
$('tb-bold').addEventListener('click', () => cmd('bold'));
$('tb-italic').addEventListener('click', () => cmd('italic'));
$('tb-underline').addEventListener('click', () => cmd('underline'));
$('tb-strike').addEventListener('click', () => cmd('strikeThrough'));
$('tb-mark').addEventListener('click', () => cmd('hiliteColor', 'rgba(245,158,11,0.35)'));
$('tb-h1').addEventListener('click', () => cmd('formatBlock', 'h1'));
$('tb-h2').addEventListener('click', () => cmd('formatBlock', 'h2'));
$('tb-h3').addEventListener('click', () => cmd('formatBlock', 'h3'));
$('tb-ul').addEventListener('click', () => cmd('insertUnorderedList'));
$('tb-ol').addEventListener('click', () => cmd('insertOrderedList'));
$('tb-quote').addEventListener('click', () => cmd('formatBlock', 'blockquote'));
$('tb-hr').addEventListener('click', () => cmd('insertHorizontalRule'));
$('tb-code').addEventListener('click', () => {
  const sel = window.getSelection();
  if (sel && sel.toString()) { try { const code = document.createElement('code'); sel.getRangeAt(0).surroundContents(code); $('editor').dispatchEvent(new Event('input')); } catch (e) { } }
});
$('tb-clear').addEventListener('click', () => cmd('removeFormat'));
$('editor').addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey) {
    if (e.key === 'b') { e.preventDefault(); cmd('bold'); }
    if (e.key === 'i') { e.preventDefault(); cmd('italic'); }
    if (e.key === 'u') { e.preventDefault(); cmd('underline'); }
  }
});

/* ────── New day ────── */
function createOrOpen(key) {
  const existed = allKeys().includes(key);
  openTab(key);
  if (!existed) toast('Nova anotação criada!', '');
}
function pickDateModal() {
  openModal({
    title: 'Nova Anotação', body: 'Escolha a data:',
    extra: `<div><input type="date" class="date-modal-input" id="datePickInput" value="${todayKey()}"/></div>`,
    actions: [
      { label: 'Cancelar', cls: 'btn-cancel' },
      { label: 'Abrir', cls: 'btn-primary', cb: () => { const v = $('datePickInput')?.value; if (v) createOrOpen(v); } }
    ]
  });
}
$('welcomeBtn').addEventListener('click', () => createOrOpen(todayKey()));

/* ────── Delete ────── */
function confirmDelete(key) {
  openModal({
    title: 'Excluir anotação',
    body: `Excluir "${fmtShort(key)}"? Não pode ser desfeito.`,
    actions: [
      { label: 'Cancelar', cls: 'btn-cancel' },
      {
        label: 'Excluir', cls: 'btn-danger', cb: async () => {
          await delDay(key);
          if (openTabs.includes(key)) closeTab(key);
          else { renderSidebar($('searchInput').value); renderCalendar(); }
          renderTagFilterBar(); toast('Anotação excluída.', '');
        }
      }
    ]
  });
}
$('deleteCurrentBtn').addEventListener('click', () => { if (activeTab) confirmDelete(activeTab); });

/* ────── Markdown Converter & Export ────── */
function htmlToMarkdown(html) {
  if (!html) return '';
  const div = document.createElement('div');
  div.innerHTML = html;

  function nodeToMd(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const tag = node.tagName.toLowerCase();
    const children = Array.from(node.childNodes).map(nodeToMd).join('');

    switch (tag) {
      case 'h1': return `\n# ${children.trim()}\n\n`;
      case 'h2': return `\n## ${children.trim()}\n\n`;
      case 'h3': return `\n### ${children.trim()}\n\n`;
      case 'b':
      case 'strong': return `**${children}**`;
      case 'i':
      case 'em': return `*${children}*`;
      case 'u': return `<u>${children}</u>`;
      case 's':
      case 'strike': return `~~${children}~~`;
      case 'code': return `\`${children}\``;
      case 'blockquote': return `\n> ${children.trim()}\n\n`;
      case 'hr': return `\n---\n\n`;
      case 'br': return `\n`;
      case 'p':
      case 'div': return `\n${children}\n`;
      case 'ul': return `\n${children}\n`;
      case 'ol': return `\n${children}\n`;
      case 'li': {
        const parent = node.parentElement;
        if (parent && parent.tagName.toLowerCase() === 'ol') {
          const idx = Array.from(parent.children).indexOf(node) + 1;
          return `${idx}. ${children.trim()}\n`;
        }
        return `- ${children.trim()}\n`;
      }
      default: return children;
    }
  }

  let md = nodeToMd(div);
  return md.replace(/\n{3,}/g, '\n\n').trim();
}

function exportNoteMarkdown(key) {
  const day = localGetDay(key);
  const tagsStr = (day.tags || []).map(t => `#${t}`).join(' ') || 'nenhuma';
  const updStr = day.updatedAt ? new Date(day.updatedAt).toLocaleString('pt-BR') : 'Sem registro';
  const mdContent = htmlToMarkdown(day.content || '');

  let checkMd = '';
  if (day.checklist && day.checklist.length > 0) {
    checkMd = `\n\n### Tarefas & Checklist\n`;
    day.checklist.forEach(item => {
      const mark = item.done ? '[x]' : '[ ]';
      const timeStr = item.time ? ` (${item.time})` : '';
      checkMd += `- ${mark} ${item.text}${timeStr}\n`;
    });
  }

  const fileText = `# PersonalMk - ${fmtFull(key)}\n\n` +
    `> **Data:** ${key}\n` +
    `> **Última Atualização:** ${updStr}\n` +
    `> **Tags:** ${tagsStr}\n\n` +
    `---\n\n` +
    `${mdContent}${checkMd}\n\n` +
    `---\n` +
    `*Exportado de PersonalMk em ${new Date().toLocaleString('pt-BR')}*\n`;

  const blob = new Blob([fileText], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `personalmk_${key}.md`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Anotação exportada em Markdown (.md)!', '');
}

function exportAllMarkdown() {
  const data = loadLocal();
  const keys = Object.keys(data).sort().reverse();
  if (!keys.length) return toast('Nenhuma anotação para exportar.', '!');

  let fullMd = `# PersonalMk - Backup Completo de Anotações\n\n` +
    `> **Total de Anotações:** ${keys.length}\n` +
    `> **Gerado em:** ${new Date().toLocaleString('pt-BR')}\n` +
    `> **Versão:** 3.0\n\n` +
    `---\n\n` +
    `## Índice de Anotações\n\n`;

  keys.forEach(k => {
    fullMd += `- [${fmtFull(k)}](#${k})\n`;
  });

  fullMd += `\n---\n\n`;

  keys.forEach(k => {
    const day = data[k] || {};
    const tagsStr = (day.tags || []).map(t => `#${t}`).join(' ') || 'nenhuma';
    const updStr = day.updatedAt ? new Date(day.updatedAt).toLocaleString('pt-BR') : 'Sem registro';
    const mdContent = htmlToMarkdown(day.content || '');

    let checkMd = '';
    if (day.checklist && day.checklist.length > 0) {
      checkMd = `\n\n### Tarefas\n`;
      day.checklist.forEach(item => {
        const mark = item.done ? '[x]' : '[ ]';
        const timeStr = item.time ? ` (${item.time})` : '';
        checkMd += `- ${mark} ${item.text}${timeStr}\n`;
      });
    }

    fullMd += `<a id="${k}"></a>\n\n` +
      `# ${fmtFull(k)}\n\n` +
      `> **Data:** ${k} | **Atualizado:** ${updStr}\n` +
      `> **Tags:** ${tagsStr}\n\n` +
      `${mdContent}${checkMd}\n\n` +
      `---\n\n`;
  });

  const blob = new Blob([fullMd], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `personalmk_backup_todas_notas_${todayKey()}.md`;
  a.click();
  URL.revokeObjectURL(url);
  toast(`${keys.length} anotações exportadas em Markdown (.md)!`, '');
}

/* ────── Export Note Button ────── */
$('exportBtn').addEventListener('click', () => {
  if (!activeTab) return;
  openModal({
    title: 'Exportar Anotação',
    body: `Como deseja exportar "${fmtShort(activeTab)}"?`,
    actions: [
      { label: 'Cancelar', cls: 'btn-cancel' },
      { label: 'Markdown (.md)', cls: 'btn-primary', cb: () => exportNoteMarkdown(activeTab) },
      { label: 'Texto (.txt)', cls: 'btn-secondary', cb: () => {
        const day = localGetDay(activeTab);
        const tags = (day.tags || []).map(t => `#${t}`).join(' ');
        const txt = `AGENDA PESSOAL - ${fmtFull(activeTab)}\n${'='.repeat(52)}\nTags: ${tags || 'nenhuma'}\n\n${toPlain(day.content)}`;
        const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `agenda_${activeTab}.txt`; a.click();
        URL.revokeObjectURL(url); toast('Exportado em TXT!', '');
      }}
    ]
  });
});

/* ────── Backup / Restore ────── */
function doBackup() {
  const data = loadLocal();
  const json = JSON.stringify({ version: 3, exportedAt: new Date().toISOString(), days: data }, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `agenda_backup_${todayKey()}.json`; a.click();
  URL.revokeObjectURL(url); toast('Backup exportado!', '');
}
function doRestore() { $('restoreFileInput').click(); }
$('backupBtn').addEventListener('click', doBackup);
$('restoreBtn').addEventListener('click', doRestore);
$('restoreFileInput').addEventListener('change', e => {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const parsed = JSON.parse(ev.target.result);
      const importedDays = parsed.days || parsed;
      if (typeof importedDays !== 'object') throw new Error();
      const count = Object.keys(importedDays).length;
      openModal({
        title: 'Restaurar Backup',
        body: `${count} dia(s) encontrado(s). Como importar?`,
        actions: [
          { label: 'Cancelar', cls: 'btn-cancel' },
          {
            label: 'Mesclar', cls: 'btn-secondary', cb: () => {
              const cur = loadLocal(); Object.assign(cur, importedDays); saveLocal(cur);
              refreshAll(); toast(`${count} dia(s) importados (mesclado).`, '');
            }
          },
          {
            label: 'Substituir tudo', cls: 'btn-danger', cb: () => {
              saveLocal(importedDays); openTabs = []; activeTab = null;
              refreshAll(); showWelcome(); toast(`${count} dia(s) importados.`, '');
            }
          }
        ]
      });
    } catch (e) { toast('Arquivo inválido.', ''); }
  };
  reader.readAsText(file); e.target.value = '';
});

/* ────── Search ────── */
$('searchInput').addEventListener('input', () => renderSidebar($('searchInput').value));

/* ────── Theme toggle ────── */
$('themeToggleBtn').addEventListener('click', toggleTheme);

/* ────── Keyboard Navigation Shortcuts (Power User) ────── */
window.addEventListener('keydown', e => {
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const modKey = isMac ? e.metaKey : e.ctrlKey;
  const isTyping = document.activeElement && (
    document.activeElement.tagName === 'INPUT' ||
    document.activeElement.tagName === 'TEXTAREA' ||
    document.activeElement.isContentEditable
  );

  // 1. Ctrl/Cmd + Tab: Alternar entre abas
  if (modKey && e.key === 'Tab') {
    e.preventDefault();
    if (openTabs.length < 2) return;
    activateTab(openTabs[(openTabs.indexOf(activeTab) + 1) % openTabs.length]);
    return;
  }

  // 2. Alt + N ou Ctrl/Cmd + N: Criar nova anotação (Alt + N funciona livremente no navegador)
  if ((modKey || e.altKey) && e.key.toLowerCase() === 'n') {
    e.preventDefault();
    pickDateModal();
    return;
  }

  // 3. Ctrl/Cmd + S: Forçar salvamento visual imediato
  if (modKey && e.key.toLowerCase() === 's') {
    e.preventDefault();
    if (activeTab) {
      setSave('saving');
      saveCurrent().then(() => {
        setSave('saved');
        toast('Anotação salva com sucesso!', '✓');
      });
    }
    return;
  }

  // 4. Ctrl/Cmd + K ou / : Busca rápida
  if ((modKey && e.key.toLowerCase() === 'k') || (!isTyping && e.key === '/')) {
    e.preventDefault();
    openQuickSearch();
    return;
  }

  // 5. Escape: Fechar modais abertos
  if (e.key === 'Escape') {
    if ($('quicksearch-overlay') && $('quicksearch-overlay').classList.contains('show')) {
      closeQuickSearch();
    } else if ($('spotify-overlay') && $('spotify-overlay').classList.contains('show')) {
      closeSpotifyModal();
    } else if ($('ai-overlay') && $('ai-overlay').classList.contains('show')) {
      $('ai-overlay').classList.remove('show');
    } else if ($('settings-overlay') && $('settings-overlay').classList.contains('show')) {
      closeSettings();
    } else if ($('modal-overlay') && $('modal-overlay').classList.contains('show')) {
      closeModal();
    } else if ($('lightbox') && $('lightbox').classList.contains('show')) {
      $('lightbox').classList.remove('show');
    }
  }
});

/* ────── Refresh all ────── */
function refreshAll() {
  renderTagFilterBar(); renderSidebar($('searchInput').value); renderCalendar(); renderTabs();
}


/* ────── IndexedDB Wrapper for Images ────── */
const DB_NAME = 'AgendaImagesDB';
const DB_VERSION = 1;
const STORE_NAME = 'images';
let idbDB = null;
function initIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      idbDB = e.target.result;
      if (!idbDB.objectStoreNames.contains(STORE_NAME)) idbDB.createObjectStore(STORE_NAME);
    };
    req.onsuccess = e => { idbDB = e.target.result; resolve(); };
    req.onerror = e => reject(e);
  });
}
function idbSave(key, dataUrl) {
  return new Promise((resolve) => {
    if (!idbDB) return resolve();
    const tx = idbDB.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(dataUrl, key);
    tx.oncomplete = () => resolve();
  });
}
function idbGet(key) {
  return new Promise((resolve) => {
    if (!idbDB) return resolve(null);
    const req = idbDB.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}
function idbDel(key) {
  return new Promise((resolve) => {
    if (!idbDB) return resolve();
    const tx = idbDB.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
  });
}


async function compressImage(file, maxDim = 1600, quality = 0.7) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxDim || h > maxDim) {
          const ratio = Math.min(maxDim / w, maxDim / h);
          w = Math.round(w * ratio); h = Math.round(h * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

/* ────── UI Tabs ────── */
function switchInnerTab(tab) {
  $('tabText').classList.toggle('active', tab === 'text');
  $('tabChecklist').classList.toggle('active', tab === 'checklist');
  $('tabGallery').classList.toggle('active', tab === 'gallery');

  $('toolbar').style.display = tab === 'text' ? 'flex' : 'none';
  $('editorWrap').style.display = tab === 'text' ? 'block' : 'none';
  $('wordCount').style.display = tab === 'text' ? 'flex' : 'none';
  
  $('checklistPane').style.display = tab === 'checklist' ? 'flex' : 'none';
  
  $('galleryPane').style.display = tab === 'gallery' ? 'block' : 'none';
  
  if (tab === 'gallery') renderGallery();
  if (tab === 'checklist') renderChecklist();
}

$('tabText').addEventListener('click', () => switchInnerTab('text'));
$('tabChecklist').addEventListener('click', () => switchInnerTab('checklist'));
$('tabGallery').addEventListener('click', () => switchInnerTab('gallery'));

$('uploadImgBtn').addEventListener('click', () => $('imgUploadInput').click());
$('imgUploadInput').addEventListener('change', async e => {
  const files = e.target.files;
  if (!files || !files.length || !activeTab) return;
  setSave('saving');
  let day = localGetDay(activeTab);
  if (!day.images) day.images = [];

  for (let file of files) {
    if (!file.type.startsWith('image/')) continue;
    const dataUrl = await compressImage(file);
    const imgId = 'img_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);

    // Save to IDB
    await idbSave(imgId, dataUrl);

    // Push ref
    day.images.push(imgId);

    // Sync to Cloud Storage if online (fire-and-forget, non-blocking)
    if (currentUser && FB_ON && storage) {
      storage.ref(`users/${currentUser.uid}/images/${activeTab}/${imgId}.jpg`)
        .putString(dataUrl, 'data_url')
        .catch(err => console.warn('Cloud upload failed', err));
    }
  }

  await setDay(activeTab, day.content, day.tags, day.images);
  $('imgUploadInput').value = '';
  renderGallery();
  setSave('saved');
});

async function renderGallery() {
  if (!activeTab) return;
  const day = localGetDay(activeTab);
  const images = day.images || [];
  $('galleryCount').textContent = `${images.length} imagem(ns)`;
  $('galleryGrid').innerHTML = '';

  for (let imgId of images) {
    let dataUrl = await idbGet(imgId);

    if (!dataUrl && currentUser && FB_ON && storage) {
      try {
        const ref = storage.ref(`users/${currentUser.uid}/images/${activeTab}/${imgId}.jpg`);
        dataUrl = await ref.getDownloadURL();
        await idbSave(imgId, dataUrl); // Cache locally
      } catch (e) { console.warn('Missing image', imgId); }
    }

    if (dataUrl) {
      const div = document.createElement('div');
      div.className = 'gallery-item';
      div.innerHTML = `<img src="${dataUrl}" alt="Gallery image" />
                       <button class="gallery-item-del" data-id="${imgId}" title="Remover">&times;</button>`;
      div.querySelector('img').addEventListener('click', () => {
        $('lbImg').src = dataUrl;
        $('lightbox').classList.add('show');
      });
      div.querySelector('.gallery-item-del').addEventListener('click', (e) => {
        e.stopPropagation();
        deleteImage(imgId);
      });
      $('galleryGrid').appendChild(div);
    }
  }
}

async function deleteImage(imgId) {
  if (!activeTab) return;
  if (!confirm('Excluir esta imagem?')) return;
  setSave('saving');

  const day = localGetDay(activeTab);
  day.images = (day.images || []).filter(id => id !== imgId);
  await setDay(activeTab, day.content, day.tags, day.images);

  await idbDel(imgId);
  // Cloud delete in background (non-blocking)
  if (currentUser && FB_ON && storage) {
    storage.ref(`users/${currentUser.uid}/images/${activeTab}/${imgId}.jpg`).delete().catch(() => { });
  }

  renderGallery();
  setSave('saved');
}


// Suporte a colar print direto (Win + Shift + S -> Ctrl + V) na Galeria
// Isso já existe em outra função, nativo ficou mto dificil "bizarro"
window.addEventListener('paste', async (e) => {
  if (!activeTab) return;
  const items = (e.clipboardData || window.clipboardData)?.items;
  if (!items) return;

  let imageFiles = [];
  for (let item of items) {
    if (item.type.indexOf('image') !== -1) {
      const file = item.getAsFile();
      if (file) imageFiles.push(file);
    }
  }

  if (imageFiles.length > 0 && $('tabGallery').classList.contains('active')) {
    e.preventDefault();
    setSave('saving');
    let day = localGetDay(activeTab);
    if (!day.images) day.images = [];

    for (let file of imageFiles) {
      const dataUrl = await compressImage(file, 1200, 0.7);
      const imgId = 'img_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
      await idbSave(imgId, dataUrl);
      day.images.push(imgId);

      // Cloud upload in background (non-blocking)
      if (currentUser && FB_ON && storage) {
        storage.ref(`users/${currentUser.uid}/images/${activeTab}/${imgId}.jpg`)
          .putString(dataUrl, 'data_url')
          .catch(err => console.warn('Cloud upload failed', err));
      }
    }

    await setDay(activeTab, day.content, day.tags, day.images, day.checklist);
    renderGallery();
    setSave('saved');
    toast('Imagem colada na galeria!', '');
  } else if (imageFiles.length > 0 && ($('tabText').classList.contains('active') || document.activeElement === $('editor') || $('editor').contains(document.activeElement))) {
    e.preventDefault();
    setSave('saving');
    for (let file of imageFiles) {
      const dataUrl = await compressImage(file, 900, 0.65);
      const imgHtml = `<p><img src="${dataUrl}" alt="Captura" style="max-width:100%;height:auto;border-radius:8px;margin:8px 0;display:block;" /></p><p><br></p>`;
      document.execCommand('insertHTML', false, imgHtml);
    }
    doSave();
    updateWC();
    setSave('saved');
    toast('Imagem colada e otimizada!', '');
  }
});

$('lbClose').addEventListener('click', () => $('lightbox').classList.remove('show'));
$('lightbox').addEventListener('click', e => { if (e.target === $('lightbox')) $('lightbox').classList.remove('show'); });

/* ────── Checklist UI ────── */
function renderChecklist() {
  if (!activeTab) return;
  const container = $('checklistContainer');
  container.innerHTML = '';
  
  let doneCount = 0;
  // Sort by time if available
  currentChecklist.sort((a, b) => {
    if (!a.time) return 1;
    if (!b.time) return -1;
    return a.time.localeCompare(b.time);
  });

  currentChecklist.forEach((item, index) => {
    if (item.done) doneCount++;
    const div = document.createElement('div');
    div.className = `check-item ${item.done ? 'done' : ''}`;
    const timeHTML = item.time ? `<div class="check-time">${esc(item.time)}</div>` : '';
    div.innerHTML = `
      <div class="check-box" data-idx="${index}">${item.done ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>' : ''}</div>
      <div class="check-text">${esc(item.text)}</div>
      ${timeHTML}
      <button class="check-del" data-idx="${index}">&#x00D7;</button>
    `;
    container.appendChild(div);
  });
  
  const pct = currentChecklist.length ? Math.round((doneCount / currentChecklist.length) * 100) : 0;
  $('checklistProgress').style.width = pct + '%';
  $('checklistProgressText').textContent = `${pct}% concluído`;
  
  // Attach events
  container.querySelectorAll('.check-box').forEach(el => {
    el.addEventListener('click', () => {
      const idx = el.getAttribute('data-idx');
      currentChecklist[idx].done = !currentChecklist[idx].done;
      saveCurrent();
      renderChecklist();
    });
  });
  container.querySelectorAll('.check-del').forEach(el => {
    el.addEventListener('click', () => {
      const idx = el.getAttribute('data-idx');
      currentChecklist.splice(idx, 1);
      saveCurrent();
      renderChecklist();
    });
  });
}

if ($('newChecklistInput')) {
  $('newChecklistInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const val = e.target.value.trim();
      const tVal = $('newChecklistTime') ? $('newChecklistTime').value : '';
      if (val) {
        currentChecklist.push({ text: val, time: tVal, done: false, notified: false });
        e.target.value = '';
        if ($('newChecklistTime')) $('newChecklistTime').value = '';
        saveCurrent();
        renderChecklist();
      }
    }
  });
}

/* ══════════ NOTIFICAÇÕES ══════════ */
const SK_NOTIF_DISMISS = 'pmk_notif_dismissed_at';
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const notifSupported = () => 'Notification' in window;

async function sendNotification(title, body, { url = '', tag } = {}) {
  if (!notifSupported() || Notification.permission !== 'granted') return false;
  const opts = { body, icon: 'icon.svg', badge: 'icon.svg', data: { url }, vibrate: [120, 60, 120] };
  if (tag) opts.tag = tag;
  try {
    // No Android, "new Notification()" não funciona: precisa passar pelo Service Worker
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) { await reg.showNotification(title, opts); return true; }
    }
    const n = new Notification(title, opts);
    n.onclick = () => { window.focus(); if (url) window.open(url, '_blank'); n.close(); };
    return true;
  } catch (e) {
    console.warn('Falha ao notificar:', e);
    return false;
  }
}

async function requestNotifPermission() {
  hideNotifBanner();
  if (!notifSupported()) {
    showToast(isIOS()
      ? 'No iPhone: toque em Compartilhar → "Adicionar à Tela de Início" e abra o app por lá para ativar.'
      : 'Seu navegador não suporta notificações.', true);
    return;
  }
  const res = await Notification.requestPermission();
  if (res === 'granted') {
    showToast('Notificações ativadas!');
    sendNotification('PersonalMk', 'Pronto! Seus lembretes vão chegar por aqui.', { tag: 'pmk-welcome' });
  } else if (res === 'denied') {
    showToast('Notificações bloqueadas. Libere nas configurações do navegador.', true);
  }
  updateNotifSettings();
}

function hideNotifBanner() { $('notifBanner')?.classList.remove('show'); }

function maybeShowNotifBanner() {
  const banner = $('notifBanner');
  if (!banner) return;
  const dismissed = +localStorage.getItem(SK_NOTIF_DISMISS) || 0;
  if (Date.now() - dismissed < 3 * 24 * 3600 * 1000) return; // pergunta de novo só depois de 3 dias
  const iosNotInstalled = isIOS() && !isStandalone();
  if (notifSupported() && Notification.permission !== 'default') return;
  if (!notifSupported() && !iosNotInstalled) return;

  if (iosNotInstalled) {
    banner.querySelector('.notif-banner-text span').textContent =
      'No iPhone, adicione o PersonalMk à Tela de Início (Compartilhar → Adicionar à Tela de Início) para receber lembretes.';
    $('notifBannerAllow').textContent = 'Como fazer';
  }
  setTimeout(() => {
    if (!$('spotify-overlay')?.classList.contains('show')) banner.classList.add('show');
  }, 1500);
}

function updateNotifSettings() {
  const desc = $('settingsNotifDesc'), btn = $('settingsNotifBtn'), test = $('settingsNotifTestBtn');
  if (!desc) return;
  if (!notifSupported()) {
    desc.textContent = isIOS() ? 'Adicione o app à Tela de Início para ativar' : 'Não suportado neste navegador';
    btn.style.display = 'none'; test.style.display = 'none';
    return;
  }
  const p = Notification.permission;
  desc.textContent = p === 'granted' ? 'Ativadas: 30 min antes, na hora e música do dia'
    : p === 'denied' ? 'Bloqueadas no navegador (libere nas configurações do site)'
    : 'Desativadas';
  btn.style.display = p === 'default' ? '' : 'none';
  test.style.display = p === 'granted' ? '' : 'none';
}

$('notifBannerAllow')?.addEventListener('click', requestNotifPermission);
$('notifBannerLater')?.addEventListener('click', () => {
  localStorage.setItem(SK_NOTIF_DISMISS, Date.now());
  hideNotifBanner();
});
$('settingsNotifBtn')?.addEventListener('click', requestNotifPermission);
$('settingsNotifTestBtn')?.addEventListener('click', () => {
  sendNotification('Teste do PersonalMk', 'Se você está vendo isso, as notificações estão funcionando!', { tag: 'pmk-test' });
});

/* ────── Lembretes: 30 min antes + na hora ────── */
function timeToMins(t) {
  const [h, m] = (t || '').split(':').map(Number);
  return isNaN(h) || isNaN(m) ? null : h * 60 + m;
}

function checkReminders() {
  const k = todayKey();
  const isActive = activeTab === k;
  // Funciona mesmo se o usuário estiver com outra anotação aberta
  const list = isActive ? currentChecklist : (localGetDay(k).checklist || []);
  if (!list || !list.length) return;

  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  let modified = false;

  list.forEach(item => {
    if (item.done || !item.time) return;
    const t = timeToMins(item.time);
    if (t === null) return;
    const diff = t - cur;
    const tagBase = `pmk-${k}-${item.time}-${item.text}`;

    // `notified` é o campo antigo (versões anteriores) = aviso de 30 min já enviado
    if (!item.n30 && !item.notified && diff > 0 && diff <= 30) {
      item.n30 = true; item.notified = true; modified = true;
      toast(`Em ${diff} min: "${item.text}" às ${item.time}`, '');
      sendNotification(`Em ${diff} min: ${item.text}`, `Seu compromisso começa às ${item.time}.`, { tag: tagBase + '-30' });
    }

    if (!item.nNow && diff <= 0 && diff > -10) {
      item.nNow = true; item.n30 = true; item.notified = true; modified = true;
      toast(`Chegou a hora: "${item.text}"`, '');
      sendNotification(`Chegou a hora: ${item.text}`, `Compromisso marcado para ${item.time}.`, { tag: tagBase + '-now' });
    }
  });

  if (!modified) return;
  if (isActive) {
    saveCurrent();
  } else {
    const d = localGetDay(k);
    setDay(k, d.content, d.tags, d.images, list);
  }
}

/* ══════════ SPOTIFY — MÚSICA DO DIA ══════════
 * Para ativar o modo "baseado na conta":
 * 1. Crie um app em https://developer.spotify.com/dashboard
 * 2. Em "Redirect URIs" adicione a URL EXATA do site, ex: https://enzommds7.github.io/Personal-Mk/
 *    (para testar local use http://127.0.0.1:PORTA/ — o Spotify não aceita mais "localhost")
 * 3. Cole o Client ID abaixo. Ele é público, pode ficar no código (o fluxo PKCE não usa secret).
 * Sem Client ID, o app usa a sugestão por dia da semana.
 */
const SPOTIFY_CLIENT_ID = ''; // Opcional default; o usuário também pode configurar diretamente no app
const SPOTIFY_SCOPES = 'user-top-read user-read-recently-played';
const SK_SP_TOKEN = 'pmk_spotify_token';
const SK_SP_VERIFIER = 'pmk_spotify_verifier';
const SK_SP_DAILY = 'pmk_spotify_daily';
const SK_SP_SHOWN = 'pmk_spotify_popup_shown';
const SK_SP_CLIENT_ID = 'pmk_spotify_client_id';
const SK_SP_GENRE = 'pmk_spotify_genre';

const SPOTIFY_SVG = '<svg class="sp-logo" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>';
const PLAY_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';

function getSpotifyClientId() {
  return (localStorage.getItem(SK_SP_CLIENT_ID) || SPOTIFY_CLIENT_ID || '').trim();
}
function setSpotifyClientId(id) {
  if (id && id.trim()) localStorage.setItem(SK_SP_CLIENT_ID, id.trim());
  else localStorage.removeItem(SK_SP_CLIENT_ID);
}
function getSpotifyGenre() {
  return localStorage.getItem(SK_SP_GENRE) || '';
}
function setSpotifyGenre(g) {
  if (g) localStorage.setItem(SK_SP_GENRE, g);
  else localStorage.removeItem(SK_SP_GENRE);
}

// Biblioteca de músicas por estilo/gênero (usada quando o usuário escolhe suas preferências sem login)
const GENRE_PICKS = {
  'rock': {
    name: 'Rock & Pop Rock',
    picks: [
      ['Don\'t Stop Me Now', 'Queen'],
      ['Tempo Perdido', 'Legião Urbana'],
      ['In the End', 'Linkin Park'],
      ['Californication', 'Red Hot Chili Peppers'],
      ['Sweet Child O\' Mine', 'Guns N\' Roses'],
      ['Everlong', 'Foo Fighters'],
      ['Admirável Chip Novo', 'Pitty'],
      ['Dias Atrás', 'CPM 22'],
      ['Smells Like Teen Spirit', 'Nirvana'],
      ['The Scientist', 'Coldplay']
    ]
  },
  'pop': {
    name: 'Pop & Hits',
    picks: [
      ['Blinding Lights', 'The Weeknd'],
      ['Levitating', 'Dua Lipa'],
      ['As It Was', 'Harry Styles'],
      ['24K Magic', 'Bruno Mars'],
      ['Viva La Vida', 'Coldplay'],
      ['Style', 'Taylor Swift'],
      ['Flowers', 'Miley Cyrus'],
      ['Shape of You', 'Ed Sheeran'],
      ['Save Your Tears', 'The Weeknd']
    ]
  },
  'trap': {
    name: 'Trap & Hip-Hop',
    picks: [
      ['Kenny G', 'Matuê'],
      ['HIGHEST IN THE ROOM', 'Travis Scott'],
      ['Lose Yourself', 'Eminem'],
      ['HUMBLE.', 'Kendrick Lamar'],
      ['Circles', 'Post Malone'],
      ['Freio da Blazer', 'L7NNON'],
      ['Vida Loka (Parte 2)', 'Racionais MC\'s'],
      ['Godzilla', 'Eminem'],
      ['Máquina do Tempo', 'Matuê']
    ]
  },
  'mpb': {
    name: 'MPB & Clássicos BR',
    picks: [
      ['Não Quero Dinheiro', 'Tim Maia'],
      ['País Tropical', 'Jorge Ben Jor'],
      ['Sina', 'Djavan'],
      ['Vou Deixar', 'Skank'],
      ['Mania de Você', 'Rita Lee'],
      ['Anunciação', 'Alceu Valença'],
      ['Andar com Fé', 'Gilberto Gil'],
      ['Garota de Ipanema', 'Tom Jobim'],
      ['Apenas Mais Uma de Amor', 'Lulu Santos']
    ]
  },
  'sertanejo': {
    name: 'Sertanejo',
    picks: [
      ['Sosseguei', 'Jorge & Mateus'],
      ['Até Você Voltar', 'Henrique & Juliano'],
      ['Infiel', 'Marília Mendonça'],
      ['A Maior Saudade', 'Henrique & Juliano'],
      ['Propaganda', 'Jorge & Mateus'],
      ['Balada (Tchê Tcherere)', 'Gusttavo Lima'],
      ['Evidências', 'Chitãozinho & Xororó']
    ]
  },
  'lofi': {
    name: 'Lo-Fi & Relax',
    picks: [
      ['Snowman', 'Lofi Girl'],
      ['[im closing my eyes]', 'potsu'],
      ['Kingdom in Blue', 'Kupla'],
      ['Controlla', 'Idealism'],
      ['Affection', 'Jinsang'],
      ['5:32pm', 'The Deli'],
      ['Again', 'Wun Two']
    ]
  },
  'eletronica': {
    name: 'Eletrônica',
    picks: [
      ['One More Time', 'Daft Punk'],
      ['Wake Me Up', 'Avicii'],
      ['Summer', 'Calvin Harris'],
      ['Hear Me Now', 'Alok'],
      ['The Business', 'Tiësto'],
      ['Titanium', 'David Guetta, Sia'],
      ['Midnight City', 'M83']
    ]
  },
  'foco': {
    name: 'Foco & Instrumental',
    picks: [
      ['Time', 'Hans Zimmer'],
      ['Clair de Lune', 'Claude Debussy'],
      ['Weightless', 'Marconi Union'],
      ['Nuvole Bianche', 'Ludovico Einaudi'],
      ['Intro', 'The xx'],
      ['On the Nature of Daylight', 'Max Richter'],
      ['Experience', 'Ludovico Einaudi']
    ]
  }
};

// Sugestões por dia da semana (fallback padrão)
const WEEKDAY_VIBES = [
  { day: 'domingo', mood: 'pra desacelerar', picks: [['Garota de Ipanema', 'Tom Jobim'], ['Here Comes the Sun', 'The Beatles'], ['Trem-Bala', 'Ana Vilela'], ['Sunday Morning', 'Maroon 5']] },
  { day: 'segunda-feira', mood: 'pra começar a semana com energia', picks: [['Eye of the Tiger', 'Survivor'], ["Don't Stop Me Now", 'Queen'], ['Lose Yourself', 'Eminem'], ['Tempo Perdido', 'Legião Urbana']] },
  { day: 'terça-feira', mood: 'pra manter o foco', picks: [['Weightless', 'Marconi Union'], ['Clair de Lune', 'Claude Debussy'], ['Time', 'Hans Zimmer'], ['Intro', 'The xx']] },
  { day: 'quarta-feira', mood: 'pra atravessar o meio da semana', picks: [['Happy', 'Pharrell Williams'], ['Mr. Blue Sky', 'Electric Light Orchestra'], ['Vou Deixar', 'Skank'], ['Shake It Off', 'Taylor Swift']] },
  { day: 'quinta-feira', mood: 'pra embalar a reta final', picks: [['Blinding Lights', 'The Weeknd'], ['Levitating', 'Dua Lipa'], ['Anna Júlia', 'Los Hermanos'], ['Uptown Funk', 'Mark Ronson, Bruno Mars']] },
  { day: 'sexta-feira', mood: 'porque sextou', picks: [["Friday I'm in Love", 'The Cure'], ['País Tropical', 'Jorge Ben Jor'], ['September', 'Earth, Wind & Fire'], ['Dancing Queen', 'ABBA']] },
  { day: 'sábado', mood: 'pra curtir o fim de semana', picks: [['Three Little Birds', 'Bob Marley & The Wailers'], ['Lança Perfume', 'Rita Lee'], ['Wonderwall', 'Oasis'], ['Good Vibrations', 'The Beach Boys']] }
];

const spRedirectUri = () => location.origin + location.pathname;
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const dayNumber = () => { const d = new Date(); return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86400000); };
const todayVibe = () => WEEKDAY_VIBES[new Date().getDay()];

function spGetToken() { try { return JSON.parse(localStorage.getItem(SK_SP_TOKEN)); } catch { return null; } }
function spIsConnected() { const t = spGetToken(); return !!(t && (t.refresh_token || t.access_token)); }
function spSaveToken(d) {
  const prev = spGetToken() || {};
  localStorage.setItem(SK_SP_TOKEN, JSON.stringify({
    access_token: d.access_token,
    refresh_token: d.refresh_token || prev.refresh_token,
    expires_at: Date.now() + ((d.expires_in || 3600) - 60) * 1000
  }));
}

async function spotifyLogin() {
  const cid = getSpotifyClientId();
  if (!cid) {
    openSpotifyModal(true);
    return;
  }
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(64)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  localStorage.setItem(SK_SP_VERIFIER, verifier);
  const p = new URLSearchParams({
    client_id: cid,
    response_type: 'code',
    redirect_uri: spRedirectUri(),
    code_challenge_method: 'S256',
    code_challenge: challenge,
    scope: SPOTIFY_SCOPES
  });
  location.href = 'https://accounts.spotify.com/authorize?' + p.toString();
}

function spotifyLogout(silent) {
  localStorage.removeItem(SK_SP_TOKEN);
  localStorage.removeItem(SK_SP_DAILY);
  renderSpotifyCard();
  updateSpotifySettings();
  if (!silent) showToast('Spotify desconectado.');
}

// Volta do login do Spotify (?code=...)
async function spotifyHandleCallback() {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  const err = params.get('error');
  if (!code && !err) return;
  history.replaceState(null, '', spRedirectUri() + location.hash);
  if (err) { setTimeout(() => showToast('Conexão com o Spotify cancelada.', true), 800); return; }

  const verifier = localStorage.getItem(SK_SP_VERIFIER);
  const cid = getSpotifyClientId();
  if (!verifier || !cid) return;
  try {
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: cid,
        grant_type: 'authorization_code',
        code,
        redirect_uri: spRedirectUri(),
        code_verifier: verifier
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error_description || data.error || 'erro');
    spSaveToken(data);
    localStorage.removeItem(SK_SP_VERIFIER);
    localStorage.removeItem(SK_SP_DAILY);
    localStorage.removeItem(SK_SP_SHOWN);
    setTimeout(() => showToast('Spotify conectado com sucesso!'), 800);
  } catch (e) {
    setTimeout(() => showToast('Erro ao conectar Spotify: ' + e.message, true), 800);
  }
}

async function spAccessToken() {
  const t = spGetToken();
  if (!t) return null;
  if (t.access_token && Date.now() < t.expires_at) return t.access_token;
  if (!t.refresh_token) return null;
  const cid = getSpotifyClientId();
  if (!cid) return null;
  try {
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: cid })
    });
    const d = await res.json();
    if (!res.ok) { spotifyLogout(true); return null; }
    spSaveToken(d);
    return d.access_token;
  } catch { return null; }
}

async function spApi(path) {
  const tok = await spAccessToken();
  if (!tok) return null;
  const r = await fetch('https://api.spotify.com/v1' + path, { headers: { Authorization: 'Bearer ' + tok } });
  if (r.status === 401) { spotifyLogout(true); return null; }
  if (!r.ok) return null;
  return r.json();
}

function curatedPick() {
  const genre = getSpotifyGenre();
  if (genre && GENRE_PICKS[genre]) {
    const gp = GENRE_PICKS[genre];
    const [name, artist] = gp.picks[Math.floor(dayNumber()) % gp.picks.length];
    return {
      source: 'genre',
      genreName: gp.name,
      name,
      artist,
      image: null,
      id: null,
      url: `https://open.spotify.com/search/${encodeURIComponent(name + ' ' + artist)}`
    };
  }
  const v = todayVibe();
  const [name, artist] = v.picks[Math.floor(dayNumber() / 7) % v.picks.length];
  return {
    source: 'curated',
    genreName: v.mood,
    name,
    artist,
    image: null,
    id: null,
    url: `https://open.spotify.com/search/${encodeURIComponent(name + ' ' + artist)}`
  };
}

function trackToPick(t) {
  const imgs = (t.album && t.album.images) || [];
  return {
    source: 'account',
    name: t.name,
    artist: (t.artists || []).map(a => a.name).join(', '),
    image: (imgs[1] || imgs[0] || {}).url || null,
    id: t.id,
    url: (t.external_urls && t.external_urls.spotify) || `https://open.spotify.com/track/${t.id}`
  };
}

async function getDailyPick() {
  const today = todayKey();
  const connected = spIsConnected();
  const genre = getSpotifyGenre();
  try {
    const c = JSON.parse(localStorage.getItem(SK_SP_DAILY));
    if (c && c.date === today) {
      if (connected && c.pick.source === 'account') return c.pick;
      if (!connected && genre && c.pick.source === 'genre' && c.pick.genreKey === genre) return c.pick;
      if (!connected && !genre && c.pick.source === 'curated') return c.pick;
    }
  } catch { }

  let pick = null;
  if (connected) {
    try {
      const range = ['short_term', 'medium_term', 'long_term'][dayNumber() % 3];
      const top = await spApi(`/me/top/tracks?limit=50&time_range=${range}`);
      let items = (top && top.items) || [];
      if (!items.length) {
        const rec = await spApi('/me/player/recently-played?limit=50');
        items = ((rec && rec.items) || []).map(i => i.track).filter(Boolean);
      }
      if (items.length) pick = trackToPick(items[(dayNumber() * 7 + new Date().getDay()) % items.length]);
    } catch (e) { console.warn('Spotify:', e); }
  }
  if (!pick) {
    pick = curatedPick();
    if (genre) pick.genreKey = genre;
  }
  localStorage.setItem(SK_SP_DAILY, JSON.stringify({ date: today, pick }));
  return pick;
}

async function renderSpotifyCard() {
  const el = $('spotifyCard');
  if (!el) return;
  const pick = await getDailyPick();
  const v = todayVibe();
  const connected = spIsConnected();
  const cover = pick.image
    ? `<img class="sp-cover" src="${pick.image}" alt="Capa de ${esc(pick.name)}" />`
    : `<div class="sp-cover sp-cover-ph">${SPOTIFY_SVG}</div>`;
  el.innerHTML = `
    <div class="sp-head">${SPOTIFY_SVG}<span>Música do dia · ${connected ? 'Sua Conta' : v.day}</span></div>
    <div class="sp-body">
      <button class="sp-open-modal" id="spCardOpen" title="Ver sugestão">
        ${cover}
        <div class="sp-info">
          <div class="sp-name">${esc(pick.name)}</div>
          <div class="sp-artist">${esc(pick.artist)}</div>
        </div>
      </button>
      <a class="sp-play" href="${pick.url}" target="_blank" rel="noopener" title="Ouvir no Spotify">${PLAY_SVG}</a>
    </div>
    ${!connected ? '<button class="sp-connect" id="spCardConnect">Conectar Spotify</button>' : ''}`;
}

async function openSpotifyModal(showSetupImmediately = false) {
  const pick = await getDailyPick();
  const v = todayVibe();
  const connected = spIsConnected();
  const cid = getSpotifyClientId();
  const currentGenre = getSpotifyGenre();

  let statusLabel = 'Sugestão do Dia';
  if (pick.source === 'account') statusLabel = 'Com base nas suas mais ouvidas';
  else if (pick.source === 'genre') statusLabel = `Estilo: ${pick.genreName}`;

  const media = pick.id
    ? `<iframe class="sp-embed" src="https://open.spotify.com/embed/track/${pick.id}?utm_source=generator" height="152" frameborder="0" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy" title="Player do Spotify"></iframe>`
    : `<div class="sp-modal-track">
         <div class="sp-cover sp-cover-ph sp-cover-lg">${SPOTIFY_SVG}</div>
         <div style="flex:1;min-width:0;">
           <div class="sp-name" style="font-weight:700;font-size:14.5px;">${esc(pick.name)}</div>
           <div class="sp-artist" style="font-size:12.5px;color:var(--text-secondary);margin-top:2px;">${esc(pick.artist)}</div>
           <div style="font-size:11px;color:var(--gold);margin-top:4px;">${statusLabel}</div>
         </div>
       </div>`;

  // Genre chips
  const genreChipsHtml = Object.entries(GENRE_PICKS).map(([k, g]) => {
    const act = currentGenre === k ? ' active' : '';
    return `<button class="sp-genre-chip${act}" data-genre="${k}">${g.name}</button>`;
  }).join('');

  const connectionSection = connected
    ? `<div class="sp-connected-user">
         <div class="sp-connected-info">
           ${SPOTIFY_SVG}
           <span>Conta Spotify Conectada</span>
         </div>
         <button class="sp-disconnect-btn" id="spModalDisconnectBtn">Desconectar</button>
       </div>`
    : `<div class="sp-account-card">
         <div class="sp-account-header">
           <div class="sp-account-icon">${SPOTIFY_SVG}</div>
           <div>
             <div class="sp-account-title">Vincular sua Conta do Spotify</div>
             <div class="sp-account-sub">Receba todo dia músicas dos seus artistas favoritos e do seu histórico real!</div>
           </div>
         </div>
         <button class="btn-spotify-solid" id="spModalConnectBtn" style="margin-top:4px;">
           ${SPOTIFY_SVG} ${cid ? 'Entrar com Spotify' : 'Conectar Minha Conta'}
         </button>
       </div>

       <div class="sp-setup-drawer" id="spSetupDrawer" style="display:${showSetupImmediately || !cid ? 'flex' : 'none'};">
         <div class="sp-setup-head">Como conectar sua conta (1 Minuto):</div>
         <p class="sp-setup-text">O Spotify exige um Client ID gratuito para autorizar no seu navegador com 100% de privacidade:</p>
         <ol class="sp-steps">
           <li>Acesse <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener">developer.spotify.com/dashboard</a> e faça login.</li>
           <li>Clique em <b>Create App</b> (nome sugerido: <i>PersonalMk</i>).</li>
           <li>Em <b>Redirect URIs</b>, adicione exatamente a URL abaixo:
             <div class="sp-copy-box">
               <code id="spRedirectUriCode">${spRedirectUri()}</code>
               <button type="button" class="sp-copy-btn" id="spCopyRedirectBtn">Copiar</button>
             </div>
           </li>
           <li>Copie o <b>Client ID</b> do painel e cole aqui:</li>
         </ol>
         <div class="sp-input-box">
           <input type="text" id="spClientIdInput" class="auth-input" placeholder="Cole o Client ID aqui..." value="${cid}" />
           <button class="btn-spotify-solid" id="spSaveConnectBtn">${SPOTIFY_SVG} Salvar e Entrar</button>
         </div>
       </div>`;

  $('spotifyModalBody').innerHTML = `
    <div class="sp-badge">${SPOTIFY_SVG} Música do dia</div>
    <h3 class="sp-modal-title">Hoje é ${v.day}</h3>
    <p class="sp-modal-sub">${pick.source === 'account' ? 'Escolhida entre o que você mais ouve' : 'Sua trilha sonora de hoje'}:</p>
    
    ${connectionSection}

    <div class="sp-divider">Música de Hoje</div>
    ${media}
    <a class="btn-spotify-solid sp-open" href="${pick.url}" target="_blank" rel="noopener">${SPOTIFY_SVG} Ouvir no Spotify</a>

    <div class="sp-divider">Ou personalize seu gosto musical sem login</div>
    <div class="sp-genres-box">
      <div class="sp-genres-title">Prefere escolher sem conectar a conta? Toque no seu estilo:</div>
      <div class="sp-genres-chips" id="spGenreChips">
        ${genreChipsHtml}
      </div>
    </div>
  `;

  $('spotify-overlay').classList.add('show');
}

function closeSpotifyModal() {
  $('spotify-overlay').classList.remove('show');
  const iframe = $('spotifyModalBody').querySelector('iframe');
  if (iframe) iframe.src = 'about:blank';
  maybeShowNotifBanner();
}

function updateSpotifySettings() {
  const desc = $('settingsSpotifyDesc'), btn = $('settingsSpotifyBtn');
  if (!desc) return;
  const cid = getSpotifyClientId();
  const genre = getSpotifyGenre();
  const genreLabel = genre && GENRE_PICKS[genre] ? ` (Estilo: ${GENRE_PICKS[genre].name})` : '';

  if (spIsConnected()) {
    desc.textContent = 'Conta Spotify conectada com sucesso!';
    btn.textContent = 'Desconectar';
    btn.onclick = () => { spotifyLogout(false); updateSpotifySettings(); };
  } else if (cid) {
    desc.textContent = `Configurado com Client ID${genreLabel}. Pronto para conectar!`;
    btn.textContent = 'Entrar';
    btn.onclick = spotifyLogin;
  } else {
    desc.textContent = `Sugestão diária${genreLabel}. Toque para configurar ou conectar.`;
    btn.textContent = 'Configurar';
    btn.onclick = () => { closeSettings(); openSpotifyModal(true); };
  }
}

// Delegação de eventos do Spotify
document.addEventListener('click', async e => {
  if (e.target.closest('#spCardConnect, #spModalConnectBtn')) {
    e.preventDefault();
    spotifyLogin();
    return;
  }
  if (e.target.closest('#spCardOpen')) {
    openSpotifyModal();
    if (window.innerWidth <= 768) closeSidebar();
    return;
  }
  if (e.target.closest('#spModalDisconnectBtn')) {
    e.preventDefault();
    spotifyLogout(false);
    openSpotifyModal();
    return;
  }
  if (e.target.closest('#spCopyRedirectBtn')) {
    e.preventDefault();
    const txt = $('spRedirectUriCode')?.textContent || spRedirectUri();
    navigator.clipboard.writeText(txt).then(() => {
      showToast('URL copiada para a área de transferência!');
    });
    return;
  }
  if (e.target.closest('#spSaveConnectBtn')) {
    e.preventDefault();
    const val = $('spClientIdInput')?.value.trim();
    if (!val) {
      showToast('Cole o seu Client ID do Spotify.', true);
      return;
    }
    setSpotifyClientId(val);
    showToast('Client ID salvo! Redirecionando...');
    setTimeout(() => spotifyLogin(), 400);
    return;
  }
  const chip = e.target.closest('.sp-genre-chip');
  if (chip) {
    e.preventDefault();
    const genre = chip.dataset.genre;
    setSpotifyGenre(genre);
    localStorage.removeItem(SK_SP_DAILY);
    showToast(`Estilo atualizado: ${GENRE_PICKS[genre]?.name || genre}!`);
    await renderSpotifyCard();
    openSpotifyModal();
    return;
  }
});

$('spotifyQuickBtn')?.addEventListener('click', openSpotifyModal);
$('spotifyModalClose')?.addEventListener('click', closeSpotifyModal);
$('spotify-overlay')?.addEventListener('click', e => { if (e.target === $('spotify-overlay')) closeSpotifyModal(); });

// Primeira entrada do dia: abre o card da música; se o dia virar com o app aberto, avisa por notificação
async function runDailySpotify() {
  await renderSpotifyCard();
  const today = todayKey();
  if (localStorage.getItem(SK_SP_SHOWN) === today) { maybeShowNotifBanner(); return; }
  localStorage.setItem(SK_SP_SHOWN, today);
  if (document.hidden) {
    const pick = await getDailyPick();
    sendNotification(`Música do dia · ${todayVibe().day}`, `${pick.name} · ${pick.artist}`, { url: pick.url, tag: 'pmk-spotify-' + today });
  } else {
    setTimeout(openSpotifyModal, 1200);
  }
}

let lastDayKey = todayKey();
async function dailyTick() {
  checkReminders();
  const today = todayKey();
  if (today !== lastDayKey) {
    lastDayKey = today;
    await renderSpotifyCard();
    if (localStorage.getItem(SK_SP_SHOWN) !== today) {
      localStorage.setItem(SK_SP_SHOWN, today);
      const pick = await getDailyPick();
      sendNotification(`Bom dia! Hoje é ${todayVibe().day}`, `Sugestão de hoje: ${pick.name} · ${pick.artist}`, { url: pick.url, tag: 'pmk-spotify-' + today });
    }
  }
}
setInterval(dailyTick, 30000);
document.addEventListener('visibilitychange', () => { 
  if (!document.hidden) {
    dailyTick(); 
    if (currentUser && FB_ON) checkAndSyncCloud();
  }
});
window.addEventListener('focus', () => {
  if (currentUser && FB_ON) checkAndSyncCloud();
});
window.addEventListener('online', () => {
  if (currentUser && FB_ON) {
    setSyncStatus('syncing');
    checkAndSyncCloud();
  }
});

function initDailyExtras() {
  checkReminders();
  runDailySpotify();
}

/* ────── App init (after auth) ────── */
async function initApp() {
  updateUserBar();
  // If cloud user, start realtime sync and fetch data
  if (currentUser && FB_ON) {
    startRealtimeSync();
    await checkAndSyncCloud();
  }
  refreshAll();
  const today = todayKey(); const data = loadLocal();
  if (data[today]) openTab(today);
  else if (allKeys().length > 0) openTab(allKeys()[0]);
  else showWelcome();
  if (activeTab) {
    const d = keyToDate(activeTab); calYear = d.getFullYear(); calMonth = d.getMonth(); renderCalendar();
  }

  const yk = yesterdayKey();
  const yd = localGetDay(yk);
  const yc = yd.checklist || [];
  const missed = yc.filter(c => !c.done).length;
  if (missed > 0) {
    setTimeout(() => showToast(`Você deixou ${missed} tarefa(s) pendente(s) ontem.`, true), 1500);
  }

  initDailyExtras();
}

/* ────── BOOT ────── */
(async function boot() {
  loadTheme();
  await spotifyHandleCallback();
  await initIDB();
  $('app').style.display = 'none';

  if (FB_ON) {
    // Firebase auth listener
    auth.onAuthStateChanged(async user => {
      currentUser = user || null;
      if (user) {
        localStorage.setItem(SK_MODE, 'online');
        hideAuthScreen();

        db.collection('users').doc(user.uid).get().then(doc => {
          if (doc.exists && doc.data().avatar) {
            localStorage.setItem('userAvatarBase64', doc.data().avatar);
            updateUserBar();
          }
        });
        await initApp();

      } else {
        const mode = localStorage.getItem(SK_MODE);
        if (mode === 'offline') {
          hideAuthScreen();
          await initApp();
        } else {
          showAuthScreen();
        }
      }
    });
  } else {
    $('app').style.display = 'flex';
    setSyncStatus('offline');
    await initApp();
  }
})();