import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { draftNote } from "./ingest.js";
import { isKept } from "./marks.js";
import { SHARDS } from "./shards.js";
import {
  LETTER_PACK_NAME,
  PACK_FIELDS,
  buildPack,
  describeLetters,
  peelLetterPacks,
  readPack,
  restoreDrafts,
} from "./pack.js";

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

  return {
    store(dbName, storeName) {
      return dbs.get(dbName)?.stores.get(storeName) || null;
    },
  };
}

const fake = installFakeIndexedDB();
const library = await import("./library.js");
const store = await import("./store.js");

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd0, 4, 5, 6, 0xff, 0xd9]);

function letter(over = {}) {
  return {
    id: "import-1",
    note: "I laughed with Sam at dinner.",
    why: "Before the room fills up, someone from your own life is here.",
    date: "2023-11-02",
    vibe: [0.2, 0.3, 0.84],
    photoAlt: "A photo you kept — porch",
    hasPhoto: true,
    filename: "porch.jpg",
    noteName: "porch.txt",
    fingerprint: "porch.jpg|40|10",
    placeholder: false,
    mime: "image/jpeg",
    ...over,
  };
}

function paper(over = {}) {
  return letter({
    id: "import-2",
    note: "Sunday. Quiet rain. I was just here.",
    why: "Not a highlight. A texture from a day that was yours.",
    date: "2024-05-09",
    vibe: [0.12, 0.8, 0.2],
    photoAlt: "A letter without a photograph",
    hasPhoto: false,
    filename: "",
    noteName: "sunday.txt",
    fingerprint: "sunday.txt|12|9",
    mime: "",
    ...over,
  });
}

function fileEntry(relativePath, bytes, type = "") {
  const name = relativePath.split("/").pop();
  const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  return {
    name,
    relativePath,
    type,
    size: data.byteLength,
    lastModified: 1,
    file: new Blob([data], { type }),
  };
}

function zipEntry(bytes, name = LETTER_PACK_NAME) {
  return fileEntry(name, bytes, "application/zip");
}

function savedMeta() {
  return JSON.parse(localStorage.getItem("remember.library.v0"));
}

async function photoBytes(id) {
  const blob = await library.readPhoto(id);
  if (!blob) return null;
  return new Uint8Array(await blob.arrayBuffer());
}

function stampMarks() {
  const snapshot = {
    "remember.feedback.v0": '{"v":1,"log":[{"shardId":"import-1","action":"like"}]}',
    "remember.weights.v0": '{"v":3,"jobs":{"push":{"job":0.5}}}',
    "remember.shown.v0": '{"push-run":1710000000000}',
  };
  for (const [key, value] of Object.entries(snapshot)) localStorage.setItem(key, value);
  return snapshot;
}

function assertMarks(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    assert.equal(localStorage.getItem(key), value);
  }
}

async function emptyLibrary() {
  for (const row of [...library.list()]) await library.forget(row.id);
  memory.clear();
  delete globalThis.__rememberShown;
  delete globalThis.__rememberWeights;
  delete globalThis.__rememberFeedback;
  fake.store("remember", "photos")?.clear();
  fake.store("remember", "embeddings")?.clear();
  store.loadShown();
  await library.hydrate();
}

describe("letter pack", { concurrency: 1 }, () => {
  it("builds a pack of words and photographs, without embeddings or sample fields", async () => {
    assert.deepEqual(library.LETTER_FIELDS, PACK_FIELDS);
    assert.equal(LETTER_PACK_NAME, "remember-letters.zip");
    for (const key of ["note", "date", "vibe", "fingerprint", "filename", "hasPhoto", "noteName"]) {
      assert.ok(PACK_FIELDS.includes(key));
    }

    const row = letter({
      embedding: [1, 2, 3],
      imageVec: [1, 0, 0],
      imported: true,
      photo: "https://images.unsplash.com/photo-1",
    });
    const bytes = await buildPack([row, paper()], new Map([[row.id, jpeg]]));
    assert.equal(row.photo, "https://images.unsplash.com/photo-1");
    assert.equal(row.hasPhoto, true);

    const unzipped = unzipSync(bytes);
    assert.deepEqual(Object.keys(unzipped).sort(), ["library.json", "photos/import-1.jpg"]);
    assert.deepEqual(unzipped["photos/import-1.jpg"], jpeg);

    const doc = JSON.parse(strFromU8(unzipped["library.json"]));
    assert.equal(doc.v, 1);
    assert.equal(doc.kind, "remember-letters");
    assert.deepEqual(Object.keys(doc).sort(), ["kind", "shards", "v"]);
    const text = JSON.stringify(doc);
    assert.equal(text.includes("unsplash"), false);
    assert.equal(text.includes("embedding"), false);
    assert.equal(text.includes("imageVec"), false);
    for (const sample of SHARDS) assert.equal(text.includes(`"${sample.id}"`), false);

    const photo = doc.shards[0];
    assert.equal(photo.note, row.note);
    assert.equal(photo.date, row.date);
    assert.deepEqual(photo.vibe, row.vibe);
    assert.equal(photo.fingerprint, row.fingerprint);
    assert.equal(photo.filename, "porch.jpg");
    assert.equal(photo.noteName, "porch.txt");
    assert.equal(photo.hasPhoto, true);
    assert.equal(photo.mime, "image/jpeg");
    assert.equal(photo.placeholder, false);
    assert.equal(photo.photo, "photos/import-1.jpg");
    assert.equal("embedding" in photo, false);

    const note = doc.shards[1];
    assert.equal(note.hasPhoto, false);
    assert.equal(note.photo, undefined);
    assert.equal(note.note, paper().note);
    assert.equal(note.noteName, "sunday.txt");
    assert.equal(note.fingerprint, "sunday.txt|12|9");
  });

  it("round-trips a stored zip, a deflated rezip, and a folder wrapped around the files", async () => {
    const stored = await buildPack([letter()], new Map([["import-1", jpeg]]));
    const files = unzipSync(stored);
    const deflated = readPack(zipSync(files, { level: 9 }));
    assert.equal(deflated.shards[0].note, letter().note);
    assert.equal(deflated.shards[0].fingerprint, letter().fingerprint);
    assert.equal(deflated.state, null);
    assert.deepEqual(deflated.photos.get("import-1"), jpeg);

    const nested = {};
    for (const [name, data] of Object.entries(files)) nested[`take-home/${name}`] = data;
    nested["__MACOSX/._library.json"] = strToU8("nope");
    nested["take-home/.DS_Store"] = strToU8("x");
    const pack = readPack(zipSync(nested, { level: 0 }));
    assert.equal(pack.unreadable, false);
    assert.equal(pack.shards.length, 1);
    assert.equal(pack.shards[0].date, "2023-11-02");
    assert.deepEqual(pack.photos.get("import-1"), jpeg);

    const empty = readPack(await buildPack([], new Map()));
    assert.deepEqual(empty.shards, []);
    assert.equal(empty.photos.size, 0);
  });

  it("keeps a climbing path from grabbing some other file", async () => {
    const weird = letter({ id: "import/../weird id" });
    const safe = await buildPack([weird], new Map([[weird.id, jpeg]]));
    const keys = Object.keys(unzipSync(safe));
    assert.ok(keys.every((key) => !key.split("/").includes("..")));
    assert.equal(keys.filter((key) => key.startsWith("photos/")).length, 1);
    assert.deepEqual(readPack(safe).photos.get(weird.id), jpeg);

    const malicious = zipSync(
      {
        "library.json": strToU8(
          JSON.stringify({
            v: 1,
            kind: "remember-letters",
            shards: [{ ...letter(), photo: "../secret.txt" }],
          }),
        ),
        "secret.txt": strToU8("nope"),
        "photos/import-1.jpg": jpeg,
      },
      { level: 0 },
    );
    const pack = readPack(malicious);
    assert.equal(pack.unreadable, false);
    assert.equal(pack.photos.size, 0);
    assert.equal(pack.shards[0].hasPhoto, false);
    assert.equal(pack.shards[0].note, letter().note);
  });

  it("says what came back, in the same quiet voice as a drop", () => {
    assert.equal(describeLetters({}), "");
    assert.equal(describeLetters({ added: 1 }), "1 letter. In the pool.");
    assert.equal(describeLetters({ added: 2 }), "2 letters. In the pool.");
    assert.equal(describeLetters({ duplicate: 1 }), "Already in the pool.");
    assert.equal(describeLetters({ duplicate: 2 }), "Those are already in the pool.");
    assert.equal(describeLetters({ updated: 1 }), "A placeholder grew a note.");
    assert.equal(
      describeLetters({ added: 1, duplicate: 1, updated: 1 }),
      "1 letter. In the pool. One was already here. A placeholder grew a note.",
    );
  });

  it("peels a zip or a folder, and leaves ordinary files for the usual intake", async () => {
    const bytes = await buildPack([letter()], new Map([["import-1", jpeg]]));
    const files = unzipSync(bytes);
    const zipped = await peelLetterPacks([
      zipEntry(bytes),
      fileEntry("sunday.txt", "Quiet rain.", "text/plain"),
    ]);
    assert.equal(zipped.rest.length, 1);
    assert.equal(zipped.rest[0].name, "sunday.txt");
    assert.equal(zipped.unreadable, 0);
    assert.equal(zipped.restores[0].shards[0].fingerprint, letter().fingerprint);
    assert.deepEqual(zipped.restores[0].photos.get("import-1"), jpeg);

    const folder = await peelLetterPacks([
      ...Object.entries(files).map(([name, data]) => fileEntry(`take-home/${name}`, data)),
      fileEntry("take-home/extra.txt", "not the pack"),
    ]);
    assert.equal(folder.rest.length, 1);
    assert.equal(folder.rest[0].name, "extra.txt");
    assert.deepEqual(folder.restores[0].photos.get("import-1"), jpeg);

    const flat = await peelLetterPacks([
      fileEntry("library.json", files["library.json"], "application/json"),
      fileEntry("import-1.jpg", files["photos/import-1.jpg"], "image/jpeg"),
    ]);
    assert.equal(flat.rest.length, 0);
    assert.deepEqual(flat.restores[0].photos.get("import-1"), jpeg);

    const other = zipSync({ "readme.txt": strToU8("hi") }, { level: 0 });
    const left = await peelLetterPacks([
      zipEntry(other, "photos.zip"),
      fileEntry("note.txt", "hello"),
    ]);
    assert.equal(left.restores.length, 0);
    assert.equal(left.unreadable, 0);
    assert.equal(left.rest.length, 2);

    const garbage = await peelLetterPacks([
      fileEntry("nope.zip", new Uint8Array([1, 2, 3, 4]), "application/zip"),
    ]);
    assert.equal(garbage.rest.length, 1);
    assert.equal(garbage.restores.length, 0);

    const future = zipSync(
      {
        "library.json": strToU8(JSON.stringify({ v: 2, kind: "remember-letters", shards: [] })),
      },
      { level: 0 },
    );
    const unread = await peelLetterPacks([zipEntry(future)]);
    assert.equal(unread.unreadable, 1);
    assert.equal(unread.rest.length, 0);
    assert.equal(unread.restores.length, 0);

    const broken = await peelLetterPacks([
      fileEntry(
        "backup/library.json",
        JSON.stringify({ v: 2, kind: "remember-letters" }),
        "application/json",
      ),
      fileEntry("backup/photos/import-1.jpg", jpeg, "image/jpeg"),
      fileEntry("backup/note.txt", "hello"),
    ]);
    assert.equal(broken.unreadable, 1);
    assert.equal(broken.restores.length, 0);
    assert.equal(broken.rest.length, 1);
    assert.equal(broken.rest[0].name, "note.txt");

    const climbed = await peelLetterPacks([
      fileEntry(
        "library.json",
        JSON.stringify({
          v: 1,
          kind: "remember-letters",
          shards: [{ ...letter(), photo: "../secret.txt" }],
        }),
      ),
      fileEntry("secret.txt", "nope"),
    ]);
    assert.equal(climbed.rest.length, 1);
    assert.equal(climbed.rest[0].name, "secret.txt");
    assert.equal(climbed.restores[0].photos.size, 0);
    const prepared = await restoreDrafts(climbed.restores[0].shards, climbed.restores[0].photos, []);
    assert.equal(prepared.drafts[0].hasPhoto, false);
    assert.equal(prepared.drafts[0].note, letter().note);
  });

  it("mints a new id when that id already belongs to a different letter", async () => {
    const existing = [{ id: "import-1", fingerprint: "porch.jpg|40|10", placeholder: false }];
    const same = await restoreDrafts([letter()], new Map(), existing, {
      createId: () => {
        throw new Error("minted");
      },
    });
    assert.equal(same.drafts[0].id, "import-1");

    const otherBytes = new Uint8Array([7, 7, 7]);
    const moved = await restoreDrafts(
      [letter({ fingerprint: "other.jpg|2|2", filename: "other.jpg", note: "Another day." })],
      new Map([["import-1", otherBytes]]),
      existing,
      { createId: () => "import-2" },
    );
    assert.equal(moved.drafts[0].id, "import-2");
    assert.equal(moved.blobs.has("import-2"), true);
    assert.equal(moved.blobs.has("import-1"), false);
    assert.equal(moved.blobs.get("import-2").type, "image/jpeg");

    const fromBlob = await restoreDrafts([letter({ id: "import-3", fingerprint: "blob.jpg|3|3" })], new Map([["import-3", new Blob([jpeg], { type: "image/jpeg" })]]), []);
    assert.equal(fromBlob.drafts[0].hasPhoto, true);
    assert.equal(fromBlob.blobs.get("import-3").type, "image/jpeg");
    assert.deepEqual(new Uint8Array(await fromBlob.blobs.get("import-3").arrayBuffer()), jpeg);
  });

  it("restores words and photographs, and sets samples aside on the first letter", async () => {
    await emptyLibrary();
    const marks = stampMarks();
    const bytes = await buildPack([letter(), paper()], new Map([["import-1", jpeg]]));
    const peeled = await peelLetterPacks([zipEntry(bytes)]);
    const result = await library.bringLetters(peeled.restores[0].shards, peeled.restores[0].photos);

    assert.equal(result.added.length, 2);
    assert.equal(library.includeSamplesOn(), false);
    assert.deepEqual(
      library.rankingPool([{ id: "push-run" }]).map((shard) => shard.id),
      ["import-1", "import-2"],
    );
    const meta = savedMeta();
    assert.equal(meta.includeSamples, false);
    assert.equal(meta.shards[0].note, letter().note);
    assert.equal(meta.shards[0].date, "2023-11-02");
    assert.deepEqual(meta.shards[0].vibe, letter().vibe);
    assert.equal(meta.shards[0].fingerprint, letter().fingerprint);
    assert.equal(meta.shards[0].hasPhoto, true);
    assert.equal(meta.shards[0].photo, undefined);
    assert.equal(meta.shards[1].note, paper().note);
    assert.equal(meta.shards[1].hasPhoto, false);
    assert.deepEqual(await photoBytes("import-1"), jpeg);
    assert.equal((await library.readPhoto("import-1")).type, "image/jpeg");
    assert.equal(await photoBytes("import-2"), null);
    assertMarks(marks);
  });

  it("skips a letter already here, and leaves marks, weights, and shown times alone", async () => {
    await emptyLibrary();
    const marks = stampMarks();
    const pack = readPack(await buildPack([letter()], new Map([["import-1", jpeg]])));
    await library.bringLetters(pack.shards, pack.photos);
    assertMarks(marks);

    library.setIncludeSamples(true);
    const edited = readPack(
      await buildPack(
        [letter({ note: "A different day." })],
        new Map([["import-1", new Uint8Array([9, 9, 9])]]),
      ),
    );
    const again = await library.bringLetters(edited.shards, edited.photos);
    assert.equal(again.added.length, 0);
    assert.equal(again.duplicates.length, 1);
    assert.equal(library.list().length, 1);
    assert.equal(library.list()[0].id, "import-1");
    assert.equal(library.list()[0].note, letter().note);
    assert.deepEqual(await photoBytes("import-1"), jpeg);
    assert.equal(library.includeSamplesOn(), true);

    const extra = await library.bringLetters([paper()], new Map());
    assert.equal(extra.added.length, 1);
    assert.equal(library.includeSamplesOn(), true);
    assertMarks(marks);
  });

  it("lets a placeholder grow a note and keeps the photograph already stored", async () => {
    await emptyLibrary();
    const stub = letter({ note: draftNote(), placeholder: true, vibe: [0.5, 0.5, 0.5] });
    await library.bringLetters([stub], new Map([[stub.id, jpeg]]));
    const grown = letter({
      note: "Rain on the window.",
      placeholder: false,
      vibe: [0.1, 0.8, 0.2],
    });
    const pack = readPack(
      await buildPack([grown], new Map([[grown.id, new Uint8Array([8, 8, 8])]])),
    );
    const result = await library.bringLetters(pack.shards, pack.photos);
    assert.equal(result.updated.length, 1);
    assert.equal(result.added.length, 0);
    assert.equal(library.list().length, 1);
    assert.equal(library.list()[0].id, "import-1");
    assert.equal(library.list()[0].note, "Rain on the window.");
    assert.equal(library.list()[0].placeholder, false);
    assert.deepEqual(library.list()[0].vibe, [0.1, 0.8, 0.2]);
    assert.deepEqual(await photoBytes("import-1"), jpeg);
  });

  it("gives a different letter its own id when the packed id is already taken", async () => {
    await emptyLibrary();
    await library.bringLetters([letter()], new Map([["import-1", jpeg]]));
    const otherBytes = new Uint8Array([7, 7, 7, 7]);
    const other = letter({
      fingerprint: "other.jpg|2|2",
      filename: "other.jpg",
      note: "Another day.",
    });
    const result = await library.bringLetters([other], new Map([["import-1", otherBytes]]));
    assert.equal(result.added.length, 1);
    assert.notEqual(result.added[0].id, "import-1");
    assert.equal(library.list().length, 2);
    assert.deepEqual(await photoBytes("import-1"), jpeg);
    assert.deepEqual(await photoBytes(result.added[0].id), otherBytes);
  });

  it("exports the library and brings it back after the origin is wiped", async () => {
    await emptyLibrary();
    await library.bringLetters([letter(), paper()], new Map([["import-1", jpeg]]));
    fake.store("remember", "embeddings").set("import-1", { vector: [1, 2, 3, 4] });
    const exported = await library.exportLetters();
    const unzipped = unzipSync(exported);
    const keys = Object.keys(unzipped);
    assert.equal(keys.some((key) => key.includes("embed")), false);
    const text = strFromU8(unzipped["library.json"]);
    for (const sample of SHARDS) assert.equal(text.includes(`"${sample.id}"`), false);
    assert.equal(text.includes("vector"), false);
    assert.equal(fake.store("remember", "embeddings").has("import-1"), true);

    for (const row of [...library.list()]) await library.forget(row.id);
    assert.equal(library.list().length, 0);
    assert.equal(await photoBytes("import-1"), null);
    library.setIncludeSamples(true);

    const pack = readPack(exported);
    const brought = await library.bringLetters(pack.shards, pack.photos);
    assert.equal(brought.added.length, 2);
    assert.equal(library.includeSamplesOn(), false);
    assert.equal(library.list().find((shard) => shard.id === "import-1").note, letter().note);
    assert.equal(library.list().find((shard) => shard.id === "import-1").filename, "porch.jpg");
    assert.deepEqual(await photoBytes("import-1"), jpeg);
    assert.equal(library.list().find((shard) => shard.id === "import-2").hasPhoto, false);
    assert.equal(savedMeta().shards.length, 2);
  });

  it("drops a folder of the pack back into the library without inventing a second copy", async () => {
    await emptyLibrary();
    const bytes = await buildPack([letter()], new Map([["import-1", jpeg]]));
    const entries = Object.entries(unzipSync(bytes)).map(([name, data]) =>
      fileEntry(`take-home/${name}`, data),
    );
    const peeled = await peelLetterPacks(entries);
    assert.equal(peeled.rest.length, 0);
    const result = await library.bringLetters(peeled.restores[0].shards, peeled.restores[0].photos);
    assert.equal(result.added.length, 1);
    assert.equal(library.list().length, 1);
    assert.equal(library.list()[0].fingerprint, "porch.jpg|40|10");
    assert.deepEqual(await photoBytes("import-1"), jpeg);
  });

  it("keeps the words when the photograph bytes are already gone", async () => {
    await emptyLibrary();
    await library.bringLetters([letter()], new Map([["import-1", jpeg]]));
    fake.store("remember", "photos").delete("import-1");
    const pack = readPack(await library.exportLetters());
    assert.equal(pack.shards[0].hasPhoto, false);
    assert.equal(pack.photos.size, 0);
    assert.equal(pack.shards[0].note, letter().note);
    assert.equal(library.list()[0].hasPhoto, true);
    assert.equal(library.list()[0].note, letter().note);
  });

  it("round-trips marks, the mix, and shown times in the same zip", async () => {
    await emptyLibrary();
    await library.bringLetters([letter(), paper()], new Map([["import-1", jpeg]]));
    store.recordFeedback({
      shardId: "import-1",
      job: "push",
      action: "like",
      scores: { job: 0.4, freshness: 0.2, recency: 0.1, vibe: 0.3, text: 0.1 },
      timestamp: 100,
    });
    store.recordFeedback({
      shardId: "import-2",
      job: "push",
      action: "dislike",
      scores: { job: 0.1, freshness: 0.2, recency: 0.2, vibe: 0.1, text: 0.2 },
      timestamp: 200,
    });
    const mix = { job: 0.22, freshness: 0.4, recency: 0.15, vibe: 0.7, text: 0.25 };
    const report = { fittedOn: "all", at: 900 };
    store.saveJobMix("push", mix, report);
    store.markShown("import-1", 1_700_000_000_000);
    store.markShown("import-2", 1_700_000_100_000);

    const bytes = await library.exportLetters();
    const unzipped = unzipSync(bytes);
    assert.deepEqual(Object.keys(unzipped).sort(), [
      "library.json",
      "marks.json",
      "photos/import-1.jpg",
      "shown.json",
      "weights.json",
    ]);
    const packed = ["library.json", "marks.json", "weights.json", "shown.json"]
      .map((name) => strFromU8(unzipped[name]))
      .join("\n");
    assert.equal(packed.includes("embedding"), false);
    assert.equal(packed.includes("imageVec"), false);
    assert.equal(JSON.parse(strFromU8(unzipped["library.json"])).v, 1);

    const pack = readPack(bytes);
    assert.equal(pack.state.marks.log.length, 2);
    assert.equal(pack.state.weights.v, 3);
    assert.equal(pack.state.weights.jobs.push.mix.vibe, 0.7);
    assert.equal(pack.state.shown.shown["import-2"], 1_700_000_100_000);

    const nested = {};
    for (const [name, data] of Object.entries(unzipped)) nested[`take-home/${name}`] = data;
    const folder = await peelLetterPacks(
      Object.entries(nested).map(([name, data]) => fileEntry(name, data)),
    );
    assert.equal(folder.rest.length, 0);
    assert.equal(folder.restores[0].state.marks.log[0].shardId, "import-1");
    assert.equal(folder.restores[0].state.shown.shown["import-1"], 1_700_000_000_000);

    for (const row of [...library.list()]) await library.forget(row.id);
    memory.clear();
    store.loadShown();
    library.setIncludeSamples(true);

    const brought = await library.bringLetters(pack.shards, pack.photos, pack.state);
    assert.equal(brought.added.length, 2);
    assert.equal(isKept(store.log(), "import-1", "push"), true);
    assert.equal(store.log().some((event) => event.shardId === "import-2" && event.action === "dislike"), true);
    assert.equal(store.mixSource("push"), "job");
    assert.equal(store.mixForJob("push").vibe, 0.7);
    assert.deepEqual(store.evalForJob("push"), report);
    assert.equal(store.shown()["import-1"], 1_700_000_000_000);
    assert.equal(store.shown()["import-2"], 1_700_000_100_000);
    assert.ok(store.shown()["import-1"] < Date.now() - 1000);
  });

  it("imports an older letter-only pack without touching marks, mix, or shown times", async () => {
    await emptyLibrary();
    const mix = { job: 0.5, freshness: 0.2, recency: 0.2, vibe: 0.2, text: 0.1 };
    store.recordFeedback({
      shardId: "import-1",
      job: "push",
      action: "like",
      scores: { job: 1 },
      timestamp: 5,
    });
    store.saveJobMix("push", mix, { fittedOn: "all" });
    store.markShown("import-1", 42);
    const marks = store.log();
    const bytes = await buildPack([letter()], new Map([["import-1", jpeg]]));
    assert.equal(Object.keys(unzipSync(bytes)).includes("marks.json"), false);
    const pack = readPack(bytes);
    assert.equal(pack.state, null);
    await library.bringLetters(pack.shards, pack.photos, pack.state);
    assert.deepEqual(store.log(), marks);
    assert.deepEqual(store.mixForJob("push"), mix);
    assert.deepEqual(store.shown(), { "import-1": 42 });
    assert.equal(store.mixSource("push"), "job");
  });

  it("fills a missing mix, keeps a learned one, unions shown, and does not duplicate marks", async () => {
    await emptyLibrary();
    const localMix = { job: 0.9, freshness: 0.1, recency: 0.1, vibe: 0.1, text: 0.1 };
    const packMix = { job: 0.1, freshness: 0.9, recency: 0.1, vibe: 0.4, text: 0.2 };
    const softMix = { job: 0.3, freshness: 0.3, recency: 0.3, vibe: 0.8, text: 0.1 };
    const fallback = { job: 0.55, freshness: 0.14, recency: 0.08, vibe: 0, text: 0 };
    store.saveJobMix("push", localMix, { fittedOn: "train", at: 1 });
    store.clearJobMix("people");
    store.clearJobMix("soft");
    const saved = JSON.parse(localStorage.getItem("remember.weights.v0"));
    saved.fallback = fallback;
    localStorage.setItem("remember.weights.v0", JSON.stringify(saved));
    store.recordFeedback({
      shardId: "import-1",
      job: "push",
      action: "like",
      scores: { job: 0.2 },
      timestamp: 50,
    });
    store.markShown("import-1", 500);
    store.markShown("import-2", 100);

    const state = {
      marks: {
        v: 1,
        log: [
          { shardId: "import-1", job: "push", action: "like", timestamp: 50, scores: { job: 0.2 } },
          { shardId: "import-1", job: "push", action: "dislike", timestamp: 40, scores: { job: 0.2 } },
          { shardId: "import-2", job: "soft", action: "like", timestamp: 80, scores: { job: 0.3 } },
          { shardId: "import-1", job: "push", action: "keep", timestamp: 50 },
        ],
      },
      weights: {
        v: 3,
        jobs: {
          push: { mix: packMix, eval: { fittedOn: "all", at: 9999 } },
          soft: { mix: softMix, eval: { fittedOn: "all", at: 3 } },
        },
        fallback: { job: 0.4, freshness: 0.4, recency: 0.4, vibe: 0.4, text: 0.4 },
        fallbackEval: { fittedOn: "all" },
        prior: { people: true, guests: true },
      },
      shown: { v: 1, shown: { "import-1": 200, "import-2": 800, "import-9": 10, bad: "no" } },
    };

    await library.bringLetters([letter(), paper()], new Map([["import-1", jpeg]]), state);

    assert.deepEqual(store.mixForJob("push"), localMix);
    assert.equal(store.evalForJob("push").at, 1);
    assert.equal(store.mixSource("soft"), "job");
    assert.deepEqual(store.mixForJob("soft"), softMix);
    assert.equal(store.mixSource("people"), "prior");
    assert.equal(store.mixForJob("people"), null);
    assert.deepEqual(store.mixForJob("guests"), fallback);
    const persisted = JSON.parse(localStorage.getItem("remember.weights.v0"));
    assert.equal(persisted.prior.people, true);
    assert.equal(persisted.prior.soft, undefined);
    assert.equal(persisted.prior.guests, undefined);
    assert.deepEqual(persisted.fallback, fallback);

    assert.equal(store.shown()["import-1"], 500);
    assert.equal(store.shown()["import-2"], 800);
    assert.equal(store.shown()["import-9"], 10);
    assert.equal(store.shown().bad, undefined);

    const log = store.log();
    assert.equal(log.filter((event) => event.shardId === "import-1" && event.timestamp === 50).length, 1);
    const face = [...log].reverse().find((event) => event.shardId === "import-1" && event.job === "push");
    assert.equal(face.action, "like");
    assert.equal(face.timestamp, 50);
    assert.equal(log.some((event) => event.shardId === "import-2" && event.action === "like"), true);

    const count = log.length;
    await library.bringLetters([], new Map(), state);
    assert.equal(store.log().length, count);
    assert.equal(store.shown()["import-1"], 500);
  });

  it("points marks and shown times at the id the letter actually landed on", async () => {
    await emptyLibrary();
    await library.bringLetters([letter()], new Map([["import-1", jpeg]]));
    store.recordFeedback({
      shardId: "import-1",
      job: "soft",
      action: "dislike",
      scores: { job: 0.2 },
      timestamp: 3,
    });

    const otherBytes = new Uint8Array([7, 7, 7, 7]);
    const other = letter({
      fingerprint: "other.jpg|2|2",
      filename: "other.jpg",
      note: "Another day.",
    });
    const state = {
      marks: {
        v: 1,
        log: [{ shardId: "import-1", job: "push", action: "like", timestamp: 10, scores: { job: 0.5 } }],
      },
      shown: { v: 1, shown: { "import-1": 10 } },
    };
    const moved = await library.bringLetters([other], new Map([["import-1", otherBytes]]), state);
    const landed = moved.added[0].id;
    assert.notEqual(landed, "import-1");
    assert.equal(isKept(store.log(), landed, "push"), true);
    assert.equal(store.log().some((event) => event.shardId === "import-1" && event.job === "push"), false);
    assert.equal(store.log().find((event) => event.shardId === "import-1").action, "dislike");
    assert.equal(store.shown()[landed], 10);
    assert.equal(store.shown()["import-1"], undefined);

    const again = letter({ id: "import-9" });
    const followed = {
      marks: {
        v: 1,
        log: [{ shardId: "import-9", job: "people", action: "like", timestamp: 7, scores: { job: 0.2 } }],
      },
      shown: { v: 1, shown: { "import-9": 77 } },
    };
    const duplicate = await library.bringLetters([again], new Map(), followed);
    assert.equal(duplicate.added.length, 0);
    assert.equal(duplicate.duplicates.length, 1);
    assert.equal(isKept(store.log(), "import-1", "people"), true);
    assert.equal(store.shown()["import-1"], 77);
    assert.equal(store.shown()["import-9"], undefined);
  });

  it("still reads the letters when a sidecar is broken or from a later weights file", async () => {
    const broken = zipSync(
      {
        "library.json": strToU8(
          JSON.stringify({
            v: 1,
            kind: "remember-letters",
            shards: [{ ...letter(), photo: "photos/import-1.jpg" }],
          }),
        ),
        "marks.json": strToU8("{"),
        "weights.json": strToU8(JSON.stringify({ v: 2, mix: { job: 1 } })),
        "shown.json": strToU8(JSON.stringify({ v: 1, shown: [] })),
        "photos/import-1.jpg": jpeg,
      },
      { level: 0 },
    );
    const pack = readPack(broken);
    assert.equal(pack.unreadable, false);
    assert.equal(pack.shards[0].note, letter().note);
    assert.equal(pack.state, null);
    assert.deepEqual(pack.photos.get("import-1"), jpeg);

    const peeled = await peelLetterPacks([
      fileEntry(
        "backup/library.json",
        JSON.stringify({ v: 2, kind: "remember-letters", shards: [] }),
        "application/json",
      ),
      fileEntry("backup/marks.json", "{", "application/json"),
      fileEntry("backup/note.txt", "hello"),
    ]);
    assert.equal(peeled.unreadable, 1);
    assert.equal(peeled.rest.length, 1);
    assert.equal(peeled.rest[0].name, "note.txt");
  });

  it("offers download my letters beside the marks, and files can choose a zip", () => {
    const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    assert.match(main, /data-train="letters">download my letters</);
    assert.match(main, /Marks, the mix, and what has already been shown come along when they are here/);
    assert.match(main, /restore\.state/);
    assert.match(main, /peelLetterPacks/);
    assert.match(main, /bringLetters/);
    assert.match(main, /downloadLetters/);
    assert.match(html, /accept="[^"]*\.zip/);
    assert.match(readme, /Download your letters from the why box/);
    assert.equal(main.includes("export vault"), false);
    assert.equal(readme.includes("export vault"), false);
  });
});
