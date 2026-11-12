// Where My Budget keeps its data on this device.
//
// Data lives in IndexedDB (sturdier than the browser's simple storage) and the app asks the
// phone to keep it permanently. Everything is also held in memory, so the rest of the app can
// read instantly; every write is saved to IndexedDB in order, one after another.
//
// On first run after this update, data is moved over from the old simple storage
// (localStorage). The old copy is only removed after the new copy has been read back and
// checked to be identical.

export const LEGACY_KEYS = ['mybudget.v1', 'mybudget.vault'];

let cache = new Map();
let backend = null;
let queue = Promise.resolve();
let persisted = null;

// ---------- Backends ----------

// IndexedDB: one database, one key → text store.
export async function idbBackend(name = 'my-budget') {
  if (typeof indexedDB === 'undefined') throw new Error('No IndexedDB');
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
  const tx = (mode, fn) => new Promise((resolve, reject) => {
    const t = db.transaction('kv', mode);
    const out = fn(t.objectStore('kv'));
    t.oncomplete = () => resolve(out?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error('aborted'));
  });
  return {
    kind: 'indexeddb',
    async getAll() {
      const keys = await tx('readonly', (s) => s.getAllKeys());
      const values = await tx('readonly', (s) => s.getAll());
      return keys.map((k, i) => [k, values[i]]);
    },
    get: (k) => tx('readonly', (s) => s.get(k)),
    put: (k, v) => tx('readwrite', (s) => s.put(v, k)),
    del: (k) => tx('readwrite', (s) => s.delete(k)),
  };
}

// Fallback if IndexedDB is missing or broken: the old simple storage.
export function localBackend(ls = globalThis.localStorage) {
  return {
    kind: 'localstorage',
    async getAll() {
      const out = [];
      for (let i = 0; i < ls.length; i++) {
        const k = ls.key(i);
        if (k?.startsWith('mybudget')) out.push([k, ls.getItem(k)]);
      }
      return out;
    },
    async get(k) { return ls.getItem(k); },
    async put(k, v) { ls.setItem(k, v); },
    async del(k) { ls.removeItem(k); },
  };
}

// In-memory backend used by the automated tests (a "device" whose data survives restarts).
export function memoryBackend(map = new Map(), { failWrites = false } = {}) {
  return {
    kind: 'memory',
    map,
    async getAll() { return [...map.entries()]; },
    async get(k) { return map.has(k) ? map.get(k) : undefined; },
    async put(k, v) { if (failWrites) throw new Error('write failed'); map.set(k, v); },
    async del(k) { map.delete(k); },
  };
}

// ---------- Start-up ----------

// Opens storage, loads everything into memory, and moves any old data across safely.
export async function initStorage({ backend: chosen, legacy = globalThis.localStorage } = {}) {
  queue = Promise.resolve();
  if (chosen) backend = chosen;
  else {
    try {
      backend = await idbBackend();
    } catch {
      backend = localBackend(legacy);
    }
  }
  cache = new Map(await backend.getAll());
  if (legacy && backend.kind !== 'localstorage') {
    const moved = await moveLegacy(legacy);
    if (!moved) {
      // The new storage isn't saving properly: carry on with the old one so nothing goes missing.
      backend = localBackend(legacy);
      cache = new Map(await backend.getAll());
    }
  }
  return backend.kind;
}

// Copies everything first; only when every copy has been read back and checked are the old
// ones removed. Returns false if the new storage couldn't safely take the data.
async function moveLegacy(legacy) {
  const done = [];
  for (const key of LEGACY_KEYS) {
    let old;
    try { old = legacy.getItem(key); } catch { old = null; }
    if (old == null) continue;
    try {
      if (cache.has(key) && cache.get(key) !== old) {
        // Both exist: an earlier move didn't finish and the app kept saving to the old storage,
        // so the old storage is newer. Keep the other one as a spare copy, never lose data.
        await putChecked(`mybudget.legacy-copy.${key}`, cache.get(key));
      }
      if (cache.get(key) !== old) await putChecked(key, old);
    } catch {
      return false;
    }
    done.push(key);
  }
  for (const key of done) {
    try { legacy.removeItem(key); } catch { /* fine */ }
  }
  // A passcode vault means the unencrypted copy must not linger anywhere.
  if (cache.has('mybudget.vault') && cache.has('mybudget.v1')) await removeItem('mybudget.v1');
  return true;
}

async function putChecked(k, v) {
  await backend.put(k, v);
  if ((await backend.get(k)) !== v) throw new Error('copy did not match');
  cache.set(k, v);
}

// Ask the phone not to clear this app's data when space runs low.
export async function requestPersistence() {
  try {
    if (!navigator.storage?.persist) return (persisted = false);
    persisted = (await navigator.storage.persisted?.()) || (await navigator.storage.persist());
  } catch {
    persisted = false;
  }
  return persisted;
}

export const isPersisted = () => persisted;
export const storageKind = () => backend?.kind ?? null;

// ---------- Reading and writing (instant reads from memory, ordered saves) ----------

export function getItem(k) {
  return cache.has(k) ? cache.get(k) : null;
}

// Saves run one after another. A failed save is reported to its caller but never blocks later ones.
function enqueue(fn) {
  const p = queue.then(fn);
  queue = p.catch(() => {});
  return p;
}

export function setItem(k, v) {
  const value = String(v);
  cache.set(k, value);
  return enqueue(() => backend.put(k, value));
}

export function removeItem(k) {
  cache.delete(k);
  return enqueue(() => backend.del(k));
}

export function keys() {
  return [...cache.keys()];
}

// Resolves once every save so far has reached the device.
export function flushStorage() {
  return queue;
}
