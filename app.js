
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyATIJHLsHQJx7qbXalP8CnR1Ewg3JpUveI",
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
function localGetDay(k) { return loadLocal()[k] || { content: '', updatedAt: null, tags: [], images: [] }; }
function localSetDay(k, content, tags, images) {
  const d = loadLocal();
  const existingImages = d[k] && Array.isArray(d[k].images) ? d[k].images : [];
  d[k] = { content, updatedAt: new Date().toISOString(), tags: tags || [], images: images !== undefined ? images : existingImages };
  saveLocal(d);
}
function localDelDay(k) { const d = loadLocal(); delete d[k]; saveLocal(d); }
function allKeys() { return Object.keys(loadLocal()).sort().reverse(); }

/* ────── Firestore Sync ────── */
function userDaysRef() { return db.collection('users').doc(currentUser.uid).collection('days'); }

async function cloudSaveDay(key, content, tags, images) {
  if (!db || !currentUser) return;
  try {
    await userDaysRef().doc(key).set({ content, tags: tags || [], images: images || [], updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    setSyncStatus('synced');
  } catch (e) { setSyncStatus('offline'); }
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
function setSyncStatus(state) {
  const bar = $('syncBar'); const txt = $('syncText');
  if (!bar || !txt) return;
  bar.className = 'sync-bar ' + state;
  if (state === 'synced') txt.textContent = 'Sincronizado ✓';
  else if (state === 'syncing') txt.textContent = 'Sincronizando...';
  else txt.textContent = 'Modo local';
}

/* ────── Combined get/set (local + cloud) ────── */
async function getDay(k) { return localGetDay(k); }
async function setDay(k, content, tags, images) {
  localSetDay(k, content, tags, images);
  if (currentUser) cloudSaveDay(k, content, tags, images);
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
  $('themeToggleBtn').innerHTML = isL ? '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>' : '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  const sb = $('settingsThemeBtn');
  if (sb) sb.textContent = isL ? 'Mudar para Escuro' : 'Mudar para Claro';
}

/* ────── Tag colors ────── */
function renderTagChip(name, withDel) {
  const del = withDel ? `<button class="tag-chip-del" data-tag="${esc(name)}" title="Remover">&#x00D7;</button>` : '';
  return `<span class="tag-chip">#${esc(name)}${del}</span>`;
}

/* ────── Toast ────── */
let toastT;
function toast(msg, icon = '✓') { $('toast-msg').textContent = msg; $('toast-icon').innerHTML = icon; $('toast').classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => $('toast').classList.remove('show'), 2800); }

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


/* ══════════ AI GEMINI INTEGRATION ══════════ */
let geminiApiKey = localStorage.getItem('geminiApiKey') || '';

if ($('geminiApiKeyInput')) {
  $('geminiApiKeyInput').value = geminiApiKey;
  $('saveApiKeyBtn').addEventListener('click', () => {
    geminiApiKey = $('geminiApiKeyInput').value.trim();
    localStorage.setItem('geminiApiKey', geminiApiKey);
    showToast('Chave API salva com sucesso!', false);
  });
}

if ($('tb-ai')) {
  $('tb-ai').addEventListener('click', () => {
    if (!geminiApiKey) {
      // Pulse the settings button to hint where to configure
      const sBtn = $('settingsBtn');
      sBtn.style.outline = '2px solid rgba(231,111,81,0.8)';
      sBtn.style.outlineOffset = '2px';
      setTimeout(() => { sBtn.style.outline = ''; sBtn.style.outlineOffset = ''; }, 2000);
      showToast('Configure sua Chave Gemini nas ⚙️ Configurações.', true);
      openSettings();
      return;
    }
    $('ai-overlay').classList.add('show');
  });
}

if ($('aiBtnCancel')) {
  $('aiBtnCancel').addEventListener('click', () => {
    $('ai-overlay').classList.remove('show');
  });
  $('ai-overlay').addEventListener('click', (e) => {
    if (e.target === $('ai-overlay')) $('ai-overlay').classList.remove('show');
  });
}

async function callGemini(prompt, systemInstruction = '') {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }]
  };
  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'Erro na API');

    return data.candidates[0].content.parts[0].text;
  } catch (error) {
    console.error('Gemini Error:', error);
    showToast('Erro na IA: ' + error.message, true);
    return null;
  }
}

function setAILoading(btnId, isLoading, originalText) {
  const btn = $(btnId);
  if (!btn) return;
  if (isLoading) {
    btn.disabled = true;
    btn.textContent = 'Processando...';
    $('editor').contentEditable = "false";
  } else {
    btn.disabled = false;
    btn.textContent = originalText;
    $('editor').contentEditable = "true";
    $('ai-overlay').classList.remove('show');
  }
}

// AI Action: Improve Text
if ($('aiBtnImprove')) {
  $('aiBtnImprove').addEventListener('click', async () => {
    const sel = window.getSelection();
    let text = sel.toString();
    let isSelection = true;

    if (!text.trim()) {
      text = $('editor').innerText;
      isSelection = false;
    }

    if (!text.trim()) {
      showToast('Anotação vazia.', true);
      return;
    }

    setAILoading('aiBtnImprove', true, 'Melhorar Texto Selecionado');

    try {
      const prompt = `Melhore o seguinte texto corrigindo erros gramaticais e deixando-o mais claro e profissional. Mantenha a mesma linguagem e tom original. Responda apenas com o texto melhorado:\n\n${text}`;
      const result = await callGemini(prompt);
      if (result) {
        if (isSelection) {
          document.execCommand('insertText', false, result);
        } else {
          $('editor').innerText = result;
        }
        doSave();
        updateWC();
        showToast('Texto melhorado!', false);
      }
    } finally {
      setAILoading('aiBtnImprove', false, 'Melhorar Texto Selecionado');
    }
  });
}

// AI Action: Summarize
if ($('aiBtnSummarize')) {
  $('aiBtnSummarize').addEventListener('click', async () => {
    const text = $('editor').innerText;
    if (!text.trim()) return showToast('Anotação vazia.', true);

    setAILoading('aiBtnSummarize', true, 'Resumir o Dia');

    try {
      const prompt = `Resuma os pontos principais do seguinte diário/anotação em um formato de lista com tópicos markdown (bullet points). Seja conciso. Anotação:\n\n${text}`;
      const result = await callGemini(prompt);
      if (result) {
        let htmlResult = '<br><br><strong>Resumo da IA:</strong><br>';
        htmlResult += result.replace(/\n/g, '<br>');
        $('editor').innerHTML += htmlResult;
        doSave();
        updateWC();
        showToast('Resumo gerado!', false);
      }
    } finally {
      setAILoading('aiBtnSummarize', false, 'Resumir o Dia');
    }
  });
}
if ($('aiBtnTags')) {
  $('aiBtnTags').addEventListener('click', async () => {
    const text = $('editor').innerText;
    if (!text.trim()) return showToast('Anotação vazia.', true);

    setAILoading('aiBtnTags', true, 'Gerar Auto-Tags');

    try {
      const prompt = `Leia a anotação abaixo e gere até 5 palavras-chave (tags) relevantes. Responda APENAS com as tags separadas por vírgula, sem usar o símbolo #. Exemplo: estudo, trabalho, reunião.\n\n${text}`;
      const result = await callGemini(prompt);
      if (result) {
        const newTags = result.split(',').map(t => t.trim().toLowerCase().replace(/[^a-z0-9_\-àáâãéêíóôõúç]/gi, '')).filter(t => t.length > 0);
        newTags.forEach(t => { if (!currentTags.includes(t)) currentTags.push(t); });
        renderTagsInEditor();
        doSave();
        showToast(`${newTags.length} tag(s) gerada(s)!`, false);
      }
    } finally {
      setAILoading('aiBtnTags', false, 'Gerar Auto-Tags');
    }
  });
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
  $('settings-overlay').classList.add('show');
}
function closeSettings() { $('settings-overlay').classList.remove('show'); }
$('settings-overlay').addEventListener('click', e => { if (e.target === $('settings-overlay')) closeSettings(); });
$('settingsCloseBtn').addEventListener('click', closeSettings);
$('settingsBtn').addEventListener('click', openSettings);
$('settingsThemeBtn').addEventListener('click', () => { toggleTheme(); });
$('settingsBackupBtn').addEventListener('click', () => { closeSettings(); doBackup(); });
$('settingsRestoreBtn').addEventListener('click', () => { closeSettings(); doRestore(); });

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
  $('authBtnLabel').textContent = mode === 'login' ? 'Entrar' : 'Criar Conta';
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
      'auth/wrong-password': 'Senha tá errada, bobão.',
      'auth/email-already-in-use': 'Email ja cadastrado.',
      'auth/invalid-email': 'Email inválido.',
      'auth/too-many-requests': 'Muitas tentativas. Tente mais tarde.',
      'auth/network-request-failed': 'Sem conexão seu pobre. Tente o modo offline.',
    };
    errEl.textContent = msgs[e.code] || 'Erro: ' + e.message;
    btn.disabled = false;
    $('authBtnLabel').textContent = authMode === 'login' ? 'Entrar' : 'Criar Conta';
  }
}

$('authOfflineBtn').addEventListener('click', goOffline);

function goOffline() {
  currentUser = null;
  localStorage.setItem(SK_MODE, 'offline');
  hideAuthScreen();
  setSyncStatus('offline');
  updateUserBar();
  initApp();
}

function doLogout() {
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
  openModal({
    title: 'Sair da conta',
    body: 'Deseja sair? Seus dados continuarao salvos.',
    actions: [
      { label: 'Cancelar', cls: 'btn-cancel' },
      { label: 'Sair', cls: 'btn-danger', cb: doLogout }
    ]
  });
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
    setSyncStatus('synced');
  } else if (currentUser === null) {
    bar.style.display = 'flex';
    $('userEmail').textContent = 'Modo offline';
    $('userAvatar').innerHTML = '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
    $('userMode').textContent = 'Dados salvos localmente';
    setSyncStatus('offline');
  } else {
    bar.style.display = 'none';
  }
}
let activeTagFilter = null;
function renderTagFilterBar() {
  const all = new Set();
  Object.values(loadLocal()).forEach(d => (d.tags || []).forEach(t => all.add(t)));
  const bar = $('tagFilterBar');
  if (!all.size) { bar.innerHTML = ''; return; }
  bar.innerHTML = [...all].map(t => {
    const ac = activeTagFilter === t ? ' active' : '';
    return `<span class="tag-filter-chip${ac}" data-tag="${esc(t)}">#${esc(t)}</span>`;
  }).join('');
  bar.querySelectorAll('.tag-filter-chip').forEach(el => {
    el.addEventListener('click', () => {
      activeTagFilter = activeTagFilter === el.dataset.tag ? null : el.dataset.tag;
      renderTagFilterBar(); renderSidebar($('searchInput').value);
    });
  });
}

function renderSidebar(filter) {
  const q = (filter || '').trim().toLowerCase();
  const isTagQ = q.startsWith('#'); const tagQ = isTagQ ? q.slice(1) : '';
  const data = loadLocal(); const keys = Object.keys(data).sort().reverse();
  const filtered = keys.filter(k => {
    const day = data[k]; const tags = day.tags || [];
    if (activeTagFilter && !tags.includes(activeTagFilter)) return false;
    if (!q) return true;
    if (isTagQ) return tags.some(t => t.toLowerCase().includes(tagQ));
    return fmtFull(k).toLowerCase().includes(q) || toPlain(day.content || '').toLowerCase().includes(q);
  });
  if (!filtered.length) {
    $('daysList').innerHTML = `<div class="empty-msg">${q || activeTagFilter ? 'Nenhum resultado.' : 'Nenhuma anotação ainda.<br>Clique em <b>Nova Anotação</b>.'}</div>`;
    return;
  }
  $('daysList').innerHTML = filtered.map(k => {
    const d = data[k]; const c = d.content || ''; const tags = d.tags || [];
    const preview = toPlain(c).slice(0, 52).trim() || 'Sem conteúdo';
    const ac = k === activeTab ? ' active' : ''; const hc = c.trim().length ? ' has-content' : '';
    const chips = tags.slice(0, 2).map(t => { return `<span class="day-tag-chip">#${esc(t)}</span>`; }).join('');
    return `<div class="day-item${ac}${hc}" data-key="${k}" tabindex="0">
      <div class="day-dot"></div>
      <div class="day-item-info">
        <div class="day-item-date">${esc(fmtShort(k))}</div>
        <div class="day-item-meta">${chips}<span class="day-item-preview">${esc(preview)}</span></div>
      </div>
      <button class="day-item-del" data-del="${k}">&#x00D7;</button>
    </div>`;
  }).join('');
  $('daysList').querySelectorAll('.day-item').forEach(el => {
    el.addEventListener('click', e => { if (e.target.closest('.day-item-del')) return; openTab(el.dataset.key); });
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') openTab(el.dataset.key); });
  });
  $('daysList').querySelectorAll('.day-item-del').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); confirmDelete(btn.dataset.del); });
  });
}


let calYear = new Date().getFullYear(), calMonth = new Date().getMonth();
function renderCalendar() {
  const notes = new Set(allKeys()); const today = todayKey();
  const first = new Date(calYear, calMonth, 1).getDay();
  const days = new Date(calYear, calMonth + 1, 0).getDate();
  $('calMonthLabel').textContent = new Date(calYear, calMonth, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  let html = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map(d => `<div class="cal-dow">${d}</div>`).join('');
  for (let i = 0; i < first; i++)html += `<div class="cal-day empty"></div>`;
  for (let d = 1; d <= days; d++) {
    const k = `${calYear}-${pad(calMonth + 1)}-${pad(d)}`;
    let cls = 'cal-day';
    if (k === today) cls += ' today';
    if (notes.has(k)) cls += ' has-note';
    if (k === activeTab) cls += ' active-day';
    html += `<div class="${cls}" data-key="${k}">${d}</div>`;
  }
  $('calGrid').innerHTML = html;
  $('calGrid').querySelectorAll('.cal-day:not(.empty)').forEach(el => {
    el.addEventListener('click', () => { createOrOpen(el.dataset.key); closeSidebar(); });
  });
}
$('calPrev').addEventListener('click', () => { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } renderCalendar(); });
$('calNext').addEventListener('click', () => { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } renderCalendar(); });

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
$('hamburgerBtn').addEventListener('click', () => {
  if (window.innerWidth <= 768) {
    $('sidebar').classList.contains('open') ? closeSidebar() : openSidebar();
  } else {
    $('sidebar').classList.remove('collapsed');
  }
});
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
  if (!d[key]) { d[key] = { content: '', updatedAt: new Date().toISOString(), tags: [] }; saveLocal(d); }
  if (!openTabs.includes(key)) openTabs.push(key);
  activateTab(key);
}
function activateTab(key) {
  activeTab = key; renderTabs(); renderSidebar($('searchInput').value); renderCalendar(); showEditor(key);
}
function closeTab(key) {
  openTabs = openTabs.filter(k => k !== key);
  if (activeTab === key) activeTab = openTabs[openTabs.length - 1] || null;
  renderTabs();
  if (activeTab) { renderSidebar($('searchInput').value); showEditor(activeTab); }
  else { showWelcome(); renderSidebar($('searchInput').value); }
  renderCalendar();
}
function showWelcome() { $('welcome').style.display = 'flex'; $('editorPane').style.display = 'none'; }

/* ────── Editor ────── */
let currentTags = [];

function showEditor(key) {
  $('welcome').style.display = 'none'; $('editorPane').style.display = 'flex';
  const day = localGetDay(key);
  $('editor').innerHTML = day.content || '';
  $('currentDayTitle').textContent = fmtFull(key);
  const upd = day.updatedAt ? new Date(day.updatedAt).toLocaleString('pt-BR') : null;
  $('currentDaySubtitle').textContent = upd ? `Ultima edicao: ${upd}` : 'Nenhuma edicao ainda';
  currentTags = [...(day.tags || [])];
  renderTagsInEditor(); setSave('saved'); updateWC(); $('editor').focus();
}
function setSave(s) {
  $('saveStatus').className = '';
  if (s === 'saved') { $('saveStatus').classList.add('saved'); $('saveStatusText').textContent = 'Salvo'; }
  else { $('saveStatus').classList.add('saving'); $('saveStatusText').textContent = 'Salvando...'; }
}
function updateWC() {
  const t = toPlain($('editor').innerHTML); const w = cWords(t); const c = t.length;
  $('wc-words').textContent = `${w} ${w === 1 ? 'palavra' : 'palavras'}`;
  $('wc-chars').textContent = `${c} ${c === 1 ? 'caractere' : 'caracteres'}`;
}
async function saveCurrent() {
  if (!activeTab) return;
  const day = localGetDay(activeTab); await setDay(activeTab, $('editor').innerHTML, currentTags, day.images);
  setSave('saved'); renderSidebar($('searchInput').value); renderTagFilterBar(); renderCalendar();
  $('currentDaySubtitle').textContent = `Ultima edicao: ${new Date().toLocaleString('pt-BR')}`;
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

/* ────── Export TXT ────── */
$('exportBtn').addEventListener('click', () => {
  if (!activeTab) return;
  const day = localGetDay(activeTab);
  const tags = (day.tags || []).map(t => `#${t}`).join(' ');
  const txt = `AGENDA PESSOAL - ${fmtFull(activeTab)}\n${'='.repeat(52)}\nTags: ${tags || 'nenhuma'}\n\n${toPlain(day.content)}`;
  const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `agenda_${activeTab}.txt`; a.click();
  URL.revokeObjectURL(url); toast('Exportado!', '');
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

/* ────── Ctrl+Tab ────── */
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Tab') {
    e.preventDefault();
    if (openTabs.length < 2) return;
    activateTab(openTabs[(openTabs.indexOf(activeTab) + 1) % openTabs.length]);
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

/* ────── Gallery UI ────── */
$('tabText').addEventListener('click', () => {
  $('tabText').classList.add('active'); $('tabGallery').classList.remove('active');
  $('toolbar').style.display = 'flex'; $('editorWrap').style.display = 'block'; $('wordCount').style.display = 'flex';
  $('galleryPane').style.display = 'none';
});
$('tabGallery').addEventListener('click', () => {
  $('tabGallery').classList.add('active'); $('tabText').classList.remove('active');
  $('toolbar').style.display = 'none'; $('editorWrap').style.display = 'none'; $('wordCount').style.display = 'none';
  $('galleryPane').style.display = 'block';
  renderGallery();
});

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
      const dataUrl = await compressImage(file);
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

    await setDay(activeTab, day.content, day.tags, day.images);
    renderGallery();
    setSave('saved');
    toast('Imagem colada na galeria!', '');
  }
});

$('lbClose').addEventListener('click', () => $('lightbox').classList.remove('show'));
$('lightbox').addEventListener('click', e => { if (e.target === $('lightbox')) $('lightbox').classList.remove('show'); });

/* ────── App init (after auth) ────── */
async function initApp() {
  updateUserBar();
  // If cloud user, load from Firestore and merge with local
  if (currentUser && FB_ON) {
    const cloudData = await cloudLoadAll();
    if (cloudData) {
      const local = loadLocal();
      // Merge: cloud wins on conflict (most recent updatedAt)
      const merged = { ...local };
      Object.entries(cloudData).forEach(([k, v]) => {
        if (!merged[k] || (v.updatedAt && (!merged[k].updatedAt || v.updatedAt > merged[k].updatedAt))) {
          merged[k] = v;
        }
      });
      saveLocal(merged);
    }
  }
  refreshAll();
  const today = todayKey(); const data = loadLocal();
  if (data[today]) openTab(today);
  else if (allKeys().length > 0) openTab(allKeys()[0]);
  else showWelcome();
  if (activeTab) {
    const d = keyToDate(activeTab); calYear = d.getFullYear(); calMonth = d.getMonth(); renderCalendar();
  }
}

/* ────── BOOT ────── */
(async function boot() {
  loadTheme();
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