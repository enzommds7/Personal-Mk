
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

/* ────── Firestore Sync ────── */
function userDaysRef() { return db.collection('users').doc(currentUser.uid).collection('days'); }

async function cloudSaveDay(key, content, tags, images, checklist) {
  if (!db || !currentUser) return;
  try {
    await userDaysRef().doc(key).set({ 
      content, 
      tags: tags || [], 
      images: images || [], 
      checklist: checklist || [], 
      updatedAt: firebase.firestore.FieldValue.serverTimestamp() 
    }, { merge: true });
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
  $('themeToggleBtn').innerHTML = isL ? '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>' : '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
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
      showToast('Configure sua Chave Gemini na Configurações (Engrenagem ali em cima).', true);
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
    btn.dataset.origHtml = btn.innerHTML;
    btn.innerHTML = '<span style="display:inline-flex;align-items:center;gap:6px;"><div class="auth-spinner" style="width:14px;height:14px;border-width:2px;display:inline-block;"></div> Processando...</span>';
    $('editor').contentEditable = "false";
  } else {
    btn.disabled = false;
    if (btn.dataset.origHtml) btn.innerHTML = btn.dataset.origHtml;
    else if (originalText) btn.textContent = originalText;
    $('editor').contentEditable = "true";
    $('ai-overlay').classList.remove('show');
  }
}

// AI Action 1: Gerar Resumo em Tópicos (3 bullets)
if ($('aiBtnSummarize')) {
  $('aiBtnSummarize').addEventListener('click', async () => {
    const text = $('editor').innerText;
    if (!text.trim()) return showToast('Anotação vazia.', true);

    setAILoading('aiBtnSummarize', true);

    try {
      const prompt = `Resuma o texto da seguinte anotação em EXATAMENTE 3 tópicos (bullet points) objetivos, claros e diretos. Cada tópico DEVE começar com "• ". Não adicione títulos, saudações nem introduções. Texto:\n\n${text}`;
      const result = await callGemini(prompt);
      if (result) {
        let htmlResult = '<br><div class="ai-summary-block"><strong>📌 Resumo em 3 Tópicos:</strong><br>';
        htmlResult += result.trim().replace(/\n+/g, '<br>') + '</div><br>';
        $('editor').innerHTML += htmlResult;
        doSave();
        updateWC();
        showToast('Resumo em 3 tópicos gerado!', false);
      }
    } finally {
      setAILoading('aiBtnSummarize', false);
    }
  });
}

// AI Action 2: Corrigir e Melhorar Escrita
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

    setAILoading('aiBtnImprove', true);

    try {
      const prompt = `Corrija e melhore a escrita do texto a seguir, ajustando com precisão a pontuação, acentuação e gramática. Mantenha fielmente o tom, o sentido e a intenção originais. Responda APENAS com o texto corrigido, sem explicações, saudações ou aspas:\n\n${text}`;
      const result = await callGemini(prompt);
      if (result) {
        if (isSelection) {
          document.execCommand('insertText', false, result);
        } else {
          $('editor').innerText = result;
        }
        doSave();
        updateWC();
        showToast('Texto corrigido e aprimorado!', false);
      }
    } finally {
      setAILoading('aiBtnImprove', false);
    }
  });
}

// AI Action 3: Extrair Tarefas / To-Do
if ($('aiBtnExtractTodos')) {
  $('aiBtnExtractTodos').addEventListener('click', async () => {
    const text = $('editor').innerText;
    if (!text.trim()) return showToast('Anotação vazia.', true);

    setAILoading('aiBtnExtractTodos', true);

    try {
      const prompt = `Varra o texto a seguir procurando todas as pendências, tarefas e compromissos. Retorne cada tarefa em uma linha começando com "- [ ] ". Se houver horário no texto (ex: 14:00, às 10h), coloque no final da linha no formato "(HH:MM)". Responda APENAS com a lista de tarefas, sem saudações ou explicações:\n\n${text}`;
      const result = await callGemini(prompt);
      if (result) {
        const lines = result.split('\n').map(l => l.trim()).filter(Boolean);
        let count = 0;
        lines.forEach(line => {
          const clean = line.replace(/^[-\*\•\d\.\s\[\]]+/, '').trim();
          if (clean) {
            let taskTime = '';
            const timeMatch = clean.match(/\(([0-2]?[0-9]:[0-5][0-9])\)/);
            let finalDesc = clean;
            if (timeMatch) {
              taskTime = timeMatch[1];
              finalDesc = clean.replace(timeMatch[0], '').trim();
            }
            currentChecklist.push({ text: finalDesc, time: taskTime, done: false, notified: false });
            count++;
          }
        });

        if (count > 0) {
          saveCurrent();
          if ($('tabChecklist')) renderChecklist();
          showToast(`${count} tarefa(s) extraída(s) para a aba Tarefas!`, false);
        } else {
          showToast('Nenhuma pendência identificada no texto.', true);
        }
      }
    } finally {
      setAILoading('aiBtnExtractTodos', false);
    }
  });
}

// AI Action 4: Sugerir Tags / Categorias
if ($('aiBtnTags')) {
  $('aiBtnTags').addEventListener('click', async () => {
    const text = $('editor').innerText;
    if (!text.trim()) return showToast('Anotação vazia.', true);

    setAILoading('aiBtnTags', true);

    try {
      const prompt = `Leia a anotação abaixo e sugira EXATAMENTE 3 palavras-chave (tags) concisas e relevantes em português para categorizá-la. Responda APENAS com as 3 palavras separadas por vírgula, todas em letras minúsculas, sem o caractere # e sem acentos ou caracteres especiais. Exemplo: trabalho, reuniao, financas.\n\n${text}`;
      const result = await callGemini(prompt);
      if (result) {
        const newTags = result.split(',')
          .map(t => t.trim().toLowerCase().replace(/[^a-z0-9_\-àáâãéêíóôõúç]/gi, ''))
          .filter(t => t.length > 0)
          .slice(0, 3);

        let addedCount = 0;
        newTags.forEach(t => {
          if (!currentTags.includes(t)) {
            currentTags.push(t);
            addedCount++;
          }
        });

        renderTagsInEditor();
        renderTagFilterBar();
        doSave();
        showToast(`${addedCount || newTags.length} tag(s) vinculada(s) à nota!`, false);
      }
    } finally {
      setAILoading('aiBtnTags', false);
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
      'auth/email-already-in-use': 'Email já cadastrado.',
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
    body: 'Deseja sair? Seus dados continuarão salvos.',
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
    const tags = d.tags || [];
    const preview = item.preview || toPlain(c).slice(0, 52).trim() || 'Sem conteúdo';
    const ac = k === activeTab ? ' active' : '';
    const hc = c.trim().length ? ' has-content' : '';

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

let currentTags = [];
let currentChecklist = [];

function showEditor(key) {
  $('welcome').style.display = 'none'; $('editorPane').style.display = 'flex';
  const day = localGetDay(key);
  $('editor').innerHTML = day.content || '';
  $('currentDayTitle').textContent = fmtFull(key);
  const upd = day.updatedAt ? new Date(day.updatedAt).toLocaleString('pt-BR') : null;
  $('currentDaySubtitle').textContent = upd ? `Ultima edicao: ${upd}` : 'Nenhuma edicao ainda';
  currentTags = [...(day.tags || [])];
  currentChecklist = [...(day.checklist || [])];
  renderTagsInEditor();
  if($('tabChecklist') && $('tabChecklist').classList.contains('active')) {
    renderChecklist();
  }
  setSave('saved'); updateWC(); $('editor').focus();
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
  if (!activeTab) return;
  const day = localGetDay(activeTab); 
  await setDay(activeTab, $('editor').innerHTML, currentTags, day.images, currentChecklist);
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
  toast('Anotação exportada em Markdown (.md)!', '📄');
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
  toast(`${keys.length} anotações exportadas em Markdown (.md)!`, '📄');
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

  // 1. Ctrl/Cmd + Tab: Alternar entre abas
  if (modKey && e.key === 'Tab') {
    e.preventDefault();
    if (openTabs.length < 2) return;
    activateTab(openTabs[(openTabs.indexOf(activeTab) + 1) % openTabs.length]);
    return;
  }

  // 2. Ctrl/Cmd + N: Criar nova anotação
  if (modKey && e.key.toLowerCase() === 'n') {
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
  const isTyping = document.activeElement && (
    document.activeElement.tagName === 'INPUT' ||
    document.activeElement.tagName === 'TEXTAREA' ||
    document.activeElement.isContentEditable
  );

  if ((modKey && e.key.toLowerCase() === 'k') || (!isTyping && e.key === '/')) {
    e.preventDefault();
    openQuickSearch();
    return;
  }

  // 5. Escape: Fechar modais abertos
  if (e.key === 'Escape') {
    if ($('quicksearch-overlay') && $('quicksearch-overlay').classList.contains('show')) {
      closeQuickSearch();
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

// Reminder checker every minute
setInterval(() => {
  if (!activeTab || activeTab !== todayKey() || !currentChecklist) return;
  const now = new Date();
  const currentMins = now.getHours() * 60 + now.getMinutes();

  let modified = false;
  currentChecklist.forEach((item) => {
    if (!item.done && item.time && !item.notified) {
      const [hStr, mStr] = item.time.split(':');
      if (hStr && mStr) {
        const taskMins = parseInt(hStr, 10) * 60 + parseInt(mStr, 10);
        const diff = taskMins - currentMins;
        if (diff > 0 && diff <= 30) {
          toast(`Lembrete: "${item.text}" às ${item.time}`, '⏰');
          item.notified = true;
          modified = true;
        }
      }
    }
  });
  if (modified) saveCurrent();
}, 60000);

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

  const yk = yesterdayKey();
  const yd = localGetDay(yk);
  const yc = yd.checklist || [];
  const missed = yc.filter(c => !c.done).length;
  if (missed > 0) {
    setTimeout(() => showToast(`Você deixou ${missed} tarefa(s) pendente(s) ontem.`, true), 1500);
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