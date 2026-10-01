import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cosine } from "./ranker.js";
import { CACHE_MODEL as NOTE_MODEL } from "./meaning.js";
import { CACHE_MODEL as IMAGE_MODEL } from "./vision.js";
import {
  bytesFingerprint,
  createEmbedCache,
  textFingerprint,
} from "./embed-cache.js";

function memoryStore() {
  const rows = new Map();
  return {
    async get(key) {
      if (!rows.has(key)) return null;
      const value = rows.get(key);
      return {
        ...value,
        vector: value.vector.slice(),
      };
    },
    async put(key, value) {
      rows.set(key, {
        ...value,
        vector: value.vector.slice(),
      });
    },
    async delete(key) {
      rows.delete(key);
    },
  };
}

function noteItem(text, extras = {}) {
  return {
    kind: "note",
    id: "push-run",
    model: NOTE_MODEL,
    fingerprint: textFingerprint(text),
    dim: 3,
    text,
    ...extras,
  };
}

describe("embed cache", () => {
  it("names the models that produced the stored vectors", () => {
    assert.equal(NOTE_MODEL, "minilm-l6-v2");
    assert.equal(IMAGE_MODEL, "clip-vit-base-patch32");
  });

  it("reuses a hit and does not encode again", async () => {
    const cache = createEmbedCache(memoryStore());
    let calls = 0;
    const embed = async (missing) => {
      calls += 1;
      return { ok: true, vectors: missing.map(() => [1, 0, 0]) };
    };
    const item = noteItem("I went anyway");

    const first = await cache.resolve([item], embed);
    assert.equal(first.encoded, 1);
    assert.equal(first.hits, 0);
    assert.equal(calls, 1);
    assert.deepEqual(first.vectors[0], [1, 0, 0]);

    calls = 0;
    const second = await cache.resolve([item], embed);
    assert.equal(second.encoded, 0);
    assert.equal(second.hits, 1);
    assert.equal(calls, 0);
    assert.deepEqual(second.vectors[0], [1, 0, 0]);
    assert.ok(cosine(second.vectors[0], [1, 0, 0]) > 0.99);
  });

  it("misses when the note is edited", async () => {
    const cache = createEmbedCache(memoryStore());
    const seen = [];
    const embed = async (missing) => {
      seen.push(missing.map((item) => item.text));
      return {
        ok: true,
        vectors: missing.map((item) => (item.text.includes("rain") ? [0, 1, 0] : [1, 0, 0])),
      };
    };

    const original = "I went anyway";
    const revised = "rain on the window";
    assert.notEqual(textFingerprint(original), textFingerprint(revised));

    await cache.resolve([noteItem(original)], embed);
    const again = await cache.resolve([noteItem(original)], embed);
    assert.equal(again.encoded, 0);

    const edited = await cache.resolve([noteItem(revised)], embed);
    assert.equal(edited.hits, 0);
    assert.equal(edited.encoded, 1);
    assert.deepEqual(edited.vectors[0], [0, 1, 0]);
    assert.deepEqual(seen, [[original], [revised]]);
    assert.ok(cosine(again.vectors[0], edited.vectors[0]) < 0.5);
  });

  it("misses when the model id differs", async () => {
    const cache = createEmbedCache(memoryStore());
    let calls = 0;
    const embed = async () => {
      calls += 1;
      return { ok: true, vectors: [[0, 1, 0]] };
    };

    await cache.remember({ ...noteItem("I went anyway"), vector: [1, 0, 0] });
    const mismatch = await cache.resolve(
      [noteItem("I went anyway", { model: "minilm-l12-v2" })],
      embed,
    );
    assert.equal(mismatch.hits, 0);
    assert.equal(mismatch.encoded, 1);
    assert.equal(calls, 1);
    assert.deepEqual(mismatch.vectors[0], [0, 1, 0]);

    assert.equal(await cache.recall(noteItem("I went anyway")), null);
    const bumped = await cache.recall(noteItem("I went anyway", { model: "minilm-l12-v2" }));
    assert.deepEqual(bumped, [0, 1, 0]);
  });

  it("refuses a vector whose width does not match the model", async () => {
    const cache = createEmbedCache(memoryStore());
    const item = noteItem("I went anyway");
    assert.equal(await cache.remember({ ...item, dim: 2, vector: [1, 0] }), true);

    const wrong = await cache.recall({ ...item, dim: 3 });
    assert.equal(wrong, null);

    let calls = 0;
    const resolved = await cache.resolve([{ ...item, dim: 3 }], async () => {
      calls += 1;
      return { ok: true, vectors: [[0.2, 0.4, 0.4]] };
    });
    assert.equal(calls, 1);
    assert.equal(resolved.encoded, 1);
    assert.equal(resolved.vectors[0].length, 3);
    assert.equal(cosine([1, 0], resolved.vectors[0]), 0);
  });

  it("does not keep a hash fallback when the model is not ready", async () => {
    const cache = createEmbedCache(memoryStore());
    const item = noteItem("I went anyway");
    const resolved = await cache.resolve([item], async () => ({ ok: false }));
    assert.equal(resolved.failed, true);
    assert.equal(resolved.encoded, 0);
    assert.equal(await cache.recall(item), null);
  });

  it("changes the photo fingerprint when the bytes change", () => {
    const first = bytesFingerprint(new Uint8Array([1, 2, 3, 4]));
    const same = bytesFingerprint(new Uint8Array([1, 2, 3, 4]));
    const replaced = bytesFingerprint(new Uint8Array([1, 2, 3, 5]));
    assert.equal(first, same);
    assert.notEqual(first, replaced);
    assert.equal(bytesFingerprint(new Uint8Array(0)), "");
  });

  it("drops a revised note and leaves the photograph vector", async () => {
    const cache = createEmbedCache(memoryStore());
    const note = noteItem("I went anyway");
    await cache.remember({ ...note, vector: [1, 0, 0] });
    await cache.remember({
      kind: "image",
      id: note.id,
      model: IMAGE_MODEL,
      fingerprint: "abc:4",
      dim: 2,
      vector: [0, 1],
    });
    assert.equal(await cache.forgetNote(note.id), true);
    assert.equal(await cache.recall(note), null);
    assert.deepEqual(
      await cache.recall({
        kind: "image",
        id: note.id,
        model: IMAGE_MODEL,
        fingerprint: "abc:4",
        dim: 2,
      }),
      [0, 1],
    );
    assert.equal(await cache.forgetNote(""), false);
  });

  it("drops a shard's note and photo vectors together", async () => {
    const cache = createEmbedCache(memoryStore());
    const note = noteItem("I went anyway");
    await cache.remember({ ...note, vector: [1, 0, 0] });
    await cache.remember({
      kind: "image",
      id: note.id,
      model: IMAGE_MODEL,
      fingerprint: "abc:4",
      dim: 2,
      vector: [0, 1],
    });
    await cache.forget(note.id);
    assert.equal(await cache.recall(note), null);
    assert.equal(
      await cache.recall({
        kind: "image",
        id: note.id,
        model: IMAGE_MODEL,
        fingerprint: "abc:4",
        dim: 2,
      }),
      null,
    );
  });
});
