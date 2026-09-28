import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rankPlace, stepRank } from "./browse.js";

const ranking = [{ shard: { id: "a" } }, { id: "b" }, { shard: { id: "c" } }];

describe("browse the ranked pool", () => {
  it("reports the place as 3 of 12 style", () => {
    assert.deepEqual(rankPlace(ranking, "b"), {
      index: 1,
      place: 2,
      total: 3,
      label: "2 of 3",
    });
    assert.deepEqual(rankPlace(ranking, "c"), {
      index: 2,
      place: 3,
      total: 3,
      label: "3 of 3",
    });
  });

  it("steps to the neighbor and stops at the ends", () => {
    assert.deepEqual(stepRank(ranking, "a", 1), { index: 1, id: "b" });
    assert.deepEqual(stepRank(ranking, "b", -1), { index: 0, id: "a" });
    assert.deepEqual(stepRank(ranking, "b", 1), { index: 2, id: "c" });
    assert.equal(stepRank(ranking, "a", -1), null);
    assert.equal(stepRank(ranking, "c", 1), null);
    assert.equal(stepRank(ranking, "missing", 1), null);
    assert.equal(stepRank(ranking, "b", 0), null);
  });

  it("has no place when the letter is not in this ranking", () => {
    assert.deepEqual(rankPlace(ranking, "nope"), {
      index: -1,
      place: 0,
      total: 3,
      label: "",
    });
    assert.equal(rankPlace([], "a").label, "");
  });
});
