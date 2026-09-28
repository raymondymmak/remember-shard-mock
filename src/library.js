// Imported letters live on this machine.
// Words and the log sit in localStorage. Photographs sit in IndexedDB,
// and embedding vectors sit in a store beside them.

import { mergePlan } from "./ingest.js";

const META_KEY = "remember.library.v0";
const DB_NAME = "remember";
const DB_VERSION = 2;
const STORE = "photos";
export const EMBED_STORE = "embeddings";

const KEPT = [
  "id",
  "note",
  "why",
  "date",
  "vibe",
  "photoAlt",
  "hasPhoto",
  "filename",
  "noteName",
  "fingerprint",
  "placeholder",
  "mime",
];

let records = [];
let includeSamples = true;
const urls = new Map();
let dbPromise = null;

function emptyMeta() {
  return { v: 1, includeSamples: true, shards: [] };
}

function canUseStorage() {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    return false;
  }
}

function readMeta() {
  if (!canUseStorage()) return globalThis.__rememberLibrary || emptyMeta();
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return emptyMeta();
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.shards)) return emptyMeta();
    return {
      v: 1,
      includeSamples: data.includeSamples !== false,
      shards: data.shards,
    };
  } catch {
    return emptyMeta();
  }
}

function writeMeta() {
  const payload = {
    v: 1,
    includeSamples,
    shards: records.map(persistable),
  };
  if (!canUseStorage()) {
    globalThis.__rememberLibrary = payload;
    return;
  }
  try {
    localStorage.setItem(META_KEY, JSON.stringify(payload));
  } catch {
    // Private mode or a full disk — the tab still has the letters.
  }
}

function persistable(row) {
  const out = {};
  for (const key of KEPT) {
    if (row[key] !== undefined) out[key] = row[key];
  }
  return out;
}

function materialize(row) {
  const url = row.hasPhoto ? urls.get(row.id) || "" : "";
  return {
    ...row,
    imported: true,
    photo: url,
    paper: !url,
  };
}

export function openRememberDb() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        if (!db.objectStoreNames.contains(EMBED_STORE)) db.createObjectStore(EMBED_STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).catch((error) => {
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}

function openDb() {
  return openRememberDb();
}

function putBlob(id, blob) {
  return openDb().then((db) => {
    if (!db) return null;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(STORE).put(blob, id);
    });
  });
}

function getBlob(id) {
  return openDb().then((db) => {
    if (!db) return null;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  });
}

export function readPhoto(id) {
  return getBlob(id);
}

function deleteBlob(id) {
  return openDb().then((db) => {
    if (!db) return null;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(STORE).delete(id);
    });
  });
}

export async function hydrate() {
  const meta = readMeta();
  records = meta.shards.map((row) => ({ ...row }));
  includeSamples = meta.includeSamples !== false;

  await Promise.all(
    records.map(async (row) => {
      if (!row.hasPhoto) return;
      try {
        const blob = await getBlob(row.id);
        if (blob && typeof URL !== "undefined" && URL.createObjectURL) {
          urls.set(row.id, URL.createObjectURL(blob));
        }
      } catch {
        // The words remain. The print falls back to paper.
      }
    }),
  );

  return list();
}

export function includeSamplesOn() {
  return includeSamples;
}

export function setIncludeSamples(on) {
  includeSamples = Boolean(on);
  writeMeta();
}

export function list() {
  return records.map(materialize);
}

export function updateShard(id, patch) {
  const row = records.find((item) => item.id === id);
  if (!row) return null;
  Object.assign(row, persistable({ ...row, ...patch, id: row.id }));
  writeMeta();
  return materialize(row);
}

export async function rememberShards(drafts, blobs) {
  const actions = mergePlan(records, drafts);
  const added = [];
  const updated = [];
  const duplicates = [];

  for (const action of actions) {
    if (action.type === "skip") {
      duplicates.push(records.find((row) => row.id === action.id) || action.draft);
      continue;
    }

    if (action.type === "update") {
      const row = records.find((item) => item.id === action.id);
      if (!row) continue;
      row.note = action.draft.note;
      row.why = action.draft.why;
      row.vibe = action.draft.vibe;
      row.noteName = action.draft.noteName || row.noteName;
      row.placeholder = false;
      updated.push(row);
      continue;
    }

    const draft = action.draft;
    const row = persistable(draft);
    const blob = draft.hasPhoto ? blobs?.get(draft.id) : null;
    if (blob) {
      try {
        await putBlob(draft.id, blob);
        if (typeof URL !== "undefined" && URL.createObjectURL) {
          urls.set(draft.id, URL.createObjectURL(blob));
        }
      } catch {
        row.hasPhoto = false;
      }
    } else if (row.hasPhoto) {
      row.hasPhoto = false;
    }
    records.push(row);
    added.push(row);
  }

  writeMeta();
  return {
    added: added.map(materialize),
    updated: updated.map(materialize),
    duplicates: duplicates.map((row) => materialize(row)),
  };
}

export async function forget(id) {
  const url = urls.get(id);
  if (url && typeof URL !== "undefined" && URL.revokeObjectURL) URL.revokeObjectURL(url);
  urls.delete(id);
  records = records.filter((row) => row.id !== id);
  writeMeta();
  try {
    await deleteBlob(id);
  } catch {
    // The letter is already gone from the pool.
  }
}
