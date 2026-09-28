import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isKept,
  isNixed,
  latestAction,
  markFace,
  placeMark,
  undoActiveKeep,
  undoActiveNah,
  withoutLatestKeep,
  withoutLatestNah,
} from "./marks.js";
import * as store from "./store.js";

describe("keep label", () => {
  it("is kept only when the latest mark for that shard and job is keep", () => {
    const log = [
      { shardId: "a", job: "push", action: "keep" },
      { shardId: "a", job: "push", action: "another" },
      { shardId: "a", job: "soft", action: "keep" },
      { shardId: "b", job: "push", action: "nah" },
    ];
    assert.equal(latestAction(log, "a", "push"), "another");
    assert.equal(isKept(log, "a", "push"), false);
    assert.equal(isKept(log, "a", "soft"), true);
    assert.equal(isKept(log, "b", "push"), false);
    assert.equal(isKept(log, "missing", "push"), false);
  });

  it("undo removes the trailing keep and returns the label to keep", () => {
    const log = [
      { shardId: "a", job: "push", action: "nah" },
      { shardId: "a", job: "push", action: "keep" },
    ];
    const next = withoutLatestKeep(log, "a", "push");
    assert.equal(isKept(next, "a", "push"), false);
    assert.equal(latestAction(next, "a", "push"), "nah");
    assert.equal(next.length, 1);
  });

  it("one undo clears a double-recorded keep without touching other jobs", () => {
    const log = [
      { shardId: "a", job: "soft", action: "keep" },
      { shardId: "b", job: "push", action: "keep" },
      { shardId: "a", job: "push", action: "another" },
      { shardId: "a", job: "push", action: "keep" },
      { shardId: "a", job: "push", action: "keep" },
    ];
    const next = withoutLatestKeep(log, "a", "push");
    assert.equal(isKept(next, "a", "push"), false);
    assert.equal(latestAction(next, "a", "push"), "another");
    assert.equal(isKept(next, "a", "soft"), true);
    assert.equal(isKept(next, "b", "push"), true);
    assert.equal(next.length, 3);
  });

  it("leaves the log alone when the latest mark is not keep", () => {
    const log = [{ shardId: "a", job: "push", action: "nah" }];
    assert.equal(withoutLatestKeep(log, "a", "push"), log);
    assert.deepEqual(withoutLatestKeep([], "a", "push"), []);
  });
});

describe("like and dislike fill", () => {
  it("fills like only when the latest mark is keep, dislike only when it is nah", () => {
    assert.deepEqual(markFace([], "a", "push"), { like: false, dislike: false });
    const liked = [{ shardId: "a", job: "push", action: "keep" }];
    assert.deepEqual(markFace(liked, "a", "push"), { like: true, dislike: false });
    assert.equal(isNixed(liked, "a", "push"), false);

    const disliked = [
      { shardId: "a", job: "push", action: "keep" },
      { shardId: "a", job: "push", action: "nah" },
    ];
    assert.deepEqual(markFace(disliked, "a", "push"), { like: false, dislike: true });
    assert.equal(isNixed(disliked, "a", "push"), true);

    const skipped = [...disliked, { shardId: "a", job: "push", action: "another" }];
    assert.deepEqual(markFace(skipped, "a", "push"), { like: false, dislike: false });
  });

  it("reads fill per shard and job, so a switch does not borrow the other mark", () => {
    const log = [
      { shardId: "a", job: "push", action: "keep" },
      { shardId: "a", job: "soft", action: "nah" },
      { shardId: "b", job: "push", action: "nah" },
    ];
    assert.deepEqual(markFace(log, "a", "push"), { like: true, dislike: false });
    assert.deepEqual(markFace(log, "a", "soft"), { like: false, dislike: true });
    assert.deepEqual(markFace(log, "b", "push"), { like: false, dislike: true });
    assert.deepEqual(markFace(log, "a", "people"), { like: false, dislike: false });
  });

  it("undo of a filled dislike clears to unmarked and does not restore like", () => {
    const log = [
      { shardId: "a", job: "soft", action: "nah" },
      { shardId: "a", job: "push", action: "keep" },
      { shardId: "a", job: "push", action: "nah" },
      { shardId: "a", job: "push", action: "nah" },
    ];
    const next = undoActiveNah(log, "a", "push");
    assert.deepEqual(markFace(next, "a", "push"), { like: false, dislike: false });
    assert.deepEqual(markFace(next, "a", "soft"), { like: false, dislike: true });
    assert.equal(next.length, 1);
    assert.equal(latestAction(next, "a", "push"), null);
  });

  it("undo of dislike on an empty previous mark clears both icons", () => {
    const log = [{ shardId: "a", job: "push", action: "nah" }];
    const next = withoutLatestNah(log, "a", "push");
    assert.deepEqual(markFace(next, "a", "push"), { like: false, dislike: false });
    assert.equal(next.length, 0);
  });

  it("leaves the log alone when the latest mark is not nah", () => {
    const log = [{ shardId: "a", job: "push", action: "keep" }];
    assert.equal(withoutLatestNah(log, "a", "push"), log);
    assert.deepEqual(withoutLatestNah([], "a", "push"), []);
  });
});

describe("undoKeep in the log", () => {
  it("stores a keep and lifts it so the latest mark is no longer keep", () => {
    store.recordFeedback({ shardId: "folio-a", job: "push", action: "keep", scores: {} });
    store.recordFeedback({ shardId: "folio-a", job: "push", action: "keep", scores: {} });
    store.recordFeedback({ shardId: "folio-b", job: "push", action: "nah", scores: {} });
    assert.equal(isKept(store.log(), "folio-a", "push"), true);

    const next = store.undoKeep("folio-a", "push");
    assert.equal(isKept(next, "folio-a", "push"), false);
    assert.equal(next.some((event) => event.shardId === "folio-b" && event.action === "nah"), true);
    assert.equal(isKept(store.log(), "folio-a", "push"), false);
  });
});

describe("undoNah in the log", () => {
  it("stores a nah and lifts it so the letter is unmarked", () => {
    store.recordFeedback({ shardId: "folio-c", job: "push", action: "keep", scores: {} });
    store.recordFeedback({ shardId: "folio-c", job: "push", action: "nah", scores: {} });
    store.recordFeedback({ shardId: "folio-c", job: "push", action: "nah", scores: {} });
    store.recordFeedback({ shardId: "folio-d", job: "soft", action: "nah", scores: {} });
    assert.deepEqual(markFace(store.log(), "folio-c", "push"), { like: false, dislike: true });
    assert.equal(
      store.log().some((event) => event.shardId === "folio-c" && event.action === "keep"),
      false,
    );

    const next = store.undoNah("folio-c", "push");
    assert.deepEqual(markFace(next, "folio-c", "push"), { like: false, dislike: false });
    assert.deepEqual(markFace(next, "folio-d", "soft"), { like: false, dislike: true });
    assert.deepEqual(markFace(store.log(), "folio-c", "push"), { like: false, dislike: false });
  });
});

describe("like and dislike replace each other", () => {
  it("dislike then like then undo stays unmarked", () => {
    const disliked = [
      { shardId: "a", job: "push", action: "nah" },
      { shardId: "a", job: "soft", action: "nah" },
    ];
    const liked = placeMark(disliked, { shardId: "a", job: "push", action: "keep" });
    assert.deepEqual(markFace(liked, "a", "push"), { like: true, dislike: false });
    assert.equal(
      liked.some((event) => event.shardId === "a" && event.job === "push" && event.action === "nah"),
      false,
    );
    assert.deepEqual(markFace(liked, "a", "soft"), { like: false, dislike: true });

    const cleared = undoActiveKeep(liked, "a", "push");
    assert.deepEqual(markFace(cleared, "a", "push"), { like: false, dislike: false });
    assert.deepEqual(markFace(cleared, "a", "soft"), { like: false, dislike: true });
  });

  it("undo of like does not revive a dislike still sitting under it", () => {
    const stale = [
      { shardId: "a", job: "push", action: "nah" },
      { shardId: "a", job: "push", action: "keep" },
    ];
    const cleared = undoActiveKeep(stale, "a", "push");
    assert.deepEqual(markFace(cleared, "a", "push"), { like: false, dislike: false });
    assert.equal(cleared.length, 0);
  });

  it("like then dislike then undo stays unmarked", () => {
    store.recordFeedback({ shardId: "folio-e", job: "push", action: "keep", scores: {} });
    store.recordFeedback({ shardId: "folio-e", job: "push", action: "nah", scores: {} });
    assert.deepEqual(markFace(store.log(), "folio-e", "push"), { like: false, dislike: true });
    assert.equal(
      store.log().some((event) => event.shardId === "folio-e" && event.action === "keep"),
      false,
    );

    const cleared = store.undoNah("folio-e", "push");
    assert.deepEqual(markFace(cleared, "folio-e", "push"), { like: false, dislike: false });
  });

  it("dislike then like then undo stays unmarked in the store", () => {
    store.recordFeedback({ shardId: "folio-f", job: "people", action: "nah", scores: {} });
    store.recordFeedback({ shardId: "folio-f", job: "people", action: "keep", scores: {} });
    assert.deepEqual(markFace(store.log(), "folio-f", "people"), { like: true, dislike: false });
    assert.equal(
      store.log().some((event) => event.shardId === "folio-f" && event.action === "nah"),
      false,
    );

    const cleared = store.undoKeep("folio-f", "people");
    assert.deepEqual(markFace(cleared, "folio-f", "people"), { like: false, dislike: false });
  });
});
