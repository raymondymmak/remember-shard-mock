import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EMBED_DIM, cosine, embedText } from "./ranker.js";
import { createMeaning, meaning } from "./meaning.js";

function toyMeaning(text) {
  const t = String(text).toLowerCase();
  const push = ["continued", "anyway", "heavy", "keep going", "motivation"].some((word) =>
    t.includes(word),
  );
  const soft = ["rain", "quiet", "sunday", "window"].some((word) => t.includes(word));
  return [push ? 1 : 0, soft ? 1 : 0, 0.02];
}

function loader(embed = toyMeaning) {
  return async () => async (text) => embed(text);
}

describe("meaning fallback", () => {
  it("does not load the real model just by being imported", () => {
    assert.equal(meaning.status(), "idle");
  });

  it("uses the hash until load, and again if the model cannot start", async () => {
    const session = createMeaning({
      loadPipeline: async () => {
        throw new Error("offline");
      },
    });
    const before = await session.embedDocuments(["keep going when the day feels heavy"]);
    assert.equal(session.status(), "idle");
    assert.equal(before.mode, "hash");
    assert.equal(before.vectors[0].length, EMBED_DIM);
    assert.deepEqual(before.vectors[0], embedText("keep going when the day feels heavy"));

    assert.equal(await session.load(), "fallback");
    assert.equal(session.status(), "fallback");
    const after = await session.embedDocuments(["keep going when the day feels heavy"]);
    assert.equal(after.mode, "hash");
    assert.deepEqual(after.vectors[0], before.vectors[0]);
    assert.equal(await session.load(), "fallback");
  });

  it("gives up when the model never arrives", async () => {
    const session = createMeaning({
      loadPipeline: () => new Promise(() => {}),
      timeoutMs: 25,
    });
    assert.equal(await session.load(), "fallback");
    const vectors = await session.embedDocuments(["a quiet sunday"]);
    assert.equal(vectors.mode, "hash");
    assert.deepEqual(vectors.vectors[0], embedText("a quiet sunday"));
  });
});

describe("meaning model", () => {
  it("returns stable same-length vectors and prefers a paraphrase", async () => {
    let calls = 0;
    const seen = [];
    const session = createMeaning({
      loadPipeline: async () => {
        calls += 1;
        return async (text) => {
          seen.push(text);
          return toyMeaning(text);
        };
      },
    });
    const events = [];
    session.subscribe((status) => events.push(status));

    const [first, second] = await Promise.all([session.load(), session.load()]);
    assert.equal(first, "ready");
    assert.equal(second, "ready");
    assert.equal(calls, 1);
    assert.deepEqual(events, ["loading", "ready"]);

    const same = "I continued anyway when the day felt heavy";
    const a = await session.embedDocuments([same]);
    const b = await session.embedDocuments([same]);
    const far = await session.embedDocuments(["Rain on a quiet sunday window"]);
    const near = await session.embedDocuments(["I keep going even when it feels heavy"]);

    assert.equal(a.mode, "semantic");
    assert.equal(a.vectors[0].length, b.vectors[0].length);
    assert.equal(a.vectors[0].length, far.vectors[0].length);
    assert.notEqual(a.vectors[0].length, EMBED_DIM);
    assert.ok(cosine(a.vectors[0], b.vectors[0]) > 0.99);
    assert.ok(cosine(a.vectors[0], near.vectors[0]) > cosine(a.vectors[0], far.vectors[0]));
    // The repeated sentence is cached. The probe during load is the other call.
    assert.equal(seen.filter((text) => text === same).length, 1);
    assert.ok(session.cachedDocuments([same, "Rain on a quiet sunday window"]));
    assert.equal(session.cachedDocuments(["a note we have not embedded"]), null);
  });

  it("drops back to the hash if a later embed fails", async () => {
    let n = 0;
    const session = createMeaning({
      loadPipeline: loader(() => {
        n += 1;
        if (n > 1) throw new Error("boom");
        return [0.4, 0.6];
      }),
    });
    assert.equal(await session.load(), "ready");
    const next = await session.embedDocuments(["a revised note"]);
    assert.equal(next.mode, "hash");
    assert.equal(session.status(), "fallback");
    assert.deepEqual(next.vectors[0], embedText("a revised note"));
    assert.equal(next.vectors[0].length, EMBED_DIM);
  });

  it("embeds a changed note as its own vector", async () => {
    const session = createMeaning({ loadPipeline: loader() });
    await session.load();
    const first = await session.embedDocuments(["I continued anyway"]);
    const revised = await session.embedDocuments(["Rain on a quiet sunday window"]);
    assert.equal(first.vectors[0].length, revised.vectors[0].length);
    assert.ok(cosine(first.vectors[0], revised.vectors[0]) < 0.5);
  });
});
