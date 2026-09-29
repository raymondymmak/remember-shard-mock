import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { draftNote } from "./ingest.js";
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
  fake.store("remember", "photos")?.clear();
  fake.store("remember", "embeddings")?.clear();
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

  it("offers download my letters beside the marks, and files can choose a zip", () => {
    const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    assert.match(main, /data-train="letters">download my letters</);
    assert.match(main, /peelLetterPacks/);
    assert.match(main, /bringLetters/);
    assert.match(main, /downloadLetters/);
    assert.match(html, /accept="[^"]*\.zip/);
    assert.match(readme, /Download your letters from the why box/);
    assert.equal(main.includes("export vault"), false);
    assert.equal(readme.includes("export vault"), false);
  });
});
