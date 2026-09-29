// A letter pack is one zip you can take to another machine.
// library.json holds the words. photos/ holds the prints.
// Embeddings are made again on the next machine.
// Marks, learned weights, and shown times keep their own stores.

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  basename,
  createImportId,
  directoryOf,
  extensionOf,
} from "./ingest.js";

export const LETTER_PACK_NAME = "remember-letters.zip";
const KIND = "remember-letters";

// Same fields the library keeps for a letter. The pack adds `photo`
// only as a path inside the zip, and only while the file is being built.
export const PACK_FIELDS = [
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

function normalize(path) {
  return String(path || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/");
}

function junkPath(path) {
  const parts = normalize(path).split("/");
  if (parts.includes("__MACOSX")) return true;
  const base = parts[parts.length - 1] || "";
  return base === ".DS_Store" || base.startsWith("._");
}

export function isZipName(name, type = "") {
  if (extensionOf(name) === "zip") return true;
  const kind = String(type || "").toLowerCase();
  return kind === "application/zip" || kind === "application/x-zip-compressed";
}

export function isLibraryName(name) {
  return basename(name).toLowerCase() === "library.json";
}

function vibeOf(value) {
  if (!Array.isArray(value) || value.length < 3) return [0.5, 0.5, 0.5];
  return [0, 1, 2].map((index) => {
    const n = Number(value[index]);
    return Number.isFinite(n) ? n : 0.5;
  });
}

function text(value) {
  return value == null ? "" : String(value);
}

function pickShard(row) {
  if (!row || typeof row !== "object") return null;
  if (row.id == null || text(row.id).trim() === "") return null;
  const out = { id: text(row.id) };
  for (const key of PACK_FIELDS) {
    if (key === "id" || row[key] === undefined) continue;
    out[key] = row[key];
  }
  if (out.note != null) out.note = text(out.note);
  if (out.why != null) out.why = text(out.why);
  if (out.date != null) out.date = text(out.date);
  if (out.photoAlt != null) out.photoAlt = text(out.photoAlt);
  if (out.filename != null) out.filename = text(out.filename);
  if (out.noteName != null) out.noteName = text(out.noteName);
  if (out.fingerprint != null) out.fingerprint = text(out.fingerprint);
  if (out.mime != null) out.mime = text(out.mime);
  out.hasPhoto = Boolean(row.hasPhoto);
  out.placeholder = Boolean(row.placeholder);
  out.vibe = vibeOf(row.vibe);
  return out;
}

function safeId(id) {
  const clean = text(id)
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return clean || "letter";
}

function extOf(shard) {
  const fromName = extensionOf(shard.filename || "");
  if (fromName === "jpg" || fromName === "jpeg") return "jpg";
  if (fromName === "png" || fromName === "webp") return fromName;
  const mime = text(shard.mime);
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  return "jpg";
}

function mimeFromName(name) {
  const ext = extensionOf(name || "");
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  return "";
}

function photoName(used, id, ext) {
  const base = safeId(id);
  let name = `photos/${base}.${ext}`;
  let n = 2;
  while (used.has(name)) {
    name = `photos/${base}-${n}.${ext}`;
    n += 1;
  }
  used.add(name);
  return name;
}

// A path inside the zip. One folder, no climbing out.
function photoPathOk(path) {
  const rel = normalize(path);
  if (!rel || rel.includes("..")) return "";
  const parts = rel.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) return "";
  if (parts[0] !== "photos" || parts.length !== 2) return "";
  return rel;
}

async function asBytes(value) {
  if (!value) return null;
  if (value instanceof Uint8Array) return value.byteLength ? value : null;
  if (value instanceof ArrayBuffer) return value.byteLength ? new Uint8Array(value) : null;
  if (ArrayBuffer.isView(value)) {
    const view = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return view.byteLength ? view : null;
  }
  if (typeof value.arrayBuffer === "function") {
    const buf = await value.arrayBuffer();
    return buf.byteLength ? new Uint8Array(buf) : null;
  }
  return null;
}

function ordered(shard, photo) {
  const out = {};
  for (const key of PACK_FIELDS) {
    if (shard[key] !== undefined) out[key] = shard[key];
  }
  if (photo) out.photo = photo;
  return out;
}

// Photographs are stored, not recompressed. JPEG and PNG already are.
export async function buildPack(shards, photos) {
  const files = {};
  const used = new Set();
  const out = [];
  for (const row of shards || []) {
    const shard = pickShard(row);
    if (!shard) continue;
    const raw = await asBytes(photos?.get?.(row.id) || photos?.get?.(shard.id));
    let photo = "";
    if (shard.hasPhoto && raw) {
      photo = photoName(used, shard.id, extOf(shard));
      files[photo] = raw;
    } else {
      shard.hasPhoto = false;
    }
    out.push(ordered(shard, photo));
  }
  const json = `${JSON.stringify({ v: 1, kind: KIND, shards: out }, null, 2)}\n`;
  files["library.json"] = strToU8(json);
  return zipSync(files, { level: 0 });
}

export function parseLibrary(raw) {
  let data;
  try {
    data = JSON.parse(text(raw).replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
  if (!data || data.v !== 1 || data.kind !== KIND || !Array.isArray(data.shards)) return null;
  return { v: 1, kind: KIND, shards: data.shards };
}

function claimsPack(raw) {
  return text(raw).includes(`"${KIND}"`);
}

function tryUnzip(bytes) {
  try {
    return unzipSync(bytes);
  } catch {
    return null;
  }
}

function fileMap(unzipped) {
  const map = new Map();
  for (const [raw, bytes] of Object.entries(unzipped || {})) {
    const key = normalize(raw);
    if (!key || key.includes("..") || junkPath(key)) continue;
    map.set(key, bytes);
  }
  return map;
}

function attachPhoto(shard, row, map, root, photos) {
  const rel = photoPathOk(row?.photo);
  if (!shard.hasPhoto || !rel) {
    shard.hasPhoto = false;
    return shard;
  }
  const full = root ? `${normalize(root)}/${rel}` : rel;
  const bytes = map.get(full);
  if (!bytes?.byteLength) {
    shard.hasPhoto = false;
    return shard;
  }
  photos.set(shard.id, bytes);
  shard.photo = rel;
  return shard;
}

// null: this zip is not a letter pack. unreadable: it claimed to be one.
export function readPack(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (!data.byteLength) return null;
  const unzipped = tryUnzip(data);
  if (!unzipped) return null;
  const map = fileMap(unzipped);
  const jsonKeys = [...map.keys()].filter((key) => isLibraryName(key)).sort();
  if (!jsonKeys.length) return null;

  const found = [];
  for (const key of jsonKeys) {
    const doc = parseLibrary(strFromU8(map.get(key)));
    if (doc) found.push({ key, doc });
  }
  if (!found.length) return { unreadable: true, shards: [], photos: new Map() };

  const shards = [];
  const photos = new Map();
  for (const { key, doc } of found) {
    const root = directoryOf(key);
    for (const row of doc.shards) {
      const shard = pickShard(row);
      if (!shard) continue;
      shards.push(attachPhoto(shard, row, map, root, photos));
    }
  }
  return { unreadable: false, shards, photos };
}

// Drafts for rememberShards. The id stays, so a marks file still points here.
// A different letter already using that id gets a fresh one.
// `photos` may be raw bytes or a Blob.
export async function restoreDrafts(shards, photos, existing = [], { createId = createImportId } = {}) {
  const ids = new Set();
  const rows = [];
  for (const row of existing || []) {
    if (!row) continue;
    const id = row.id == null ? "" : text(row.id);
    if (id) ids.add(id);
    rows.push({
      id,
      fingerprint: row.fingerprint ? text(row.fingerprint) : "",
      placeholder: Boolean(row.placeholder),
    });
  }

  const drafts = [];
  const blobs = new Map();
  for (const source of shards || []) {
    const draft = pickShard(source);
    if (!draft) continue;
    const sourceId = draft.id;
    if (!draft.fingerprint) draft.fingerprint = sourceId ? `letter|${sourceId}` : "";
    if (!draft.fingerprint) continue;

    const prev = rows.find((row) => row.fingerprint && row.fingerprint === draft.fingerprint);
    if (!prev && sourceId && ids.has(sourceId)) draft.id = createId();
    if (!draft.id) draft.id = createId();

    const raw = await asBytes(photos?.get?.(sourceId) || photos?.get?.(draft.id) || null);
    if (draft.hasPhoto && raw?.byteLength) {
      const type = draft.mime || mimeFromName(draft.filename) || "application/octet-stream";
      blobs.set(draft.id, new Blob([raw], { type }));
    } else {
      draft.hasPhoto = false;
    }

    ids.add(draft.id);
    rows.push({
      id: draft.id,
      fingerprint: draft.fingerprint,
      placeholder: draft.placeholder,
    });
    drafts.push(draft);
  }
  return { drafts, blobs };
}

function isZipEntry(entry) {
  const name = entry?.name || entry?.relativePath || "";
  const type = entry?.type || entry?.file?.type || "";
  return isZipName(name, type);
}

async function readEntryBytes(entry) {
  const file = entry?.file;
  if (!file || typeof file.arrayBuffer !== "function") return null;
  return new Uint8Array(await file.arrayBuffer());
}

async function readEntryText(entry) {
  const file = entry?.file;
  if (file && typeof file.text === "function") return file.text();
  const bytes = await readEntryBytes(entry);
  return bytes ? strFromU8(bytes) : "";
}

function joinPath(root, rel) {
  const left = normalize(root);
  const right = normalize(rel);
  return left ? `${left}/${right}` : right;
}

function findPhoto(entries, consumed, expected) {
  const want = normalize(expected);
  const base = want.split("/").pop();
  let loose = null;
  let looseCount = 0;
  for (const entry of entries) {
    if (consumed.has(entry)) continue;
    const rel = normalize(entry.relativePath || entry.name || "");
    if (rel === want || rel.endsWith(`/${want}`)) return entry;
    if (rel.split("/").pop() === base) {
      looseCount += 1;
      loose = entry;
    }
  }
  return looseCount === 1 ? loose : null;
}

// A zip, or a folder that still has library.json beside photos/.
export async function peelLetterPacks(entries) {
  const list = [...(entries || [])];
  const consumed = new Set();
  const restores = [];
  let unreadable = 0;

  for (const entry of list) {
    if (!isZipEntry(entry)) continue;
    try {
      const bytes = await readEntryBytes(entry);
      const pack = bytes ? readPack(bytes) : null;
      if (!pack) continue;
      consumed.add(entry);
      if (pack.unreadable) {
        unreadable += 1;
        continue;
      }
      restores.push(pack);
    } catch {
      // Leave it. The usual intake will skip a zip it cannot read.
    }
  }

  for (const entry of list) {
    if (consumed.has(entry)) continue;
    if (!isLibraryName(entry.name || entry.relativePath || "")) continue;
    let textBody = "";
    try {
      textBody = await readEntryText(entry);
    } catch {
      textBody = "";
    }
    const doc = parseLibrary(textBody);
    const root = directoryOf(entry.relativePath || entry.name || "");
    if (!doc) {
      if (!claimsPack(textBody)) continue;
      consumed.add(entry);
      const photosDir = root ? `${normalize(root)}/photos/` : "photos/";
      for (const other of list) {
        if (consumed.has(other)) continue;
        const rel = normalize(other.relativePath || other.name || "");
        if (rel.startsWith(photosDir)) consumed.add(other);
      }
      unreadable += 1;
      continue;
    }

    const photos = new Map();
    for (const shard of doc.shards) {
      if (!shard || shard.id == null) continue;
      const rel = photoPathOk(shard.photo);
      if (!rel) continue;
      const match = findPhoto(list, consumed, joinPath(root, rel));
      if (!match) continue;
      consumed.add(match);
      try {
        const bytes = await readEntryBytes(match);
        if (bytes?.byteLength) photos.set(text(shard.id), bytes);
      } catch {
        // The words can still come back.
      }
    }
    consumed.add(entry);
    restores.push({ unreadable: false, shards: doc.shards, photos });
  }

  return {
    restores,
    rest: list.filter((entry) => !consumed.has(entry)),
    unreadable,
  };
}

export function describeLetters({ added = 0, updated = 0, duplicate = 0 } = {}) {
  if (!added && !updated && !duplicate) return "";
  if (!added && !updated && duplicate) {
    return duplicate === 1 ? "Already in the pool." : "Those are already in the pool.";
  }
  if (!added && updated) {
    let line = updated === 1 ? "A placeholder grew a note." : `${updated} placeholders grew notes.`;
    if (duplicate) line += duplicate === 1 ? " One was already here." : ` ${duplicate} were already here.`;
    return line;
  }
  let line = added === 1 ? "1 letter. In the pool." : `${added} letters. In the pool.`;
  if (duplicate) line += duplicate === 1 ? " One was already here." : ` ${duplicate} were already here.`;
  if (updated === 1) line += " A placeholder grew a note.";
  else if (updated > 1) line += ` ${updated} placeholders grew notes.`;
  return line;
}
