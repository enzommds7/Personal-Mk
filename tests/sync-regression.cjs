// Run: node tests/sync-regression.cjs
const fs = require('node:fs');
const path = require('node:path');
function runSyncTests(source) {
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
    count++;
  };
  let count = 0;
  const start = source.indexOf('function readPendingOperations(');
  const end = source.indexOf('async function cloudSaveDay(', start);
  if (start < 0 || end < 0) throw new Error('Sync helpers not found');
  const store = Object.create(null);
  const writes = new Map();
  let editing = false;
  let status = '';
  const api = new Function(
    'localStorage', 'localKey', 'pendingCloudWrites', 'hasUnsavedEditorChanges', 'setSyncStatus',
    source.slice(start, end) + '\nreturn {hasPendingDelete,isDayBusy,shouldDeferRemoteDay,updateCloudSyncStatus};'
  )({getItem: key => store[key] ?? null}, () => 'test', writes, () => editing, value => status = value);
  assert(!api.shouldDeferRemoteDay('day'), 'Clean day accepts remote updates');
  store.test_pendingEdits = '{"day":"stamp"}';
  assert(api.shouldDeferRemoteDay('day'), 'Pending edits cannot be overwritten by remote snapshots');
  assert(!api.isDayBusy('day'), 'Pending edit remains eligible for retry');
  api.updateCloudSyncStatus();
  assert(status === 'offline', 'Pending edit prevents synced status');
  store.test_pendingEdits = '{}';
  store.test_pendingDeletes = '{"day":"stamp"}';
  assert(api.hasPendingDelete('day'), 'Pending deletion is recognized');
  assert(api.shouldDeferRemoteDay('day'), 'Pending deletion blocks remote resurrection');
  api.updateCloudSyncStatus();
  assert(status === 'offline', 'Pending deletion prevents synced status');
  store.test_pendingDeletes = '{}';
  writes.set('day', 1);
  assert(api.isDayBusy('day'), 'Active upload blocks competing operations');
  api.updateCloudSyncStatus();
  assert(status === 'syncing', 'Active upload prevents synced status');
  writes.clear();
  editing = true;
  assert(api.shouldDeferRemoteDay('day'), 'Editor activity protects active note');
  editing = false;
  api.updateCloudSyncStatus();
  assert(status === 'synced', 'Empty queues allow synced status');
  store.test_pendingEdits = '[]';
  let rejected = false;
  try { api.shouldDeferRemoteDay('day'); } catch { rejected = true; }
  assert(rejected, 'Malformed queue fails closed instead of being treated as empty');
  return count;
}
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
new Function(source); // Parse browser script without executing its DOM initialization.
async function runTransactionTests(source) {
  const start = source.indexOf('async function cloudSaveDay(');
  const end = source.indexOf('async function cloudDeleteDay(', start);
  if (start < 0 || end < 0) throw new Error('Cloud save not found');
  const stamp = '2026-01-02T12:00:00.000Z';
  let count = 0;
  async function scenario({remote = null, fail = false, preserve = true, replacePending = false} = {}) {
    const store = Object.create(null);
    const day = {content:'local note', title:'', tags:[], images:[], checklist:[], updatedAt:stamp};
    const writes = [];
    const history = [];
    const pending = new Map();
    const localStorage = {
      getItem: key => store[key] ?? null,
      setItem: (key, value) => {store[key] = value;}
    };
    const db = {runTransaction: async callback => {
      if (fail) throw new Error('offline simulation');
      await callback({
        get: async () => {
          if (replacePending) store.test_pendingEdits = JSON.stringify({day:'new operation'});
          return {exists: !!remote, data: () => remote};
        },
        set: (_ref, payload) => writes.push(payload)
      });
    }};
    const fn = new Function(
      'db','currentUser','FB_ON','hasPendingDelete','loadLocal','localKey','localGetDay',
      'localStorage','pendingCloudWrites','setSyncStatus','userDaysRef','dayDiffers',
      'preserveConflictingDay','showToast','updateCloudSyncStatus','console',
      source.slice(start,end) + '\nreturn cloudSaveDay;'
    )(db,{uid:'test'},true,()=>false,()=>({day}),()=> 'test',()=>day,
      localStorage,pending,()=>{},()=>({doc:()=> 'ref'}),(a,b)=>a.content!==b.content,
      (_key,value)=>{history.push(value);return preserve;},()=>{},()=>{}, {error:()=>{}});
    const result = await fn('day');
    if (pending.size !== 0) throw new Error('Write lock was not released');
    return {result,writes,history,queued:JSON.parse(store.test_pendingEdits || '{}').day};
  }
  function assert(value,message) {if (!value) throw new Error(message); count++;}
  const created = await scenario();
  assert(created.result && created.writes.length === 1 && !created.queued,'Confirmed create clears queue');
  const offline = await scenario({fail:true});
  assert(!offline.result && offline.writes.length === 0 && offline.queued === stamp,'Network failure retains queue');
  const newer = await scenario({remote:{content:'remote',updatedAt:'2026-01-03T12:00:00.000Z'}});
  assert(!newer.result && !newer.writes.length && newer.queued === stamp,'Newer remote blocks overwrite');
  const older = await scenario({remote:{content:'remote',updatedAt:'2026-01-01T12:00:00.000Z'}});
  assert(older.result && older.history.length === 1 && older.writes.length === 1,'Older remote is preserved before replacement');
  const quota = await scenario({remote:{content:'remote',updatedAt:'2026-01-01T12:00:00.000Z'},preserve:false});
  assert(!quota.result && !quota.writes.length && quota.queued === stamp,'Failed conflict preservation prevents overwrite');
  const deleted = await scenario({remote:{deleted:true,updatedAt:'2026-01-03T12:00:00.000Z'}});
  assert(!deleted.result && !deleted.writes.length && deleted.queued === stamp,'Newer tombstone blocks resurrection');
  const replaced = await scenario({replacePending:true});
  assert(!replaced.result && !replaced.writes.length && replaced.queued === 'new operation','Superseded upload cannot clear newer operation');
  return count;
}

async function runConflictStorageTests(source) {
  const start = source.indexOf('function combineConflictHistory(');
  const end = source.indexOf('async function preserveConflictingDay(', start);
  if (start < 0 || end < 0) throw new Error('Conflict storage helpers not found');
  const first = {key:'2026-01-01',savedAt:'2026-01-02',day:{content:'original',images:['image-1']}};
  const other = {...first,day:{...first.day,images:['image-2']}};
  let count = 0;
  function assert(value,message) {if (!value) throw new Error(message); count++;}
  async function scenario({fail=false,modified=false}={}) {
    const store = {'test_conflicts':JSON.stringify([first])};
    let indexed = [first];
    const localStorage = {
      getItem:key=>store[key]??null,
      removeItem:key=>{delete store[key];}
    };
    const db = {transaction:()=>{
      const txn = {error:null,abort(){this.onabort?.();},objectStore(){
        return {get(){
          const req = {result:indexed};
          Promise.resolve().then(()=>req.onsuccess());
          return req;
        },put(data){
          Promise.resolve().then(()=>{
            if(fail){txn.error=new Error('Simulated quota failure');txn.onerror();return;}
            indexed=data;
            if(modified)store.test_conflicts=JSON.stringify([first,other]);
            txn.oncomplete();
          });
        }};
      }};
      return txn;
    }};
    const api = new Function('localStorage','openNotesSnapshotDb',
      source.slice(start,end)+'\nreturn {combineConflictHistory,updateConflictHistory};'
    )(localStorage,async()=>db);
    let rejected=false;
    try {await api.updateConflictHistory('test',[other]);}catch{rejected=true;}
    return {legacy:store.test_conflicts,indexed,rejected,api};
  }
  const ok=await scenario();
  assert(!ok.rejected && !ok.legacy,'Legacy history removed only after successful transaction');
  assert(ok.indexed.length===2,'Migration deduplicates identical entries and preserves differing images');
  const failed=await scenario({fail:true});
  assert(failed.rejected && !!failed.legacy,'Failed transaction preserves legacy history');
  const changed=await scenario({modified:true});
  assert(!!changed.legacy,'Concurrent legacy change is not erased');
  return count;
}

(async () => {
  const total = runSyncTests(source) + await runTransactionTests(source) + await runConflictStorageTests(source);
  console.log(total + ' sync regression checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
