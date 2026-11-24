import assert from 'node:assert/strict';
import {createNotesRepository, NotesRevisionConflict, createNotesSession} from '../src/storage/notes-repository.mjs';

// Minimal transaction simulation. Staged writes are committed only on completion.
function fakeDatabase() {
  const records = new Map();
  let failNext = false;
  return {
    records,
    failNextCommit() { failNext = true; },
    transaction(_name, mode) {
      const staged = new Map();
      let pending = 0, ended = false;
      const tx = {
        error: null,
        abort() {
          if (ended) return;
          ended = true;
          tx.onabort?.();
        },
        objectStore() {
          return {
            get(key) {
              pending++;
              const req = {};
              queueMicrotask(() => {
                if (ended) return;
                req.result = structuredClone(records.get(key));
                req.onsuccess?.();
                pending--;
                complete();
              });
              return req;
            },
            put(value, key) {
              if (mode !== 'readwrite') throw new Error('Read-only transaction');
              staged.set(key, structuredClone(value));
            }
          };
        }
      };
      function complete() {
        if (ended || pending) return;
        ended = true;
        if (failNext && staged.size) {
          failNext = false;
          tx.error = new Error('Simulated quota error');
          tx.onabort?.();
          return;
        }
        for (const [key, value] of staged) records.set(key, value);
        tx.oncomplete?.();
      }
      return tx;
    }
  };
}

const db = fakeDatabase();
const legacy = new Map();
const repo = createNotesRepository({
  openDatabase: async () => db,
  legacyStorage: {getItem: key => legacy.get(key) ?? null}
});
const key = 'agenda_v3_days_test';
const first = {'2026-11-23': {content:'<p>private synthetic note</p>', images:['test-image']}};
legacy.set(key, JSON.stringify(first));
const initial = await repo.initialize(key);
assert.deepEqual(initial.days, first);
assert.equal(initial.revision, 0);
assert.equal(legacy.get(key), JSON.stringify(first));
const next = {'2026-11-23': {content:'edited'}};
assert.equal((await repo.commit(key, 0, next)).revision, 1);
assert.deepEqual((await repo.read(key)).days, next);
assert.deepEqual((await repo.initialize(key)).days, next);
await assert.rejects(repo.commit(key, 0, first), NotesRevisionConflict);
assert.deepEqual((await repo.read(key)).days, next);
db.failNextCommit();
await assert.rejects(repo.commit(key, 1, first), /quota/);
assert.deepEqual((await repo.read(key)).days, next);
assert.equal((await repo.read(key)).revision, 1);
db.records.set('snapshot-account', first);
assert.deepEqual((await repo.initialize('snapshot-account')).days, first);
assert.deepEqual((await repo.initialize('other-account')).days, {});
legacy.set('broken-account', 'not JSON');
await assert.rejects(repo.initialize('broken-account'));
assert.equal(legacy.get('broken-account'), 'not JSON');
await assert.rejects(repo.commit(key, 1, []), /Invalid notes dataset/);
console.log('16 notes repository checks passed (simulated IndexedDB)');


async function runSessionTests() {
  const initial = {schema:1,revision:0,days:{'2026-01-01':{content:'a'}}};
  let stored = JSON.parse(JSON.stringify(initial));
  let fail = false;
  const repo = {async commit(_account, rev, days) {
    if (fail) throw Error('quota');
    if (rev !== stored.revision) throw new NotesRevisionConflict();
    stored = {schema:1,revision:rev+1,days:JSON.parse(JSON.stringify(days))};
    return stored;
  }};
  const session=createNotesSession(repo,'account',initial);
  const a=session.read();a['2026-01-01'].content='changed';
  const b=session.read();b['2026-01-02']={content:'new'};
  const one=session.save(a),two=session.save(b);
  await Promise.all([one,two]);
  if(session.read()['2026-01-01'].content!=='changed'||session.read()['2026-01-02'].content!=='new')throw Error('disjoint changes lost');
  const first=session.read(),second=session.read();
  first['2026-01-01'].content='first';second['2026-01-01'].content='second';
  const p=session.save(first),q=session.save(second);
  const outcomes=await Promise.allSettled([p,q]);
  if(outcomes[0].status!=='fulfilled'||outcomes[1].status!=='rejected')throw Error('same-note concurrent write not rejected');
  fail=true;
  const old=session.read(),next=session.read();next['2026-01-01'].content='failed';
  const failure=await Promise.allSettled([session.save(next)]);
  if(failure[0].status!=='rejected'||JSON.stringify(old)!==JSON.stringify(session.read()))throw Error('uncommitted state became visible');
  if(session.pending!==0)throw Error('pending leak');
  return 4;
}

console.log(await runSessionTests() + ' notes session checks passed');
