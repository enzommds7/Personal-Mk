
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
function saveLocal(d) {
  try {
    localStorage.setItem(localKey(), JSON.stringify(d));
  } catch (error) {
    // localStorage pode falhar por quota excedida (ex.: imagens base64) ou bloqueio do navegador.
    console.error('Não foi possível salvar as anotações neste dispositivo:', error);
    const message = 'Falha ao salvar as anotações neste dispositivo. Não feche esta aba. Libere espaço e exporte um backup antes de continuar.';
    if (typeof showToast === 'function' && document.getElementById('toast')) {
      showToast(message, true);
    } else {
      window.alert(message);
    }
    throw error;
  }
}
function localGetDay(k) { return loadLocal()[k] || { content: '', updatedAt: null, tags: [], images: [], checklist: [] }; }
function localSetDay(k, content, tags, images, checklist, title) {
  const d = loadLocal();
  const existingImages = d[k] && Array.isArray(d[k].images) ? d[k].images : [];
  const existingChecklist = d[k] && Array.isArray(d[k].checklist) ? d[k].checklist : [];
  const existingTitle = d[k] && typeof d[k].title === 'string' ? d[k].title : '';
  d[k] = { 
    content, 
    updatedAt: new Date().toISOString(), 
    tags: tags || [], 
    images: images !== undefined ? images : existingImages,
    checklist: checklist !== undefined ? checklist : existingChecklist,
    title: typeof title === 'string' ? title : existingTitle
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

function hasRealContent(day) {
  if (!day) return false;
  return !isContentEmpty(day.content) ||
    (typeof day.title === 'string' && day.title.trim().length > 0) ||
    (Array.isArray(day.tags) && day.tags.length > 0) ||
    (Array.isArray(day.checklist) && day.checklist.length > 0) ||
    (Array.isArray(day.images) && day.images.length > 0);
}

function dayDiffers(a, b) {
  return (a.content || '') !== (b.content || '') ||
    (a.title || '') !== (b.title || '') ||
    JSON.stringify(a.tags || []) !== JSON.stringify(b.tags || []) ||
    JSON.stringify(a.images || []) !== JSON.stringify(b.images || []) ||
    JSON.stringify(a.checklist || []) !== JSON.stringify(b.checklist || []);
}

function migrateAnonymousToUserCache() {
  if (!currentUser) return false;
  let rawAnon = null;
  try {
    rawAnon = JSON.parse(localStorage.getItem(SK) || 'null');
  } catch { return false; }
  if (!rawAnon || typeof rawAnon !== 'object' || Array.isArray(rawAnon)) return false;

  const userLocal = loadLocal();
  let changed = false;
  const migratedKeys = [];
  Object.entries(rawAnon).forEach(([key, anonDoc]) => {
    if (!hasRealContent(anonDoc)) return;
    const targetDoc = {
      content: anonDoc.content || '',
      tags: Array.isArray(anonDoc.tags) ? anonDoc.tags : [],
      images: Array.isArray(anonDoc.images) ? anonDoc.images : [],
      checklist: Array.isArray(anonDoc.checklist) ? anonDoc.checklist : [],
      title: typeof anonDoc.title === 'string' ? anonDoc.title : '',
      updatedAt: anonDoc.updatedAt || null
    };
    if (mergeRemoteDay(key, targetDoc, userLocal)) {
      changed = true;
    }
    migratedKeys.push(key);
  });

  if (changed) saveLocal(userLocal);
  // Não apagar as notas anônimas após a cópia: elas são uma reserva local
  // importante caso o upload do usuário falhe ou o Firestore esteja offline.
  // Repetir a migração é seguro porque mergeRemoteDay compara as versões.
  return changed;
}

// Histórico local de conflitos: nunca publica conteúdo privado no repositório.
function preserveConflictingDay(key, losingDoc) {
  const historyKey = localKey() + '_conflicts';
  try {
    const previous = JSON.parse(localStorage.getItem(historyKey) || '[]');
    const history = Array.isArray(previous) ? previous : [];
    const fingerprint = JSON.stringify([key, losingDoc.updatedAt, losingDoc.content, losingDoc.title]);
    if (history.some(entry => entry.fingerprint === fingerprint)) return true;
    history.push({ key, savedAt: new Date().toISOString(), fingerprint, day: losingDoc });
    // Preserva os 30 conflitos mais recentes; backups JSON externos continuam necessários.
    localStorage.setItem(historyKey, JSON.stringify(history.slice(-30)));
    return true;
  } catch (error) {
    console.error('Falha ao preservar versão conflitante:', error);
    if (typeof showToast === 'function' && document.getElementById('toast')) {
      showToast('Sem espaço para guardar versão conflitante. Exporte backup antes de sincronizar.', true);
    }
    return false;
  }
}

function mergeRemoteDay(key, remoteDoc, localData) {
  const localDoc = localData[key];
  if (!localDoc) {
    localData[key] = remoteDoc;
    return true;
  }
  
  const remoteEmpty = !hasRealContent(remoteDoc);
  const localEmpty = !hasRealContent(localDoc);
  
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
    if (dayDiffers(localDoc, remoteDoc)) {
      // Uma nota local com conteúdo nunca é descartada sem cópia de recuperação.
      if (!localEmpty && !remoteEmpty && !preserveConflictingDay(key, localDoc)) return false;
      localData[key] = { ...localDoc, ...remoteDoc };
      return true;
    }
  }
  return false;
}

function applyRemoteEditorUpdate(local, activeTabChanged) {
  if (!activeTabChanged || !activeTab) return;
  if (!local[activeTab]) {
    if (openTabs.includes(activeTab)) closeTab(activeTab);
    return;
  }
  if (document.activeElement === $('editor')) return;
  isApplyingRemoteChange = true;
  const day = local[activeTab];
  $('editor').innerHTML = day.content || '';
  if ($('noteTitle') && document.activeElement !== $('noteTitle')) $('noteTitle').value = day.title || '';
  currentTags = day.tags ? [...day.tags] : [];
  renderTagsInEditor();
  currentChecklist = day.checklist ? [...day.checklist] : [];
  if (typeof renderChecklist === 'function') renderChecklist();
  if (typeof renderGallery === 'function') renderGallery();
  updateWC();
  $('currentDaySubtitle').textContent = day.updatedAt ? fmtEdited(day.updatedAt) : 'Sincronizado';
  isApplyingRemoteChange = false;
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
      // Snapshot recebido não confirma que uploads locais foram persistidos.
      let hasChanges = false;
      const local = loadLocal();
      let activeTabChanged = false;

      snapshot.docChanges().forEach(change => {
        const doc = change.doc;
        // Não aplicar versões antigas enquanto há edição ou envio em andamento.
        if (shouldDeferRemoteDay(doc.id)) return;
        // Ignore local pending writes to avoid self-echoing while typing
        if (doc.metadata && doc.metadata.hasPendingWrites) return;

        const key = doc.id;
        const raw = doc.data();
        if (change.type === 'removed' || raw?.deleted) {
          if (local[key]) {
            const remTime = raw?.updatedAt?.toDate?.()?.getTime?.() || (raw?.updatedAt ? new Date(raw.updatedAt).getTime() : 0);
            const locTime = local[key].updatedAt ? new Date(local[key].updatedAt).getTime() : 0;
            if (change.type === 'removed' || !locTime || remTime >= locTime) {
              delete local[key];
              hasChanges = true;
              if (activeTab === key) activeTabChanged = true;
            }
          }
        } else {
          const remote = {
            content: raw.content || '',
            title: raw.title || '',
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
        applyRemoteEditorUpdate(local, activeTabChanged);
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

// Evita que eventos de foco, rede e inicialização iniciem merges simultâneos.
let cloudSyncInFlight = null;
function checkAndSyncCloud() {
  if (!currentUser || !FB_ON) return Promise.resolve();
  if (cloudSyncInFlight) return cloudSyncInFlight;
  const operation = performCloudSync();
  cloudSyncInFlight = operation;
  // Não criar uma Promise rejeitada e sem handler apenas para liberar o lock.
  operation.then(() => {
    if (cloudSyncInFlight === operation) cloudSyncInFlight = null;
  }, () => {
    if (cloudSyncInFlight === operation) cloudSyncInFlight = null;
  });
  return operation;
}

async function performCloudSync() {
  if (!currentUser || !FB_ON) return;
  try {
    setSyncStatus('syncing');
    const migrated = migrateAnonymousToUserCache();
    const uid = currentUser.uid;
    const ref = userDaysRef();
    const snap = await ref.get({ source: 'server' });
    if (currentUser?.uid !== uid) return;
    const local = loadLocal();
    const remoteDocs = {};
    let hasChanges = migrated;
    let activeTabChanged = false;

    snap.forEach(doc => {
      const raw = doc.data();
      if (shouldDeferRemoteDay(doc.id)) {
        remoteDocs[doc.id] = { deferred: true };
        return;
      }
      const updIso = raw.updatedAt?.toDate?.()?.toISOString() || raw.updatedAt || null;
      if (raw.deleted) {
        const remTime = updIso ? new Date(updIso).getTime() : 0;
        remoteDocs[doc.id] = { deleted: true, updatedAt: updIso, time: remTime };
        if (local[doc.id]) {
          const locTime = local[doc.id].updatedAt ? new Date(local[doc.id].updatedAt).getTime() : 0;
          if (!locTime || remTime >= locTime) {
            delete local[doc.id];
            hasChanges = true;
            if (activeTab === doc.id) activeTabChanged = true;
          }
        }
        return;
      }

      const remote = {
        content: raw.content || '',
        title: raw.title || '',
        tags: raw.tags || [],
        images: raw.images || [],
        checklist: raw.checklist || [],
        updatedAt: updIso
      };
      remoteDocs[doc.id] = remote;
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
      applyRemoteEditorUpdate(local, activeTabChanged);
    }

    // Upload local notes missing from Firestore or newer than Firestore
    const uploadPromises = [];
    Object.entries(local).forEach(([key, localDoc]) => {
      if (!hasRealContent(localDoc) || shouldDeferRemoteDay(key)) return;
      const rem = remoteDocs[key];
      if (rem?.deferred) return;
      const localTime = localDoc.updatedAt ? new Date(localDoc.updatedAt).getTime() : 0;
      let shouldUpload = false;

      if (!rem) {
        shouldUpload = true;
      } else if (rem.deleted) {
        if (localTime > (rem.time || 0)) shouldUpload = true;
      } else {
        const remoteTime = rem.updatedAt ? new Date(rem.updatedAt).getTime() : 0;
        const differs = dayDiffers(localDoc, rem);
        if ((localTime > remoteTime || !remoteTime) && differs) {
          shouldUpload = true;
        }
      }

      if (shouldUpload) {
        uploadPromises.push(
          ref.doc(key).set({
            content: localDoc.content || '',
            title: localDoc.title || '',
            tags: localDoc.tags || [],
            images: localDoc.images || [],
            checklist: localDoc.checklist || [],
            deleted: false,
            updatedAt: localDoc.updatedAt ? new Date(localDoc.updatedAt) : firebase.firestore.FieldValue.serverTimestamp()
          }, { merge: true })
        );
      }
    });

    if (uploadPromises.length > 0) {
      // Promise.allSettled não lança erro: rejeições precisam ser verificadas.
      const uploadResults = await Promise.allSettled(uploadPromises);
      const failures = uploadResults.filter(result => result.status === 'rejected');
      if (failures.length) {
        console.warn('Falha ao enviar anotações para a nuvem:', failures.length, failures[0].reason);
        setSyncStatus('offline');
        showToast('Algumas anotações ficaram somente neste dispositivo. Exporte um backup antes de limpar dados.', true);
        return;
      }
    }

    if (currentUser?.uid === uid) setSyncStatus(pendingCloudWrites.size ? 'syncing' : 'synced');
  } catch (err) {
    console.warn('checkAndSyncCloud warning:', err);
    setSyncStatus('offline');
  }
}

// Protege notas em edição ou com gravação pendente contra snapshots antigos.
const pendingCloudWrites = new Map();
function hasUnsavedEditorChanges(key) {
  return key === activeTab && (
    document.activeElement === $('editor') ||
    document.activeElement === $('noteTitle')
  );
}
function shouldDeferRemoteDay(key) {
  return (pendingCloudWrites.get(key) || 0) > 0 || hasUnsavedEditorChanges(key);
}
async function cloudSaveDay(key, content, tags, images, checklist) {
  if (!db || !currentUser) return;
  pendingCloudWrites.set(key, (pendingCloudWrites.get(key) || 0) + 1);
  try {
    setSyncStatus('syncing');
    await userDaysRef().doc(key).set({ 
      content: content || '', 
      title: localGetDay(key).title || '',
      tags: tags || [], 
      images: images || [], 
      checklist: checklist || [], 
      deleted: false,
      updatedAt: new Date(localGetDay(key).updatedAt || Date.now())
    }, { merge: true });
    setSyncStatus(pendingCloudWrites.size > 1 || (pendingCloudWrites.get(key) || 0) > 1 ? 'syncing' : 'synced');
  } catch (e) {
    console.error('cloudSaveDay error:', e);
    setSyncStatus('offline');
    showToast('Salvo neste dispositivo, mas não confirmado na nuvem. Faça backup antes de limpar os dados.', true);
  } finally {
    const remaining = (pendingCloudWrites.get(key) || 1) - 1;
    if (remaining > 0) pendingCloudWrites.set(key, remaining);
    else pendingCloudWrites.delete(key);
  }
}

async function cloudDeleteDay(key) {
  if (!db || !currentUser) return;
  try {
    await userDaysRef().doc(key).set({
      deleted: true,
      content: '',
      title: '',
      tags: [],
      images: [],
      checklist: [],
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  } catch (e) {
    console.error('cloudDeleteDay error:', e);
    setSyncStatus('offline');
    showToast('Exclusão salva localmente, mas não confirmada na nuvem.', true);
  }
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
async function setDay(k, content, tags, images, checklist, title) {
  localSetDay(k, content, tags, images, checklist, title);
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

  const tBtn = $('themeToggleBtn');
  if (tBtn) {
    const smallIcon = (isL ? darkSvg : lightSvg).replace(/width="18" height="18"/, 'width="14" height="14"');
    tBtn.innerHTML = `${smallIcon}<span>${isL ? 'Tema escuro' : 'Tema claro'}</span>`;
  }
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
  const del = withDel ? `<button class="tag-chip-del" data-tag="${esc(name)}" title="Remover">&#x00D7;</button>` : '';
  return `<span class="tag-chip">#${esc(name)}${del}</span>`;
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
  if ($('authForgotBtn')) {
    $('authForgotBtn').style.display = mode === 'login' ? '' : 'none';
  }
  $('authBtnLabel').textContent = mode === 'login' ? 'Entrar no PersonalMk' : 'Criar conta gratuita';
  $('authErr').textContent = '';
  $('authPassword').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
}

$('authForgotBtn')?.addEventListener('click', async () => {
  const email = $('authEmail').value.trim();
  const errEl = $('authErr');
  if (!email) {
    errEl.textContent = 'Digite seu email no campo acima para redefinir sua senha.';
    $('authEmail').focus();
    return;
  }
  if (!auth) {
    errEl.textContent = 'Serviço de autenticação offline ou indisponível.';
    return;
  }
  const btn = $('authForgotBtn');
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = 'Enviando link...';
  errEl.textContent = '';
  try {
    await auth.sendPasswordResetEmail(email);
    openModal({
      title: 'Email de recuperação enviado',
      body: `Enviamos as instruções para redefinir a senha para <b>${esc(email)}</b>.<br><br>Verifique sua caixa de entrada e spam para cadastrar sua nova senha.`,
      actions: [
        { label: 'Entendi', cls: 'btn-primary' }
      ]
    });
  } catch (e) {
    const msgs = {
      'auth/user-not-found': 'Nenhuma conta encontrada com este email.',
      'auth/invalid-email': 'Formato de email inválido.',
      'auth/too-many-requests': 'Muitas solicitações seguidas. Aguarde alguns instantes.',
      'auth/network-request-failed': 'Sem conexão de rede. Verifique sua internet.'
    };
    errEl.textContent = msgs[e.code] || ('Erro ao redefinir: ' + (e.message || e.code));
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
});

$('passToggle').addEventListener('click', () => {
  const inp = $('authPassword');
  inp.type = inp.type === 'password' ? 'text' : 'password';
});

$('authSubmitBtn').addEventListener('click', doAuth);
['authEmail', 'authPassword', 'authConfirm'].forEach(id => {
  $(id).addEventListener('keydown', e => { if (e.key === 'Enter') doAuth(); });
});

let isAuthInitializing = false;
let initializedForKey = undefined;

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
  isAuthInitializing = true;

  try {
    let cred;
    if (authMode === 'login') {
      cred = await auth.signInWithEmailAndPassword(email, pass);
    } else {
      cred = await auth.createUserWithEmailAndPassword(email, pass);
    }
    if (cred && cred.user) {
      currentUser = cred.user;
      localStorage.setItem(SK_MODE, 'online');
      btn.disabled = false;
      $('authBtnLabel').textContent = authMode === 'login' ? 'Entrar no PersonalMk' : 'Criar conta gratuita';
      hideAuthScreen();
      setSyncStatus('syncing');
      updateUserBar();
      initializedForKey = cred.user.uid;
      await initApp();
      showToast(authMode === 'login' ? 'Login realizado com sucesso!' : 'Conta criada com sucesso!');
    }
  } catch (e) {
    const msgs = {
      'auth/user-not-found': 'Email não encontrado.',
      'auth/wrong-password': 'Senha incorreta. Tente novamente.',
      'auth/invalid-credential': 'Email ou senha incorretos.',
      'auth/email-already-in-use': 'Email já cadastrado.',
      'auth/invalid-email': 'Email inválido.',
      'auth/too-many-requests': 'Muitas tentativas. Tente mais tarde.',
      'auth/network-request-failed': 'Sem conexão de rede. Tente o modo offline.',
    };
    errEl.textContent = msgs[e.code] || 'Erro: ' + e.message;
    btn.disabled = false;
    $('authBtnLabel').textContent = authMode === 'login' ? 'Entrar no PersonalMk' : 'Criar conta gratuita';
  } finally {
    isAuthInitializing = false;
  }
}

$('authOfflineBtn')?.addEventListener('click', goOffline);
$('authNavOfflineBtn')?.addEventListener('click', goOffline);
$('authThemeToggleBtn')?.addEventListener('click', toggleTheme);
$('mobileThemeBtn')?.addEventListener('click', toggleTheme);

function goOffline() {
  currentUser = null;
  initializedForKey = 'offline';
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
  initializedForKey = undefined;
  localStorage.setItem(SK_MODE, 'offline');
  // Reset state
  openTabs = []; activeTab = null;
  renderTabs(); showWelcome();
  renderSidebar(); renderCalendar(); renderTagFilterBar();
  updateUserBar();
  if (FB_ON) showAuthScreen();
}

function closeUserPopover() {
  const bar = $('userBar');
  const trigger = $('userAvatar');
  if (bar) bar.style.display = 'none';
  if (trigger) trigger.setAttribute('aria-expanded', 'false');
}

function toggleUserPopover() {
  const bar = $('userBar');
  const trigger = $('userAvatar');
  if (!bar) return;
  if (typeof closeAllDropdowns === 'function') closeAllDropdowns();
  const isOpen = bar.style.display === 'flex';
  bar.style.display = isOpen ? 'none' : 'flex';
  if (trigger) trigger.setAttribute('aria-expanded', String(!isOpen));
}

function setAvatarVisual(content, isHtml) {
  [$('userAvatar'), $('userPopoverAvatar')].forEach(el => {
    if (!el) return;
    if (isHtml) el.innerHTML = content;
    else el.textContent = content;
  });
}

$('userAvatar')?.addEventListener('click', e => {
  e.stopPropagation();
  toggleUserPopover();
});

document.addEventListener('click', e => {
  const bar = $('userBar');
  const widget = $('topUserWidget');
  if (bar && bar.style.display === 'flex' && widget && !widget.contains(e.target)) {
    closeUserPopover();
  }
});

$('logoutBtn').addEventListener('click', () => {
  closeUserPopover();
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

$('syncBar')?.addEventListener('click', () => {
  if (!currentUser || !FB_ON) {
    if (FB_ON) showAuthScreen();
    else showToast('Modo offline ativo.', true);
    return;
  }
  showToast('Sincronizando conta com a nuvem...', '✓');
  checkAndSyncCloud();
});

$('syncNowMenuBtn')?.addEventListener('click', () => {
  closeUserPopover();
  if (!currentUser || !FB_ON) {
    if (FB_ON) showAuthScreen();
    else showToast('Modo offline ativo.', true);
    return;
  }
  showToast('Sincronizando conta com a nuvem...', '✓');
  checkAndSyncCloud();
});

$('settingsMenuBtn')?.addEventListener('click', () => {
  closeUserPopover();
  openSettings();
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

$('userPopoverAvatar')?.addEventListener('click', () => { closeUserPopover(); avatarInput.click(); });
$('changeAvatarBtn')?.addEventListener('click', () => { closeUserPopover(); avatarInput.click(); });

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
      setAvatarVisual('<img src="' + base64 + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">', true);

      if (currentUser && FB_ON) {
        db.collection('users').doc(currentUser.uid).set({ avatar: base64 }, { merge: true });
      }
      toast('Foto de perfil atualizada!', '✓');
    };
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
});
function updateUserBar() {
  const widget = $('topUserWidget');
  const lBtn = $('logoutBtn');
  const syncMenuBtn = $('syncNowMenuBtn');
  if (currentUser && !currentUser.isAnonymous) {
    if (widget) widget.style.display = 'flex';
    const email = currentUser.email || '';
    $('userEmail').textContent = email;
    const savedAvatar = localStorage.getItem('userAvatarBase64');
    if (savedAvatar) setAvatarVisual('<img src="' + savedAvatar + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">', true);
    else setAvatarVisual((email[0] || '?').toUpperCase(), false);
    $('userMode').textContent = FB_ON ? 'Sincronizado na nuvem' : 'Modo local';
    if (syncMenuBtn) syncMenuBtn.style.display = '';
    if (lBtn) {
      lBtn.title = 'Sair da conta';
      lBtn.classList.add('danger');
      lBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg><span id="logoutBtnLabel">Sair da conta</span>';
    }
    setSyncStatus('synced');
  } else if (currentUser === null) {
    if (widget) widget.style.display = 'flex';
    $('userEmail').textContent = 'Modo offline';
    setAvatarVisual('<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>', true);
    $('userMode').textContent = 'Entrar para sincronizar';
    if (syncMenuBtn) syncMenuBtn.style.display = 'none';
    if (lBtn) {
      lBtn.title = 'Fazer Login / Conectar';
      lBtn.classList.remove('danger');
      lBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg><span id="logoutBtnLabel">Entrar / Criar conta</span>';
    }
    setSyncStatus('offline');
  } else {
    if (widget) widget.style.display = 'none';
    closeUserPopover();
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
    const titleMatch = !!day.title && fuzzyMatch(day.title, cleanQ);
    const contentMatch = fuzzyMatch(content, cleanQ);
    const checkMatch = fuzzyMatch(checklistTexts, cleanQ);

    if (dateMatch || tagMatch || titleMatch || contentMatch || checkMatch) {
      let score = 1;
      if (dateMatch) score += 3;
      if (titleMatch) score += 3;
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

  let html = [...all].sort((a, b) => a.localeCompare(b)).map(t => {
    const ac = activeTagFilter === t ? ' active' : '';
    return `<button type="button" class="tag-filter-chip${ac}" data-tag="${esc(t)}">#${esc(t)}</button>`;
  }).join('');

  if (activeTagFilter) {
    html += `<button type="button" class="tag-filter-clear" id="tagFilterClearBtn" title="Limpar filtro de tag">&#x00D7; Limpar</button>`;
  }

  bar.innerHTML = html;

  bar.querySelectorAll('.tag-filter-chip').forEach(el => {
    el.addEventListener('click', () => {
      activeTagFilter = activeTagFilter === el.dataset.tag ? null : el.dataset.tag;
      renderTagFilterBar();
      renderSidebar($('searchInput').value);
      if (activeTagFilter) setSidebarView('all');
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
  const countBadge = $('notesCountBadge');
  if (countBadge) {
    countBadge.textContent = results.length > 0 ? results.length : '0';
    countBadge.title = `${results.length} anotação(ões)`;
  }
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

    const dayTags = Array.isArray(d.tags) ? d.tags : [];
    const chips = dayTags.slice(0, 2).map(t => `<span class="day-tag-chip" data-tag="${esc(t)}">#${esc(t)}</span>`).join('');
    const titleText = (d.title || '').trim();
    if (titleText) preview = titleText;

    let metaIcon = '';
    if (d.checklist && d.checklist.length > 0) {
      const doneCount = d.checklist.filter(x => x.done).length;
      metaIcon = `<svg class="meta-icon" width="10.5" height="10.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" title="${doneCount}/${d.checklist.length} tarefas"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`;
    } else if (/<(img|svg)\b/i.test(c) || (d.images && d.images.length > 0)) {
      metaIcon = `<svg class="meta-icon" width="10.5" height="10.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" title="Imagem anexada"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
    }

    return `<div class="day-item${ac}${hc}" data-key="${k}" tabindex="0">
      <div class="day-dot"></div>
      <div class="day-item-info">
        <div class="day-item-date">${esc(fmtShort(k))}</div>
        <div class="day-item-meta">${chips}${metaIcon}<span class="day-item-preview">${esc(preview)}</span></div>
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

/* ────── Quick Search / Command Palette (Ctrl+K / /) ────── */
let quickSearchSelectedIdx = 0;
let quickSearchResultsList = [];
let quickSearchNavItems = [];

const QUICK_COMMANDS = [
  {
    id: 'cmd-new',
    title: 'Nova Anotação',
    desc: 'Criar ou abrir anotação para qualquer data',
    shortcut: 'Alt+N',
    icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 5v14M5 12h14"/></svg>',
    keywords: 'nova anotacao criar page data novo adicionar',
    run: () => { pickDateModal(); }
  },
  {
    id: 'cmd-today',
    title: 'Ir para Anotação de Hoje',
    desc: 'Abrir a página do dia atual',
    shortcut: 'Hoje',
    icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    keywords: 'hoje today agora data diario',
    run: () => { openTab(todayKey()); }
  },
  {
    id: 'cmd-theme',
    title: 'Alternar Tema Claro / Escuro',
    desc: 'Alternar entre tema dark minimalista e light',
    shortcut: 'Tema',
    icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>',
    keywords: 'tema dark light escuro claro modo aparencia',
    run: () => { toggleTheme(); }
  },
  {
    id: 'cmd-spotify',
    title: 'Música do Dia (Spotify)',
    desc: 'Abrir player ou ver a trilha musical de hoje',
    shortcut: 'Música',
    icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>',
    keywords: 'spotify musica player som faixa track som trilha',
    run: () => { openSpotifyModal(); }
  },
  {
    id: 'cmd-backup',
    title: 'Fazer Backup (Exportar JSON)',
    desc: 'Download de segurança com todas as suas anotações',
    shortcut: 'Backup',
    icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    keywords: 'backup exportar json dados salvar download copia seguranca',
    run: () => { doBackup(); }
  },
  {
    id: 'cmd-settings',
    title: 'Configurações',
    desc: 'Conta, atalhos, IA e preferências do sistema',
    shortcut: 'Ajustes',
    icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    keywords: 'configuracoes settings ajustes conta perfil atalhos ia sincronizacao',
    run: () => { openSettings(); }
  }
];

function highlightQuery(text, query) {
  if (!query || !text) return esc(text);
  const q = normalizeStr(query.trim());
  if (!q) return esc(text);
  const raw = String(text);
  const norm = normalizeStr(raw);
  const idx = norm.indexOf(q);
  if (idx === -1) return esc(raw);
  const before = raw.slice(0, idx);
  const match = raw.slice(idx, idx + q.length);
  const after = raw.slice(idx + q.length);
  return `${esc(before)}<mark class="quicksearch-highlight">${esc(match)}</mark>${esc(after)}`;
}

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

  const rawQ = (query || '').trim();
  const cleanQ = rawQ.startsWith('#') ? rawQ.slice(1) : rawQ;
  quickSearchNavItems = [];

  // 1. Notas encontradas via fuzzy search
  const noteResults = fuzzySearchNotes(rawQ, null);
  quickSearchResultsList = noteResults;

  // 2. Comandos correspondentes
  let matchedCmds = [];
  if (!rawQ) {
    matchedCmds = QUICK_COMMANDS.slice(0, 4);
  } else {
    matchedCmds = QUICK_COMMANDS.filter(cmd => {
      return fuzzyMatch(cmd.title, cleanQ) || fuzzyMatch(cmd.keywords, cleanQ);
    });
  }

  // 3. Tags correspondentes
  const allTagsMap = {};
  Object.values(loadLocal()).forEach(d => {
    (d.tags || []).forEach(t => {
      allTagsMap[t] = (allTagsMap[t] || 0) + 1;
    });
  });
  let matchedTags = [];
  if (cleanQ) {
    matchedTags = Object.keys(allTagsMap)
      .filter(t => fuzzyMatch(t, cleanQ))
      .map(t => ({ tag: t, count: allTagsMap[t] }));
  }

  if (!noteResults.length && !matchedCmds.length && !matchedTags.length) {
    container.innerHTML = `<div class="quicksearch-empty">Nenhum resultado encontrado para "<b>${esc(rawQ)}</b>"</div>`;
    return;
  }

  let html = '';
  let globalIdx = 0;

  // Bloco: Tags Encontradas
  if (matchedTags.length) {
    html += `<div class="quicksearch-group-title">Tags</div>`;
    matchedTags.slice(0, 4).forEach(item => {
      const idx = globalIdx++;
      const isAct = idx === quickSearchSelectedIdx ? ' active' : '';
      const c = getTagColors(item.tag);
      quickSearchNavItems.push({
        type: 'tag',
        tag: item.tag,
        run: () => {
          activeTagFilter = item.tag;
          renderTagFilterBar();
          renderSidebar('');
          closeQuickSearch();
        }
      });
      html += `<div class="quicksearch-item quicksearch-tag-item${isAct}" data-idx="${idx}">
        <div class="quicksearch-tag-left">
          <span class="day-tag-chip" style="background:${c.bg}; color:${c.text}; border-color:${c.border};">#${highlightQuery(item.tag, cleanQ)}</span>
        </div>
        <span class="quicksearch-tag-count">${item.count} anotação(ões)</span>
      </div>`;
    });
  }

  // Bloco: Anotações
  if (noteResults.length) {
    const groupLabel = rawQ ? 'Anotações Encontradas' : 'Anotações Recentes';
    html += `<div class="quicksearch-group-title">${groupLabel}</div>`;
    const sliceCount = rawQ ? 8 : 5;
    noteResults.slice(0, sliceCount).forEach(item => {
      const idx = globalIdx++;
      const isAct = idx === quickSearchSelectedIdx ? ' active' : '';
      quickSearchNavItems.push({
        type: 'note',
        key: item.key,
        run: () => {
          openTab(item.key);
          closeQuickSearch();
        }
      });

      const tags = (item.day.tags || []).slice(0, 3).map(t => {
        const c = getTagColors(t);
        return `<span class="day-tag-chip" style="background:${c.bg}; color:${c.text}; border-color:${c.border}; font-size:10px;">#${esc(t)}</span>`;
      }).join('');

      html += `<div class="quicksearch-item quicksearch-note-item${isAct}" data-idx="${idx}" data-key="${item.key}">
        <div class="quicksearch-item-top">
          <div class="quicksearch-item-date">
            <svg class="quicksearch-item-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            <span>${highlightQuery(fmtFull(item.key), cleanQ)}</span>
          </div>
          <div class="quicksearch-item-tags">${tags}</div>
        </div>
        <div class="quicksearch-item-preview">${highlightQuery(item.preview, cleanQ)}</div>
      </div>`;
    });
  }

  // Bloco: Ações Rápidas / Comandos
  if (matchedCmds.length) {
    html += `<div class="quicksearch-group-title">Ações Rápidas</div>`;
    matchedCmds.forEach(cmd => {
      const idx = globalIdx++;
      const isAct = idx === quickSearchSelectedIdx ? ' active' : '';
      quickSearchNavItems.push({
        type: 'command',
        run: () => {
          closeQuickSearch();
          cmd.run();
        }
      });
      html += `<div class="quicksearch-item quicksearch-cmd-item${isAct}" data-idx="${idx}">
        <div class="quicksearch-cmd-left">
          <div class="quicksearch-cmd-icon">${cmd.icon}</div>
          <div class="quicksearch-cmd-info">
            <div class="quicksearch-cmd-title">${highlightQuery(cmd.title, cleanQ)}</div>
            <div class="quicksearch-cmd-desc">${esc(cmd.desc)}</div>
          </div>
        </div>
        <kbd class="quicksearch-cmd-shortcut">${esc(cmd.shortcut)}</kbd>
      </div>`;
    });
  }

  container.innerHTML = html;

  if (quickSearchSelectedIdx >= quickSearchNavItems.length) {
    quickSearchSelectedIdx = 0;
  }
  const allRendered = container.querySelectorAll('.quicksearch-item');
  allRendered.forEach((el, i) => {
    el.classList.toggle('active', i === quickSearchSelectedIdx);
  });

  container.querySelectorAll('.quicksearch-item').forEach(el => {
    el.addEventListener('click', () => {
      const i = parseInt(el.dataset.idx, 10);
      if (quickSearchNavItems[i]) {
        quickSearchNavItems[i].run();
      }
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
      if (quickSearchNavItems[quickSearchSelectedIdx]) {
        quickSearchNavItems[quickSearchSelectedIdx].run();
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
  if (window.innerWidth <= 768 && location.hash !== '#menu') {
    try { history.pushState({ sidebar: true }, '', '#menu'); } catch (_) {}
  }
}
function closeSidebar() {
  $('sidebar').classList.remove('open');
  $('sidebarBackdrop').classList.remove('show');
  $('bnNotes')?.classList.remove('active');
  if (window.innerWidth <= 768 && location.hash === '#menu') {
    try { history.back(); } catch (_) {}
  }
}
window.addEventListener('popstate', () => {
  if (window.innerWidth <= 768) {
    if (location.hash !== '#menu' && $('sidebar').classList.contains('open')) {
      $('sidebar').classList.remove('open');
      $('sidebarBackdrop').classList.remove('show');
    }
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

$('collapseSidebarBtn')?.addEventListener('click', () => {
  $('sidebar').classList.add('collapsed');
});
$('sidebarBackdrop').addEventListener('click', closeSidebar);
$('daysList').addEventListener('click', () => { if (window.innerWidth <= 768) closeSidebar(); });
$('newDayBtn').addEventListener('click', () => { if (window.innerWidth <= 768) closeSidebar(); pickDateModal(); });

// Calendário: sempre visível no layout minimalista (antigo accordion removido)
$('searchKbdBadge')?.addEventListener('click', () => {
  openQuickSearch();
});

/* ────── Navegação da sidebar (Hoje / Todas as anotações) ────── */
const SK_SIDEBAR_VIEW = 'personalmk_sidebar_view';
let sidebarView = 'home';
try { if (localStorage.getItem(SK_SIDEBAR_VIEW) === 'all') sidebarView = 'all'; } catch (_) {}

function setSidebarView(view) {
  sidebarView = view === 'all' ? 'all' : 'home';
  try { localStorage.setItem(SK_SIDEBAR_VIEW, sidebarView); } catch (_) {}
  updateNavState();
}

function updateNavState() {
  const body = $('sidebarBody');
  if (body) body.dataset.view = sidebarView;
  $('navHomeBtn')?.classList.toggle('active', sidebarView === 'home');
  $('navAllBtn')?.classList.toggle('active', sidebarView === 'all');
  $('bnToday')?.classList.toggle('active', !!activeTab && activeTab === todayKey());
  $('bnNotes')?.classList.toggle('active', $('sidebar')?.classList.contains('open') && sidebarView === 'all');
}

$('navHomeBtn')?.addEventListener('click', () => {
  setSidebarView('home');
  if ($('searchInput').value) { $('searchInput').value = ''; renderSidebar(''); }
  createOrOpen(todayKey());
  if (window.innerWidth <= 768) closeSidebar();
});
$('navAllBtn')?.addEventListener('click', () => setSidebarView('all'));

function fmtEdited(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return `Editado hoje às ${time}`;
  return `Editado em ${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} às ${time}`;
}

function fmtEyebrow(k) {
  const d = keyToDate(k);
  const wd = d.toLocaleDateString('pt-BR', { weekday: 'long' });
  const mon = d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
  return `${wd} · ${d.getDate()} ${mon} ${d.getFullYear()}`;
}

/* ────── Tabs ────── */
let openTabs = [], activeTab = null;
function lastTabKey() { return currentUser ? `${SK}_last_tab_${currentUser.uid}` : `${SK}_last_tab`; }
function openTabsKey() { return currentUser ? `${SK}_open_tabs_${currentUser.uid}` : `${SK}_open_tabs`; }
function saveTabState() {
  try {
    if (activeTab) localStorage.setItem(lastTabKey(), activeTab);
    else localStorage.removeItem(lastTabKey());
    localStorage.setItem(openTabsKey(), JSON.stringify(openTabs));
  } catch (_) {}
}

function renderTabs() {
  const bar = $('tabsBar');
  if (!bar) return;
  bar.querySelectorAll('.tab').forEach(t => t.remove());
  openTabs.forEach(k => {
    const ac = k === activeTab ? ' active' : '';
    const tab = document.createElement('div');
    tab.className = `tab${ac}`; tab.dataset.key = k; tab.tabIndex = 0;
    tab.innerHTML = `<span>${esc(fmtTab(k))}</span><span class="tab-close" data-close="${k}">&#x00D7;</span>`;
    tab.addEventListener('click', e => { if (e.target.closest('.tab-close')) return; activateTab(k); });
    tab.querySelector('.tab-close').addEventListener('click', e => { e.stopPropagation(); closeTab(k); });
    bar.appendChild(tab);
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
  saveTabState();
  renderTabs(); renderSidebar($('searchInput').value); renderCalendar(); showEditor(key);
  updateNavState();
}
function closeTab(key) {
  openTabs = openTabs.filter(k => k !== key);
  if (activeTab === key) activeTab = openTabs[openTabs.length - 1] || null;
  saveTabState();
  renderTabs();
  if (activeTab) { renderSidebar($('searchInput').value); showEditor(activeTab); }
  else { showWelcome(); renderSidebar($('searchInput').value); }
  renderCalendar();
  updateNavState();
}
function showWelcome() { 
  $('welcome').style.display = 'flex'; 
  $('editorPane').style.display = 'none'; 
  document.body.classList.add('no-note');
  hideFloatingToolbar();
  if ($('mobileHeaderTitle')) $('mobileHeaderTitle').textContent = 'PersonalMk';
}

let currentTags = [];
let currentChecklist = [];

function showEditor(key) {
  $('welcome').style.display = 'none'; $('editorPane').style.display = 'flex';
  document.body.classList.remove('no-note');
  hideFloatingToolbar();
  const day = localGetDay(key);
  $('editor').innerHTML = day.content || '';
  $('currentDayTitle').textContent = fmtEyebrow(key);
  $('currentDayTitle').title = fmtFull(key);
  if ($('noteTitle')) $('noteTitle').value = day.title || '';
  if ($('mobileHeaderTitle')) $('mobileHeaderTitle').textContent = 'PersonalMk';
  checkTimeCapsule(key);
  $('currentDaySubtitle').textContent = day.updatedAt ? fmtEdited(day.updatedAt) : 'Nova anotação';
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
    if (!day.title && isContentEmpty(day.content) && $('noteTitle')) $('noteTitle').focus();
    else $('editor').focus();
  }
}
function setSave(s) {
  const el = $('saveStatus');
  if (!el) return;
  el.className = 'save-status-badge ' + (s === 'saved' ? 'saved' : 'saving');
  const icon = $('saveStatusIcon');
  if (s === 'saved') {
    $('saveStatusText').textContent = 'Salvo';
    if (icon) icon.innerHTML = '<polyline points="20 6 9 17 4 12"></polyline>';
  } else {
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
  const titleVal = $('noteTitle') ? $('noteTitle').value.trim() : undefined;
  try {
    await setDay(activeTab, $('editor').innerHTML, currentTags, day.images, currentChecklist, titleVal);
  } catch (error) {
    console.error('Falha ao salvar a anotação:', error);
    setSave('saving');
    return;
  }
  setSave('saved'); renderSidebar($('searchInput').value); renderTagFilterBar(); renderCalendar();
  $('currentDaySubtitle').textContent = fmtEdited(new Date().toISOString());
}
const doSave = debounce(saveCurrent, 700);
window.addEventListener('beforeunload', () => {
  if (activeTab && !isApplyingRemoteChange) saveCurrent();
});

/* Título da anotação: Enter pula para o editor */
$('noteTitle')?.addEventListener('input', () => { setSave('saving'); doSave(); });
$('noteTitle')?.addEventListener('keydown', e => {
  if (e.key === 'Enter' || (e.key === 'ArrowDown' && !e.shiftKey)) {
    e.preventDefault();
    const ed = $('editor');
    ed.focus();
    const r = document.createRange();
    r.selectNodeContents(ed);
    r.collapse(true);
    const s = window.getSelection();
    s.removeAllRanges(); s.addRange(r);
  }
});

/* Clicar no espaço vazio abaixo do texto foca o editor no final */
$('editorWrap')?.addEventListener('mousedown', e => {
  if (e.target !== $('editorWrap')) return;
  e.preventDefault();
  const ed = $('editor');
  ed.focus();
  const r = document.createRange();
  r.selectNodeContents(ed);
  r.collapse(false);
  const s = window.getSelection();
  s.removeAllRanges(); s.addRange(r);
});

function fmtCalcNum(n) {
  if (!isFinite(n)) return '';
  if (Object.is(n, -0)) return '0';
  if (Math.abs(n) >= 1e15 || (n !== 0 && Math.abs(n) < 1e-10)) {
    return String(Number(n.toPrecision(12)));
  }
  return String(Number(n.toFixed(10)));
}

function evalMathExpr(rawExpr) {
  try {
    let s = String(rawExpr || '').trim();
    if (!s) return null;

    // 1. Vírgula decimal entre dígitos -> marcador temporário
    s = s.replace(/(\d),(\d)/g, '$1__DEC__$2');
    // 2. Ponto "." somente entre números/parênteses -> multiplicação
    s = s.replace(/(\d|\))\s*\.\s*(?=\s*(?:\d|\())/g, '$1 __MUL__ ');
    // 3. x, X ou × entre números/parênteses -> multiplicação
    s = s.replace(/(\d|\))\s*[xX×]\s*(?=[+\-−–]?\s*(?:\d|\(|√))/g, '$1 __MUL__ ');
    // 4. Potenciação (*, ** ou ^)
    s = s.replace(/\*{1,2}|\^/g, '**');
    // 5. Restaura multiplicação e vírgula decimal
    s = s.replace(/__MUL__/g, '*').replace(/__DEC__/g, '.');
    // 6. Divisão (/ ou \ ou ÷) e subtração (− ou –)
    s = s.replace(/[\\÷]/g, '/').replace(/[−–]/g, '-');
    // 7. Raiz quadrada: √(expr) ou √num
    s = s.replace(/√\s*\(([^)]+)\)/g, 'Math.sqrt($1)').replace(/√\s*(\d+(?:\.\d+)?)/g, 'Math.sqrt($1)');
    // 8. Porcentagem: a + b% -> (a + (a * b / 100)) e b% -> (b / 100)
    s = s.replace(/(\d+(?:\.\d+)?)\s*([+\-])\s*(\d+(?:\.\d+)?)%/g, '($1 $2 ($1 * $3 / 100))');
    s = s.replace(/(\d+(?:\.\d+)?)%/g, '($1 / 100)');
    // Previne ++ ou -- inválido em sequência
    s = s.replace(/--/g, '- -').replace(/\+\+/g, '+ +');

    const safeCheck = s.replace(/Math\.sqrt\(/g, '(');
    if (!/^[0-9+\-*/().\s]+$/.test(safeCheck)) return null;

    const res = new Function('return (' + s + ')')();
    return (typeof res === 'number' && isFinite(res)) ? res : null;
  } catch (e) {
    return null;
  }
}

let lastCalcNode = null;
let lastCalcTextLen = 0;

function handleCalculator(e) {
  const sel = window.getSelection();
  const node = (sel && sel.rangeCount && sel.isCollapsed) ? sel.focusNode : null;
  const isTextNode = !!(node && node.nodeType === Node.TEXT_NODE);
  const text = isTextNode ? (node.textContent || '') : '';
  const shrank = isTextNode && node === lastCalcNode && text.length < lastCalcTextLen;

  if (isTextNode) {
    lastCalcNode = node;
    lastCalcTextLen = text.length;
  }

  // Não recalcular ao apagar (Backspace/Delete ou redução no teclado móvel), desfazer ou colar/quebrar linha
  if (shrank) return;
  if (e && e.inputType) {
    if (e.inputType.startsWith('delete') ||
        e.inputType.startsWith('history') ||
        e.inputType === 'insertFromPaste' ||
        e.inputType === 'insertParagraph' ||
        e.inputType === 'insertLineBreak') {
      return;
    }
  }
  if (e && typeof e.data === 'string' && !e.data.includes('=')) {
    return;
  }
  if (!isTextNode) return;

  const caretPos = sel.focusOffset;
  const beforeCaret = text.slice(0, caretPos);
  const afterCaret = text.slice(caretPos);

  if (!beforeCaret.endsWith('=')) return;
  if (afterCaret.length > 0 && !/^[\s\u00A0]/.test(afterCaret)) return;

  let resultText = null;

  // 1. Comparações (<, >, <>, <=, >=)
  const cmpMatch = beforeCaret.match(/(?:^|[^\w<>])((?:√\s*\(\s*|√\s*|\(\s*|[+\-−–](?=\d|√|\())*\d[\d.,\s+\-−–xX×*\/\\÷^%()√]*?)\s*(<>|<=|>=|<|>)\s*((?:√\s*\(\s*|√\s*|\(\s*|[+\-−–](?=\d|√|\())*\d[\d.,\s+\-−–xX×*\/\\÷^%()√]*?)\s*=$/);
  if (cmpMatch) {
    const a = evalMathExpr(cmpMatch[1]);
    const op = cmpMatch[2];
    const b = evalMathExpr(cmpMatch[3]);
    if (a !== null && b !== null) {
      const fa = fmtCalcNum(a);
      const fb = fmtCalcNum(b);
      let relText;
      if (a < b) relText = `${fa} é menor que ${fb}`;
      else if (a > b) relText = `${fa} é maior que ${fb}`;
      else relText = `${fa} é igual a ${fb}`;

      if (op === '<>') resultText = relText;
      else if (op === '<') resultText = a < b ? relText : `Falso (${relText})`;
      else if (op === '>') resultText = a > b ? relText : `Falso (${relText})`;
      else if (op === '<=') resultText = a <= b ? relText : `Falso (${relText})`;
      else if (op === '>=') resultText = a >= b ? relText : `Falso (${relText})`;
    }
  }

  // 2. Expressões aritméticas
  if (resultText === null) {
    const mathMatch = beforeCaret.match(/(?:^|[^\w/\\:])((?:√\s*\(\s*|√\s*|\(\s*|[+\-−–](?=\d|√|\())*\d[\d.,\s+\-−–xX×*\/\\÷^%()√]*)=$/);
    if (mathMatch) {
      const exprRaw = mathMatch[1];
      const hasOp = /[+\-−–xX×*\/\\÷^%√]|\d\s*\.\s*\d/.test(exprRaw);
      if (hasOp) {
        const res = evalMathExpr(exprRaw);
        if (res !== null) resultText = fmtCalcNum(res);
      }
    }
  }

  if (resultText !== null) {
    const replaced = beforeCaret + ' ' + resultText + afterCaret;
    node.textContent = replaced;
    lastCalcNode = node;
    lastCalcTextLen = replaced.length;
    const newPos = beforeCaret.length + 1 + resultText.length;
    const range = document.createRange();
    range.setStart(node, newPos);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

$('editor').addEventListener('input', e => { handleCalculator(e); setSave('saving'); updateWC(); doSave(); });

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

/* ────── Histórico de conflitos ────── */
function showConflictHistory() {
  let history;
  try {
    history = JSON.parse(localStorage.getItem(localKey() + '_conflicts') || '[]');
    if (!Array.isArray(history)) throw new Error('Formato inválido');
  } catch (error) {
    console.error('Erro ao ler histórico de conflitos:', error);
    showToast('Não foi possível abrir o histórico.', true);
    return;
  }
  if (!history.length) {
    showToast('Nenhuma versão conflitante salva neste dispositivo.');
    return;
  }
  const extra = '<div id="conflictHistoryList" style="max-height:50vh;overflow:auto;text-align:left"></div>';
  openModal({
    title: 'Versões recuperáveis',
    body: `${history.length} versão(ões) guardada(s) neste navegador. Antes de restaurar, o app exportará um backup do estado atual.`,
    extra,
    actions: [{ label: 'Fechar', cls: 'btn-cancel' }]
  });
  const list = $('conflictHistoryList');
  history.slice().reverse().forEach((entry, index) => {
    if (!entry || !entry.day || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(entry.key || '')) return;
    const row = document.createElement('div');
    row.style.cssText = 'padding:10px 0;border-bottom:1px solid var(--border, #7774)';
    const label = document.createElement('div');
    const date = entry.savedAt && !Number.isNaN(Date.parse(entry.savedAt))
      ? new Date(entry.savedAt).toLocaleString('pt-BR') : 'Data desconhecida';
    label.textContent = `${entry.key} — preservada em ${date}`;
    const preview = document.createElement('div');
    preview.style.cssText = 'opacity:.7;font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere';
    preview.textContent = (entry.day.title || '') + ' ' + toPlain(entry.day.content || '').slice(0, 140);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn-secondary';
    button.textContent = 'Restaurar esta versão';
    button.addEventListener('click', () => {
      if (!window.confirm(`Restaurar a versão de ${entry.key}? O estado atual será exportado primeiro.`)) return;
      try {
        const before = loadLocal();
        downloadDaysBackup(before, 'agenda_antes_recuperacao');
        const restored = { ...entry.day, updatedAt: new Date().toISOString() };
        saveLocal({ ...before, [entry.key]: restored });
        closeModal();
        refreshAll();
        // O envio para a nuvem fica a cargo do fluxo de sincronização existente.
        if (currentUser && FB_ON) checkAndSyncCloud();
        showToast('Versão recuperada. Confira a anotação e guarde o backup.');
      } catch (error) {
        console.error('Falha ao recuperar versão:', error);
        showToast('Recuperação falhou; não descarte o backup.', true);
      }
    });
    row.append(label, preview, button);
    list.appendChild(row);
  });
}
function installConflictHistoryButton() {
  const anchor = $('settingsRestoreBtn');
  if (!anchor || $('settingsConflictHistoryBtn')) return;
  const button = document.createElement('button');
  button.id = 'settingsConflictHistoryBtn';
  button.type = 'button';
  button.className = anchor.className;
  button.textContent = 'Histórico de versões conflitantes';
  button.addEventListener('click', () => {
    closeSettings();
    showConflictHistory();
  });
  anchor.insertAdjacentElement('afterend', button);
}
installConflictHistoryButton();

/* ────── Backup / Restore ────── */
function downloadDaysBackup(days, prefix = 'agenda_backup') {
  let conflicts = [];
  try {
    const saved = JSON.parse(localStorage.getItem(localKey() + '_conflicts') || '[]');
    if (Array.isArray(saved)) conflicts = saved;
  } catch (error) {
    console.warn('Histórico de conflitos indisponível para exportação:', error);
  }
  const json = JSON.stringify({ version: 3, exportedAt: new Date().toISOString(), days, conflicts }, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${prefix}_${todayKey()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function doBackup() {
  downloadDaysBackup(loadLocal());
  toast('Backup exportado!', '');
}
function doRestore() { $('restoreFileInput').click(); }
function validBackupDays(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Estrutura inválida');
  const entries = Object.entries(value);
  if (!entries.length) throw new Error('Backup sem anotações');
  const prepared = {};
  for (const [key, day] of entries) {
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(key) || !day || typeof day !== 'object' || Array.isArray(day)) {
      throw new Error('Data ou anotação inválida');
    }
    if (day.content != null && typeof day.content !== 'string') throw new Error('Conteúdo inválido');
    for (const field of ['tags', 'images', 'checklist']) {
      if (day[field] != null && !Array.isArray(day[field])) throw new Error('Campo inválido: ' + field);
    }
    prepared[key] = {
      content: day.content || '',
      title: typeof day.title === 'string' ? day.title : '',
      tags: day.tags || [],
      images: day.images || [],
      checklist: day.checklist || [],
      updatedAt: day.updatedAt && !Number.isNaN(Date.parse(day.updatedAt)) ? day.updatedAt : new Date().toISOString()
    };
  }
  return prepared;
}
$('backupBtn').addEventListener('click', doBackup);
$('restoreBtn').addEventListener('click', doRestore);
$('restoreFileInput').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const parsed = JSON.parse(ev.target.result);
      if (parsed.version != null && parsed.version !== 3) throw new Error('Versão de backup não suportada');
      const imported = validBackupDays(parsed.days || parsed);
      const count = Object.keys(imported).length;
      const existing = loadLocal();
      const overlaps = Object.keys(imported).filter(k => existing[k]).length;
      openModal({
        title: 'Importar backup com segurança',
        body: `${count} dias encontrados; ${overlaps} já existem neste dispositivo. A importação fará um backup dos dados atuais antes de alterar qualquer anotação. Nenhuma nota será apagada automaticamente.`,
        actions: [
          { label: 'Cancelar', cls: 'btn-cancel' },
          {
            label: 'Mesclar (manter demais)', cls: 'btn-secondary', cb: () => {
              try {
                downloadDaysBackup(existing, 'agenda_antes_importacao');
                const now = Date.now();
                const prepared = {};
                Object.entries(imported).forEach(([key, day], index) => {
                  // A escolha explícita de importar prevalece sobre cópias antigas na nuvem.
                  prepared[key] = { ...day, updatedAt: new Date(now + index).toISOString() };
                });
                saveLocal({ ...existing, ...prepared });
                refreshAll();
                showToast(`${count} dias importados localmente. Confira os dados antes de sincronizar.`);
              } catch (err) {
                console.error('Erro ao importar backup:', err);
                showToast('Não foi possível importar. Os dados anteriores foram preservados.', true);
              }
            }
          }
        ]
      });
    } catch (err) {
      console.warn('Backup rejeitado:', err);
      showToast('Arquivo de backup inválido ou incompatível.', true);
    }
  };
  reader.onerror = () => showToast('Não foi possível ler o arquivo.', true);
  reader.readAsText(file);
  e.target.value = '';
});

/* ────── Search ────── */
$('searchInput').addEventListener('input', () => {
  const v = $('searchInput').value;
  if (v.trim() && sidebarView !== 'all') setSidebarView('all');
  renderSidebar(v);
});

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

  // 5. Escape: Fechar modais/popovers abertos
  if (e.key === 'Escape') {
    if ($('userBar') && $('userBar').style.display === 'flex') {
      closeUserPopover();
    } else if ($('quicksearch-overlay') && $('quicksearch-overlay').classList.contains('show')) {
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
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined' || !indexedDB) return resolve();
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => {
        try {
          idbDB = e.target.result;
          if (!idbDB.objectStoreNames.contains(STORE_NAME)) idbDB.createObjectStore(STORE_NAME);
        } catch (_) {}
      };
      req.onsuccess = e => { idbDB = e.target.result; resolve(); };
      req.onerror = () => resolve();
    } catch (e) {
      resolve();
    }
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

/* ────── UI Tabs (Texto / Tarefas / Galeria) ────── */
const VIEW_LABELS = { text: 'Texto', checklist: 'Tarefas', gallery: 'Galeria' };
function switchInnerTab(tab) {
  $('tabText').classList.toggle('active', tab === 'text');
  $('tabChecklist').classList.toggle('active', tab === 'checklist');
  $('tabGallery').classList.toggle('active', tab === 'gallery');
  if ($('viewSwitchLabel')) $('viewSwitchLabel').textContent = VIEW_LABELS[tab] || 'Texto';
  closeAllDropdowns();
  hideFloatingToolbar();

  $('editorWrap').style.display = tab === 'text' ? 'block' : 'none';
  $('wordCount').style.display = tab === 'text' ? 'flex' : 'none';
  
  $('checklistPane').style.display = tab === 'checklist' ? 'flex' : 'none';
  
  $('galleryPane').style.display = tab === 'gallery' ? 'block' : 'none';
  
  if (tab === 'gallery') renderGallery();
  if (tab === 'checklist') renderChecklist();
}

/* ────── Menus suspensos genéricos ────── */
const DROPDOWNS = [
  ['noteMenuBtn', 'noteMenu'],
  ['sidebarMoreBtn', 'sidebarMoreMenu'],
  ['viewSwitchBtn', 'viewMenu'],
];
function closeAllDropdowns(except) {
  DROPDOWNS.forEach(([b, m]) => {
    if (m === except) return;
    const menu = $(m);
    if (menu) menu.hidden = true;
    $(b)?.setAttribute('aria-expanded', 'false');
  });
}
DROPDOWNS.forEach(([btnId, menuId]) => {
  const btn = $(btnId), menu = $(menuId);
  if (!btn || !menu) return;
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const willOpen = menu.hidden;
    closeAllDropdowns(menuId);
    if (typeof closeUserPopover === 'function') closeUserPopover();
    menu.hidden = !willOpen;
    btn.setAttribute('aria-expanded', String(willOpen));
  });
  menu.addEventListener('click', e => {
    if (e.target.closest('.dropdown-item')) menu.hidden = true;
  });
});
document.addEventListener('click', e => {
  if (!e.target.closest('.more-wrap')) closeAllDropdowns();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeAllDropdowns(); hideFloatingToolbar(); } });

$('noteMenuMusicBtn')?.addEventListener('click', () => openSpotifyModal());

/* ────── Barra de formatação flutuante (aparece ao selecionar texto) ────── */
function hideFloatingToolbar() {
  const tb = $('toolbar');
  if (tb) tb.classList.remove('visible');
}
function positionFloatingToolbar() {
  const tb = $('toolbar');
  const ed = $('editor');
  if (!tb || !ed) return;
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || sel.isCollapsed || !ed.contains(sel.anchorNode) || !ed.contains(sel.focusNode)) {
    hideFloatingToolbar();
    return;
  }
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0)) { hideFloatingToolbar(); return; }
  tb.classList.add('visible');
  const tbW = tb.offsetWidth, tbH = tb.offsetHeight;
  const isMobile = window.innerWidth <= 768;
  let left = rect.left + rect.width / 2 - tbW / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - tbW - 8));
  // No celular fica abaixo da seleção (o menu nativo do sistema aparece acima)
  let top = isMobile ? rect.bottom + 10 : rect.top - tbH - 8;
  if (!isMobile && top < 8) top = rect.bottom + 8;
  if (isMobile && top + tbH > window.innerHeight - 8) top = rect.top - tbH - 10;
  tb.style.left = `${Math.round(left)}px`;
  tb.style.top = `${Math.round(top)}px`;
}
let floatTbRaf = 0;
function scheduleFloatingToolbar() {
  cancelAnimationFrame(floatTbRaf);
  floatTbRaf = requestAnimationFrame(positionFloatingToolbar);
}
document.addEventListener('selectionchange', scheduleFloatingToolbar);
$('editor')?.addEventListener('mouseup', () => setTimeout(positionFloatingToolbar, 10));
$('editor')?.addEventListener('keyup', () => setTimeout(positionFloatingToolbar, 10));
$('editor')?.addEventListener('touchend', () => setTimeout(positionFloatingToolbar, 40));
$('toolbar')?.addEventListener('mousedown', e => e.preventDefault()); // mantém a seleção ao clicar nos botões
$('noteScroll')?.addEventListener('scroll', () => {
  if ($('toolbar')?.classList.contains('visible')) positionFloatingToolbar();
}, { passive: true });
window.addEventListener('resize', hideFloatingToolbar);

/* ────── Atalhos Markdown no editor ( "# ", "## ", "- ", "1. ", "> ", "[] " ) ────── */
function getCurrentBlock(node) {
  const ed = $('editor');
  let n = node;
  while (n && n !== ed && n.parentNode !== ed) n = n.parentNode;
  return n && n !== ed ? n : null;
}
$('editor').addEventListener('input', e => {
  if (!e || e.inputType !== 'insertText' || e.data !== ' ') return;
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !sel.isCollapsed) return;
  const node = sel.focusNode;
  if (!node || node.nodeType !== Node.TEXT_NODE) return;
  const before = node.textContent.slice(0, sel.focusOffset).replace(/\u00A0/g, ' ');
  const block = getCurrentBlock(node);
  // Só dispara no início do bloco (o texto antes do cursor no bloco é só o marcador)
  if (block && block.nodeType === Node.ELEMENT_NODE) {
    const blockText = (block.textContent || '').replace(/\u00A0/g, ' ');
    if (!blockText.startsWith(before)) return;
  }
  const map = { '# ': ['formatBlock', 'h1'], '## ': ['formatBlock', 'h2'], '### ': ['formatBlock', 'h3'], '- ': ['insertUnorderedList'], '* ': ['insertUnorderedList'], '1. ': ['insertOrderedList'], '> ': ['formatBlock', 'blockquote'] };
  const action = map[before];
  if (!action) return;
  const r = document.createRange();
  r.setStart(node, 0);
  r.setEnd(node, sel.focusOffset);
  r.deleteContents();
  document.execCommand(action[0], false, action[1] || null);
  setSave('saving'); doSave();
});

/* ────── Celular: avatar no cabeçalho, barra inferior e botão flutuante ────── */
const mqMobile = window.matchMedia('(max-width: 768px)');
function placeUserWidget() {
  const widget = $('topUserWidget');
  if (!widget) return;
  const target = mqMobile.matches ? $('mobileHeaderActions') : $('topbarActions');
  if (!target || widget.parentNode === target) return;
  if (mqMobile.matches) target.appendChild(widget);
  else target.insertBefore(widget, target.querySelector('.note-more'));
}
placeUserWidget();
if (mqMobile.addEventListener) mqMobile.addEventListener('change', placeUserWidget);
else if (mqMobile.addListener) mqMobile.addListener(placeUserWidget);

$('bnToday')?.addEventListener('click', () => { closeSidebar(); createOrOpen(todayKey()); });
$('bnNotes')?.addEventListener('click', () => { setSidebarView('all'); openSidebar(); updateNavState(); });
$('bnSearch')?.addEventListener('click', () => { closeSidebar(); openQuickSearch(); });
$('mobileFab')?.addEventListener('click', () => { closeSidebar(); pickDateModal(); });

// Esconde a barra inferior enquanto o usuário digita (teclado aberto)
document.addEventListener('focusin', e => {
  if (e.target.matches('#editor, #editor *, input, textarea')) document.body.classList.add('is-typing');
});
document.addEventListener('focusout', () => {
  setTimeout(() => {
    const a = document.activeElement;
    if (!a || !a.matches('#editor, #editor *, input, textarea')) document.body.classList.remove('is-typing');
  }, 50);
});

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
  if (document.hidden) {
    if (activeTab && !isApplyingRemoteChange) saveCurrent();
  } else {
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
  // If cloud user, start realtime sync and fetch data with safety timeout
  if (currentUser && FB_ON) {
    try {
      startRealtimeSync();
      await Promise.race([
        checkAndSyncCloud(),
        new Promise(res => setTimeout(res, 3500))
      ]);
    } catch (e) {
      console.warn('Cloud sync timeout/warning on init:', e);
    }
  }
  refreshAll();
  const today = todayKey();
  const data = loadLocal();

  try {
    const rawTabs = JSON.parse(localStorage.getItem(openTabsKey()) || '[]');
    if (Array.isArray(rawTabs)) {
      openTabs = rawTabs.filter(k => typeof k === 'string' && (data[k] || k === today));
    }
  } catch (_) {}

  let savedLastTab = null;
  try {
    savedLastTab = localStorage.getItem(lastTabKey());
  } catch (_) {}

  if (savedLastTab && data[savedLastTab] && (savedLastTab === today || hasRealContent(data[savedLastTab]))) {
    openTab(savedLastTab);
  } else if (data[today]) {
    openTab(today);
  } else if (allKeys().length > 0) {
    // Nunca pular automaticamente para notas futuras (ex: 2036); abre o dia de hoje
    openTab(today);
  } else {
    showWelcome();
  }

  if (activeTab) {
    const d = keyToDate(activeTab); calYear = d.getFullYear(); calMonth = d.getMonth(); renderCalendar();
  } else {
    const now = new Date(); calYear = now.getFullYear(); calMonth = now.getMonth(); renderCalendar();
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
  try { await spotifyHandleCallback(); } catch (e) { console.warn('Spotify callback warning:', e); }
  try { await initIDB(); } catch (e) { console.warn('IDB init warning:', e); }

  const mode = localStorage.getItem(SK_MODE);
  updateNavState();

  // Firebase auth listener: sempre ativo para sincronizar assim que a sessão da conta resolver
  if (FB_ON && auth) {
    auth.onAuthStateChanged(async user => {
      currentUser = user || null;
      if (isAuthInitializing) return;

      if (user) {
        localStorage.setItem(SK_MODE, 'online');
        hideAuthScreen();

        db.collection('users').doc(user.uid).get().then(doc => {
          if (doc.exists && doc.data().avatar) {
            localStorage.setItem('userAvatarBase64', doc.data().avatar);
            updateUserBar();
          }
        }).catch(err => console.warn('Avatar error:', err));

        if (initializedForKey !== user.uid) {
          initializedForKey = user.uid;
          openTabs = []; activeTab = null;
          await initApp();
        }
      } else {
        const currentMode = localStorage.getItem(SK_MODE);
        if (currentMode === 'offline') {
          hideAuthScreen();
          if (initializedForKey !== 'offline') {
            initializedForKey = 'offline';
            setSyncStatus('offline');
            updateUserBar();
            await initApp();
          }
        } else {
          initializedForKey = undefined;
          showAuthScreen();
        }
      }
    });
  }

  if (mode === 'offline' || !FB_ON) {
    hideAuthScreen();
    setSyncStatus('offline');
    updateUserBar();
    if (initializedForKey !== 'offline') {
      initializedForKey = 'offline';
      await initApp();
    }
  } else {
    // Show auth screen immediately so all buttons and tabs are interactive right away
    if (!currentUser) {
      showAuthScreen();
    }
  }
})();