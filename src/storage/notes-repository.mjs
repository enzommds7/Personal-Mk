/**
 * Transactional primary notes repository. Uses a separate key in the existing
 * AgendaNotesBackupDB/snapshots store. The legacy copy is never deleted here.
 * Activation in the UI is a separate migration step.
 */
export class NotesRevisionConflict extends Error {
  constructor() {
    super('Another writer changed the notes. Reload the latest revision before retrying.');
    this.name = 'NotesRevisionConflict';
  }
}

function validateDays(days) {
  if (!days || typeof days !== 'object' || Array.isArray(days)) {
    throw new Error('Invalid notes dataset');
  }
  for (const [key, day] of Object.entries(days)) {
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(key) ||
        !day || typeof day !== 'object' || Array.isArray(day)) {
      throw new Error('Invalid note: ' + key);
    }
  }
  return days;
}

function validateRecord(record) {
  if (!record || record.schema !== 1 ||
      !Number.isSafeInteger(record.revision) || record.revision < 0) {
    throw new Error('Invalid notes repository record');
  }
  validateDays(record.days);
  return record;
}

// Keep reads and writes inside one IndexedDB transaction. Resolve only after
// oncomplete, not after the put request succeeds.
function transact(database, mode, action) {
  return new Promise((resolve, reject) => {
    const tx = database.transaction('snapshots', mode);
    const store = tx.objectStore('snapshots');
    let result;
    let failure;
    const abort = error => {
      failure = error;
      try { tx.abort(); } catch { reject(error); }
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(failure || tx.error || new Error('Notes transaction failed'));
    tx.onabort = () => reject(failure || tx.error || new Error('Notes transaction aborted'));
    const get = (key, callback) => {
      const request = store.get(key);
      request.onsuccess = () => {
        try { callback(request.result); } catch (error) { abort(error); }
      };
    };
    const put = (key, value) => { store.put(value, key); };
    try { action({get, put, finish: value => {result = value;}}); }
    catch (error) { abort(error); }
  });
}

export function createNotesRepository({openDatabase, legacyStorage}) {
  const primaryKey = account => {
    if (typeof account !== 'string' || !account) throw new Error('Account key required');
    return 'notes-primary:' + account;
  };

  async function initialize(account) {
    const key = primaryKey(account);
    const database = await openDatabase();
    return transact(database, 'readwrite', ({get, put, finish}) => {
      get(key, existing => {
        if (existing !== undefined) {
          finish(validateRecord(existing));
          return;
        }
        // Read the legacy origin only if no primary record exists. A malformed
        // origin is an error, never an empty agenda.
        const raw = legacyStorage.getItem(account);
        get(account, snapshot => {
          const days = validateDays(raw !== null ? JSON.parse(raw) : snapshot === undefined ? {} : snapshot);
          const record = {schema: 1, revision: 0, days};
          put(key, record);
          finish(record);
        });
      });
    });
  }

  async function read(account) {
    const key = primaryKey(account);
    const database = await openDatabase();
    return transact(database, 'readonly', ({get, finish}) => {
      get(key, record => finish(validateRecord(record)));
    });
  }

  async function commit(account, expectedRevision, days) {
    const key = primaryKey(account);
    // Capture the input before the asynchronous transaction starts.
    const captured = validateDays(JSON.parse(JSON.stringify(days)));
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new Error('Invalid expected revision');
    }
    const database = await openDatabase();
    return transact(database, 'readwrite', ({get, put, finish}) => {
      get(key, existing => {
        const current = validateRecord(existing);
        if (current.revision !== expectedRevision) throw new NotesRevisionConflict();
        const record = validateRecord({schema: 1, revision: current.revision + 1, days: captured});
        put(key, record);
        finish(record);
      });
    });
  }

  return {initialize, read, commit};
}


// Synchronous view for existing UI readers, asynchronous durable writes.
// Every queued change is based on the view the caller actually read.
export function createNotesSession(repository, account, initialRecord) {
  const clone = value => JSON.parse(JSON.stringify(value));
  const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
  let state = clone(initialRecord);
  let tail = Promise.resolve();
  let pending = 0;
  function read() { return clone(state.days); }
  function save(days) {
    const before = read();
    const desired = clone(validateDays(days));
    const keys = [...new Set([...Object.keys(before), ...Object.keys(desired)])]
      .filter(key => !same(before[key], desired[key]));
    pending++;
    const operation = tail.catch(() => {}).then(async () => {
      if (!keys.length) return;
      const next = read();
      for (const key of keys) {
        if (!same(next[key], before[key])) throw new NotesRevisionConflict();
        if (Object.prototype.hasOwnProperty.call(desired,key)) next[key] = desired[key];
        else delete next[key];
      }
      state = await repository.commit(account, state.revision, next);
    }).finally(() => { pending--; });
    tail = operation;
    return operation;
  }
  return {read, save, get pending() {return pending;}};
}
