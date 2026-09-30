import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { strFromU8, unzipSync } from "fflate";
import { createEmbedCache, textFingerprint } from "./embed-cache.js";
import { draftNote, vibeFromNote } from "./ingest.js";
import { CACHE_MODEL as NOTE_MODEL } from "./meaning.js";
import { readPack } from "./pack.js";
import { JOBS, SHARDS } from "./shards.js";
import { explainShard, prepareJobs, prepareShards, shardDocument } from "./ranker.js";
import { CACHE_MODEL as IMAGE_MODEL } from "./vision.js";
import { canReviseNote, editorSeed, reviseOwnNote } from "./revise.js";

const memory = new Map();
globalThis.localStorage = {
  getItem(key) {
    return memory.has(key) ? memory.get(key) : null;
  },
  setItem(key, value) {
    memory.set(key, String(value));
  },
  removeItem(key) {
    memory.delete(key);
  },
};

function installFakeIndexedDB() {
  const dbs = new Map();

  function ensure(name) {
    if (!dbs.has(name)) dbs.set(name, { names: new Set(), stores: new Map() });
    return dbs.get(name);
  }

  globalThis.indexedDB = {
    open(name) {
      const req = {};
      queueMicrotask(() => {
        const record = ensure(name);
        const db = {
          objectStoreNames: {
            contains: (store) => record.names.has(store),
          },
          createObjectStore(store) {
            record.names.add(store);
            if (!record.stores.has(store)) record.stores.set(store, new Map());
          },
          transaction(store) {
            const rows = record.stores.get(store);
            const tx = {
              objectStore() {
                if (!rows) throw new Error(`missing store ${store}`);
                return {
                  put(value, key) {
                    rows.set(key, value);
                  },
                  get(key) {
                    const getReq = {};
                    queueMicrotask(() => {
                      getReq.result = rows.has(key) ? rows.get(key) : undefined;
                      if (getReq.onsuccess) getReq.onsuccess();
                    });
                    return getReq;
                  },
                  delete(key) {
                    rows.delete(key);
                  },
                };
              },
            };
            queueMicrotask(() => {
              if (tx.oncomplete) tx.oncomplete();
            });
            return tx;
          },
        };
        req.result = db;
        if (record.names.size === 0 && req.onupgradeneeded) req.onupgradeneeded();
        if (req.onsuccess) req.onsuccess();
      });
      return req;
    },
  };
}

installFakeIndexedDB();
const library = await import("./library.js");

const META_KEY = "remember.library.v0";
const MARKS_KEY = "remember.feedback.v0";
const MIX_KEY = "remember.weights.v0";
const MARKS = '{"v":1,"log":[{"shardId":"import-1","job":"soft","action":"like"}]}';
const MIX = '{"v":3,"jobs":{"soft":{"job":0.5}}}';

function own(over = {}) {
  return {
    id: "import-1",
    imported: true,
    note: "We shipped it on a cold night.",
    why: "You asked for a push. This is a day you already lived through.",
    date: "2024-01-04",
    vibe: vibeFromNote("We shipped it on a cold night."),
    photoAlt: "A photo you kept — porch",
    hasPhoto: true,
    filename: "porch.jpg",
    fingerprint: "porch.jpg|40|10",
    placeholder: false,
    ...over,
  };
}

function paper(over = {}) {
  return own({
    id: "import-2",
    note: "Sam laughed at dinner.",
    why: "Before the room fills up — someone from your own life is here.",
    vibe: vibeFromNote("Sam laughed at dinner."),
    photoAlt: "A letter without a photograph",
    hasPhoto: false,
    filename: "",
    noteName: "dinner.txt",
    fingerprint: "dinner.txt|12|9",
    ...over,
  });
}

function placeholderPhoto() {
  return own({
    note: draftNote(),
    vibe: vibeFromNote(draftNote()),
    placeholder: true,
  });
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

function noteQuery(shard) {
  return {
    kind: "note",
    id: shard.id,
    model: NOTE_MODEL,
    fingerprint: textFingerprint(shardDocument(shard)),
    dim: 3,
  };
}

const when = Date.parse("2024-06-01T00:00:00Z");

function score(shard, jobId) {
  const job = prepareJobs(JOBS).find((item) => item.id === jobId);
  const prepared = prepareShards([shard])[0];
  return explainShard(prepared, { job, now: when, shown: {}, log: [] });
}

async function emptyLibrary() {
  for (const row of [...library.list()]) await library.forget(row.id);
  memory.clear();
  delete globalThis.__rememberLibrary;
  await library.hydrate();
}

function savedNote(id) {
  const meta = JSON.parse(localStorage.getItem(META_KEY));
  return meta.shards.find((row) => row.id === id);
}

describe("revising your own note", () => {
  it("refuses sample letters", () => {
    assert.equal(canReviseNote(SHARDS[0]), false);
    assert.equal(reviseOwnNote(SHARDS[0], "Quiet rain on Sunday."), null);
    assert.equal(reviseOwnNote({ ...own(), imported: false }, "Quiet rain."), null);
    assert.equal(reviseOwnNote(null, "Quiet rain."), null);
    assert.equal(reviseOwnNote({ imported: true, note: "x" }, "Quiet rain."), null);
  });

  it("clears a placeholder and refreshes the vibe from the new words", () => {
    const shard = placeholderPhoto();
    const next = "Quiet rain on the window. Sunday, and I was just here.";
    const revision = reviseOwnNote(shard, `  ${next}  \n`);
    assert.ok(revision);
    assert.equal(revision.id, shard.id);
    assert.equal(revision.note, next);
    assert.equal(revision.placeholder, false);
    assert.equal(revision.wordsChanged, true);
    assert.deepEqual(revision.vibe, vibeFromNote(next));
    assert.ok(revision.vibe[1] > revision.vibe[0]);
    assert.ok(revision.vibe[1] > shard.vibe[1]);
    assert.notEqual(revision.fingerprint, textFingerprint(shardDocument(shard)));
    assert.equal(revision.fingerprint, textFingerprint(shardDocument({ ...shard, note: next })));
  });

  it("revises a note-only paper letter", () => {
    const shard = paper();
    const revision = reviseOwnNote(shard, "Uncle Jo’s laugh is the loud one at dinner.");
    assert.equal(revision.placeholder, false);
    assert.equal(revision.wordsChanged, true);
    assert.ok(revision.vibe[2] > revision.vibe[0]);
    assert.equal(canReviseNote(shard), true);
  });

  it("leaves an unchanged note alone, including cleaned whitespace", () => {
    const shard = own();
    assert.equal(reviseOwnNote(shard, shard.note), null);
    assert.equal(reviseOwnNote(shard, ` \n${shard.note}\n `), null);
  });

  it("restores the placeholder draft when the note is emptied", () => {
    const shard = own();
    for (const text of ["", "   \n\t  ", null]) {
      const revision = reviseOwnNote(shard, text);
      assert.equal(revision.note, draftNote());
      assert.equal(revision.placeholder, true);
      assert.equal(revision.wordsChanged, true);
      assert.deepEqual(revision.vibe, vibeFromNote(draftNote()));
      assert.equal(revision.id, shard.id);
    }
    const already = placeholderPhoto();
    assert.equal(reviseOwnNote(already, "  "), null);
  });

  it("keeps the draft words when they are typed on purpose, and clears the flag", () => {
    const shard = placeholderPhoto();
    const revision = reviseOwnNote(shard, draftNote());
    assert.equal(revision.note, draftNote());
    assert.equal(revision.placeholder, false);
    assert.equal(revision.wordsChanged, false);
    assert.equal(revision.fingerprint, textFingerprint(shardDocument(shard)));
  });

  it("opens a placeholder blank and a written note as itself", () => {
    const blank = editorSeed(placeholderPhoto());
    assert.equal(blank.value, "");
    assert.equal(blank.placeholder, draftNote());
    const written = editorSeed(own());
    assert.equal(written.value, own().note);
    assert.equal(written.placeholder, draftNote());
    const typedDraft = editorSeed({ ...placeholderPhoto(), placeholder: false });
    assert.equal(typedDraft.value, draftNote());
  });

  it("ranks the soft job from the new words, not the placeholder", () => {
    const before = placeholderPhoto();
    const revision = reviseOwnNote(before, "Quiet rain. A slow Sunday at the window.");
    const after = { ...before, note: revision.note, vibe: revision.vibe, placeholder: false };
    const prior = score(before, "soft");
    const next = score(after, "soft");
    assert.ok(next.vibe > prior.vibe);
    assert.ok(next.text > prior.text);
    assert.ok(next.total > prior.total);
  });

  it("invalidates the MiniLM note vector and leaves the photograph", async () => {
    const before = placeholderPhoto();
    const revision = reviseOwnNote(before, "Quiet rain on the window.");
    const after = { ...before, note: revision.note };
    const cache = createEmbedCache(memoryStore());
    await cache.remember({ ...noteQuery(before), vector: [1, 0, 0] });
    await cache.remember({
      kind: "image",
      id: before.id,
      model: IMAGE_MODEL,
      fingerprint: "photo:9",
      dim: 2,
      vector: [0, 1],
    });

    assert.equal(await cache.recall(noteQuery(after)), null);
    assert.deepEqual(await cache.recall(noteQuery(before)), [1, 0, 0]);
    assert.equal(await cache.forgetNote(before.id), true);
    assert.equal(await cache.recall(noteQuery(before)), null);
    assert.deepEqual(
      await cache.recall({
        kind: "image",
        id: before.id,
        model: IMAGE_MODEL,
        fingerprint: "photo:9",
        dim: 2,
      }),
      [0, 1],
    );
    assert.equal(revision.fingerprint, noteQuery(after).fingerprint);
  });
});

describe("saving a revised note", { concurrency: 1 }, () => {
  it("persists the note, clears the placeholder, and keeps the photograph", async () => {
    await emptyLibrary();
    localStorage.setItem(MARKS_KEY, MARKS);
    localStorage.setItem(MIX_KEY, MIX);
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd0, 4, 5, 6, 0xff, 0xd9]);
    const draft = placeholderPhoto();
    delete draft.imported;
    await library.rememberShards([draft], new Map([[draft.id, new Blob([jpeg])]]));

    const live = library.list().find((row) => row.id === draft.id);
    assert.equal(live.imported, true);
    assert.equal(live.placeholder, true);
    const revision = reviseOwnNote(live, "Quiet rain on the window this Sunday.");
    const saved = library.updateShard(revision.id, {
      note: revision.note,
      vibe: revision.vibe,
      placeholder: revision.placeholder,
    });

    assert.equal(saved.note, revision.note);
    assert.equal(saved.placeholder, false);
    assert.deepEqual(saved.vibe, revision.vibe);
    assert.equal(saved.hasPhoto, true);
    assert.equal(savedNote(draft.id).note, revision.note);
    assert.equal(savedNote(draft.id).placeholder, false);
    assert.deepEqual(savedNote(draft.id).vibe, revision.vibe);
    assert.equal(localStorage.getItem(MARKS_KEY), MARKS);
    assert.equal(localStorage.getItem(MIX_KEY), MIX);

    const still = new Uint8Array(await (await library.readPhoto(draft.id)).arrayBuffer());
    assert.deepEqual(still, jpeg);

    await library.hydrate();
    const reloaded = library.list().find((row) => row.id === draft.id);
    assert.equal(reloaded.note, revision.note);
    assert.equal(reloaded.placeholder, false);
    assert.deepEqual(reloaded.vibe, revision.vibe);
    assert.equal(reloaded.imported, true);
  });

  it("carries the edited note through a letter pack, including paper", async () => {
    await emptyLibrary();
    const photo = placeholderPhoto();
    const letter = paper({ placeholder: true, note: draftNote(), vibe: vibeFromNote(draftNote()) });
    delete photo.imported;
    delete letter.imported;
    const jpeg = new Uint8Array([1, 2, 3, 4, 5]);
    await library.rememberShards([photo, letter], new Map([[photo.id, new Blob([jpeg])]]));

    for (const row of library.list()) {
      const body = row.hasPhoto ? "Rain on the window. A quiet Sunday." : "Dinner with Sam. He laughed.";
      const revision = reviseOwnNote(row, body);
      library.updateShard(revision.id, {
        note: revision.note,
        vibe: revision.vibe,
        placeholder: revision.placeholder,
      });
    }

    const bytes = await library.exportLetters();
    const unzipped = unzipSync(bytes);
    const json = strFromU8(unzipped["library.json"]);
    assert.match(json, /Rain on the window/);
    assert.match(json, /Dinner with Sam/);
    const pack = readPack(bytes);
    assert.equal(pack.shards.length, 2);
    const packedPhoto = pack.shards.find((row) => row.id === photo.id);
    const packedPaper = pack.shards.find((row) => row.id === letter.id);
    assert.equal(packedPhoto.placeholder, false);
    assert.equal(packedPaper.placeholder, false);
    assert.equal(packedPhoto.hasPhoto, true);
    assert.equal(packedPaper.hasPhoto, false);

    for (const row of [...library.list()]) await library.forget(row.id);
    memory.clear();
    await library.hydrate();
    const brought = await library.bringLetters(pack.shards, pack.photos);
    assert.equal(brought.added.length, 2);
    const backPhoto = library.list().find((row) => row.fingerprint === photo.fingerprint);
    const backPaper = library.list().find((row) => row.fingerprint === letter.fingerprint);
    assert.equal(backPhoto.note, "Rain on the window. A quiet Sunday.");
    assert.equal(backPhoto.placeholder, false);
    assert.equal(backPaper.note, "Dinner with Sam. He laughed.");
    assert.equal(backPaper.placeholder, false);
    assert.deepEqual(new Uint8Array(await (await library.readPhoto(backPhoto.id)).arrayBuffer()), jpeg);
  });
});
