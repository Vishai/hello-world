/**
 * db.js — IndexedDB persistence.
 *
 * Two stores:
 *   projects — one record per project (garment, artwork placements, design)
 *   textiles — user-level donor textile library (§17: textiles belong to the
 *              user, not a project, because one donor material can feed many
 *              designs and its remaining area is shared)
 */

const DB_NAME = 'restitch';
const DB_VERSION = 1;

let dbPromise = null;

// Sandboxed contexts (e.g. the Claude Artifact viewer, some private-browsing
// modes) can refuse IndexedDB entirely. Fall back to an in-memory store so
// the whole flow still works for the session.
const memory = { projects: new Map(), textiles: new Map() };
let useMemory = false;

function memoryOp(store, fn) {
  return Promise.resolve(fn(memory[store]));
}

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      let req;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION); // can throw synchronously when blocked
      } catch (err) {
        reject(err);
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('projects')) {
          db.createObjectStore('projects', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('textiles')) {
          db.createObjectStore('textiles', { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(store, mode, fn, memFn) {
  if (useMemory) return memoryOp(store, memFn);
  let database;
  try {
    database = await open();
  } catch {
    useMemory = true;
    return memoryOp(store, memFn);
  }
  return new Promise((resolve, reject) => {
    const t = database.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => resolve(out?.result ?? out);
    t.onerror = () => reject(t.error);
  });
}

export const db = {
  getAll: (store) => tx(store, 'readonly', (s) => s.getAll(), (m) => [...m.values()]),
  get: (store, id) => tx(store, 'readonly', (s) => s.get(id), (m) => m.get(id)),
  put: (store, value) => tx(store, 'readwrite', (s) => s.put(value), (m) => m.set(value.id, value)),
  delete: (store, id) => tx(store, 'readwrite', (s) => s.delete(id), (m) => m.delete(id)),
  /** True when running on the session-only fallback (no durable storage). */
  isMemory: () => useMemory,
};
