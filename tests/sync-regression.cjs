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
console.log(runSyncTests(source) + ' sync regression checks passed');
