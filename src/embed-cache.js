// Note and photograph vectors, kept on this device.
//
// IndexedDB already holds imported photographs. This store sits beside that
// one. A return visit reads the vector instead of running the model again,
// until the note changes, the photo bytes change, or the model id changes.
// Nothing here is uploaded.

import { EMBED_STORE, openRememberDb } from "./library.js";

// One slot per shard (or job) per kind. The model id lives on the record,
// so a bump is a miss and the next write replaces the old numbers.
export function embedKey(kind, id) {
  return `${kind}:${id}`;
}

// FNV-1a over the exact string that was embedded. An edit changes the hash.
export function textFingerprint(text) {
  const value = String(text ?? "");
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= value.length;
  h = Math.imul(h, 0x01000193);
  return (h >>> 0).toString(16).padStart(8, "0");
}

// Hash of the photograph bytes, plus the length. Replacing the file misses.
export function bytesFingerprint(bytes) {
  const view =
    bytes instanceof ArrayBuffer
      ? new Uint8Array(bytes)
      : bytes instanceof Uint8Array
        ? bytes
        : null;
  if (!view?.length) return "";
  let h = 0x811c9dc5;
  for (let i = 0; i < view.length; i += 1) {
    h ^= view[i];
    h = Math.imul(h, 0x01000193);
  }
  h ^= view.length;
  h = Math.imul(h, 0x01000193);
  return `${(h >>> 0).toString(16).padStart(8, "0")}:${view.length}`;
}

export async function fingerprintBlob(blob) {
  if (!blob || typeof blob.arrayBuffer !== "function") return "";
  return bytesFingerprint(new Uint8Array(await blob.arrayBuffer()));
}

// Prefer the bytes. If they can't be read, the file's path, size, and
// lastModified (already stored on an imported shard) still change when the
// photo is replaced. A sample with only a path uses that path.
export async function photoFingerprintOf(shard, { readBlob, fetchBytes } = {}) {
  if (shard?.hasPhoto && typeof readBlob === "function") {
    try {
      const blob = await readBlob(shard.id);
      const print = await fingerprintBlob(blob);
      if (print) return print;
    } catch {
      // Fall through to the URL or the stored file stamp.
    }
  }

  if (shard?.photo && typeof fetchBytes === "function") {
    try {
      const bytes = await fetchBytes(shard.photo);
      const print = bytesFingerprint(bytes);
      if (print) return print;
    } catch {
      // A path is enough to stay stable across a reload.
    }
  }

  if (shard?.fingerprint) return String(shard.fingerprint);
  if (shard?.photo) return `path:${shard.photo}`;
  return "";
}

function copyVector(vec) {
  if (!vec) return null;
  const source = vec.data ?? vec;
  const length = source.length ?? 0;
  if (!length) return null;
  const out = [];
  for (let i = 0; i < length; i += 1) {
    const n = Number(source[i]);
    if (!Number.isFinite(n)) return null;
    out.push(n);
  }
  return out;
}

function matches(record, query) {
  if (!record || record.model !== query.model) return false;
  if (String(record.fingerprint ?? "") !== String(query.fingerprint ?? "")) return false;
  const dim = query.dim | 0;
  if (!dim || record.dim !== dim) return false;
  return true;
}

function memoryStore() {
  const rows = new Map();
  return {
    async get(key) {
      return rows.has(key) ? rows.get(key) : null;
    },
    async put(key, value) {
      rows.set(key, value);
    },
    async delete(key) {
      rows.delete(key);
    },
  };
}

function idbCall(db, mode, run) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(EMBED_STORE, mode);
    const request = run(tx.objectStore(EMBED_STORE));
    tx.oncomplete = () => resolve(request?.result ?? null);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// IndexedDB when the browser has it. The session map covers a private
// window or a failed open, so ranking still has what this visit computed.
export function browserEmbedStore() {
  const memory = memoryStore();
  return {
    async get(key) {
      try {
        const db = await openRememberDb();
        if (db && db.objectStoreNames.contains(EMBED_STORE)) {
          const value = await idbCall(db, "readonly", (store) => store.get(key));
          if (value) return value;
        }
      } catch {
        // The session map is the fallback.
      }
      return memory.get(key);
    },
    async put(key, value) {
      await memory.put(key, value);
      try {
        const db = await openRememberDb();
        if (!db || !db.objectStoreNames.contains(EMBED_STORE)) return;
        await idbCall(db, "readwrite", (store) => store.put(value, key));
      } catch {
        // Ranking can use the vector we already hold in memory.
      }
    },
    async delete(key) {
      await memory.delete(key);
      try {
        const db = await openRememberDb();
        if (!db || !db.objectStoreNames.contains(EMBED_STORE)) return;
        await idbCall(db, "readwrite", (store) => store.delete(key));
      } catch {
        // The letter is already gone from the pool.
      }
    },
  };
}

export function createEmbedCache(storage = browserEmbedStore()) {
  async function recall(query) {
    if (!query?.kind || query.id == null || query.id === "") return null;
    if (!query.model || query.fingerprint == null || query.fingerprint === "") return null;
    if (!query.dim) return null;
    let record = null;
    try {
      record = await storage.get(embedKey(query.kind, query.id));
    } catch {
      return null;
    }
    if (!matches(record, query)) return null;
    const vector = copyVector(record.vector);
    if (!vector || vector.length !== record.dim) return null;
    return vector;
  }

  async function remember(query) {
    const vector = copyVector(query?.vector);
    const dim = query?.dim | 0;
    if (!query?.kind || query.id == null || query.id === "") return false;
    if (!query.model || query.fingerprint == null || query.fingerprint === "") return false;
    if (!vector || !dim || vector.length !== dim) return false;
    const record = {
      kind: query.kind,
      id: String(query.id),
      model: query.model,
      fingerprint: String(query.fingerprint),
      dim,
      vector,
    };
    try {
      await storage.put(embedKey(query.kind, query.id), record);
      return true;
    } catch {
      return false;
    }
  }

  async function forget(id) {
    await storage.delete(embedKey("note", id));
    await storage.delete(embedKey("image", id));
  }

  // Hits return the stored vector and do not call embedMisses.
  // embedMisses receives only the misses. ok:false means the model was not
  // usable — nothing is written, and the caller keeps its hash or fingerprint.
  async function resolve(items, embedMisses) {
    const vectors = new Array(items.length).fill(null);
    const missing = [];
    let hits = 0;
    for (let i = 0; i < items.length; i += 1) {
      const hit = await recall(items[i]);
      if (hit) {
        vectors[i] = hit;
        hits += 1;
      } else {
        missing.push(i);
      }
    }
    if (!missing.length) return { vectors, encoded: 0, hits, failed: false };

    let embedded = null;
    try {
      embedded = await embedMisses(missing.map((index) => items[index]));
    } catch {
      return { vectors, encoded: 0, hits, failed: true };
    }
    if (!embedded || embedded.ok === false) {
      return { vectors, encoded: 0, hits, failed: true };
    }
    const fresh = embedded.vectors;
    if (!fresh || fresh.length !== missing.length) {
      return { vectors, encoded: 0, hits, failed: true };
    }

    let encoded = 0;
    for (let j = 0; j < missing.length; j += 1) {
      const i = missing[j];
      const vector = copyVector(fresh[j]);
      const dim = items[i].dim | 0;
      if (!vector || vector.length !== dim) continue;
      vectors[i] = vector;
      encoded += 1;
      await remember({ ...items[i], dim, vector });
    }
    return { vectors, encoded, hits, failed: false };
  }

  return { recall, remember, forget, resolve };
}

export const embedCache = createEmbedCache();
