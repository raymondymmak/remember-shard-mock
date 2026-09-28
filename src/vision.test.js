import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EMBED_DIM, cosine } from "./ranker.js";
import { createVision, vision } from "./vision.js";

function toy(text) {
  const t = String(text).toLowerCase();
  const push = ["push", "run", "grit", "heavy", "door"].some((word) => t.includes(word));
  const soft = ["soft", "rain", "quiet", "lamp"].some((word) => t.includes(word));
  return [push ? 1 : 0, soft ? 1 : 0, 0.05];
}

function loader({ embedText = toy, embedImage = toy } = {}) {
  return async () => ({ embedText, embedImage });
}

describe("vision fallback", () => {
  it("does not load the real model just by being imported", () => {
    assert.equal(vision.status(), "idle");
    assert.equal(vision.vectorWidth(), 0);
  });

  it("stays on photo feel until load, and again if the model cannot start", async () => {
    const session = createVision({
      loadPipeline: async () => {
        throw new Error("offline");
      },
    });
    const before = await session.embedJobsAndPhotos(["Need a push"], ["/photos/push-run.jpg"]);
    assert.equal(session.status(), "idle");
    assert.equal(before.mode, "feel");
    assert.equal(before.jobVectors[0], null);
    assert.equal(before.photoVectors[0], null);

    assert.equal(await session.load(), "fallback");
    const after = await session.embedJobsAndPhotos(["Need a push"], ["/photos/push-run.jpg"]);
    assert.equal(after.mode, "feel");
    assert.equal(await session.load(), "fallback");
  });

  it("gives up when the model never arrives", async () => {
    const session = createVision({
      loadPipeline: () => new Promise(() => {}),
      timeoutMs: 25,
    });
    assert.equal(await session.load(), "fallback");
    const vectors = await session.embedJobsAndPhotos(["a quiet sunday"], [null]);
    assert.equal(vectors.mode, "feel");
    assert.equal(vectors.photoVectors[0], null);
  });
});

describe("vision model", () => {
  it("returns one shared width and prefers a push photo for a push job", async () => {
    let imageCalls = 0;
    const session = createVision({
      loadPipeline: loader({
        embedImage: async (src) => {
          imageCalls += 1;
          return toy(src);
        },
      }),
    });
    const events = [];
    session.subscribe((status) => events.push(status));

    const [first, second] = await Promise.all([session.load(), session.load()]);
    assert.equal(first, "ready");
    assert.equal(second, "ready");
    assert.deepEqual(events, ["loading", "ready"]);

    const matched = await session.embedJobsAndPhotos(
      ["Need a push. Get out the door."],
      ["/photos/push-run.jpg", null, "/photos/soft-rain.jpg"],
    );
    const again = await session.embedJobsAndPhotos(
      ["Need a push. Get out the door."],
      ["/photos/push-run.jpg"],
    );

    assert.equal(matched.mode, "semantic");
    assert.equal(session.vectorWidth(), matched.jobVectors[0].length);
    assert.equal(matched.jobVectors[0].length, matched.photoVectors[0].length);
    assert.notEqual(matched.jobVectors[0].length, EMBED_DIM);
    assert.equal(matched.photoVectors[1], null);
    assert.ok(cosine(matched.jobVectors[0], matched.photoVectors[0]) > cosine(matched.jobVectors[0], matched.photoVectors[2]));
    assert.ok(cosine(again.jobVectors[0], again.photoVectors[0]) > 0.99);
    assert.equal(imageCalls, 2);
    assert.ok(session.cachedJobsAndPhotos(["Need a push. Get out the door."], ["/photos/push-run.jpg"]));
    assert.equal(session.cachedJobsAndPhotos(["a job we have not embedded"], ["/photos/push-run.jpg"]), null);
  });

  it("drops one bad photograph and keeps the model", async () => {
    const session = createVision({
      loadPipeline: loader({
        embedImage: async (src) => {
          if (String(src).includes("bad")) throw new Error("unreadable");
          return [0.2, 0.8, 0];
        },
      }),
    });
    assert.equal(await session.load(), "ready");
    const result = await session.embedJobsAndPhotos(
      ["Soft memory"],
      ["/photos/bad.jpg", "/photos/soft-rain.jpg"],
    );
    assert.equal(session.status(), "ready");
    assert.equal(result.mode, "semantic");
    assert.equal(result.photoVectors[0], null);
    assert.equal(result.photoVectors[1].length, result.jobVectors[0].length);
  });

  it("falls back to photo feel if image and text widths diverge", async () => {
    const session = createVision({
      loadPipeline: loader({
        embedText: async () => [1, 0, 0],
        embedImage: async () => [1, 0],
      }),
    });
    assert.equal(await session.load(), "ready");
    const result = await session.embedJobsAndPhotos(["Need a push"], ["/photos/push-run.jpg"]);
    assert.equal(session.status(), "fallback");
    assert.equal(result.mode, "feel");
    assert.equal(result.jobVectors[0], null);
    assert.equal(result.photoVectors[0], null);
  });
});
