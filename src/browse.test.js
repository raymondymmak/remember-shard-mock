import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describePlacement, rankPlace, stepRank } from "./browse.js";

const ranking = [{ shard: { id: "a" } }, { id: "b" }, { shard: { id: "c" } }];

describe("browse the ranked pool", () => {
  it("reports the place as 3 of 12 style", () => {
    assert.deepEqual(rankPlace(ranking, "b"), {
      index: 1,
      place: 2,
      total: 3,
      ordinal: "2nd",
      ofLabel: "2 of 3",
      label: "2 of 3",
      letter: "ranked 2nd of 3",
      teach: "scored among 3, placing 2nd",
    });
    assert.deepEqual(rankPlace(ranking, "c"), {
      index: 2,
      place: 3,
      total: 3,
      ordinal: "3rd",
      ofLabel: "3 of 3",
      label: "3 of 3",
      letter: "ranked 3rd of 3",
      teach: "scored among 3, placing 3rd",
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
      ordinal: "",
      letter: "",
      teach: "",
    });
    assert.equal(rankPlace([], "a").label, "");
    assert.equal(describePlacement(-1, 13), null);
    assert.equal(describePlacement(13, 13), null);
  });

  it("the letter line and the why panel share one place and one pool size", () => {
    const pool = Array.from({ length: 13 }, (_, i) => ({ id: `s${i}` }));
    const fourth = rankPlace(pool, "s3");
    const again = describePlacement(fourth.index, fourth.total);
    assert.equal(fourth.place, 4);
    assert.equal(fourth.total, 13);
    assert.equal(fourth.letter, "ranked 4th of 13");
    assert.equal(fourth.teach, "scored among 13, placing 4th");
    assert.equal(again.letter, fourth.letter);
    assert.equal(again.teach, fourth.teach);
    assert.equal(fourth.label, "4 of 13");
    const first = rankPlace(pool, "s0");
    assert.equal(first.letter, "ranked 1st of 13");
    assert.equal(first.teach, "scored among 13, placing 1st");
    assert.equal(rankPlace(pool, "s10").ordinal, "11th");
    assert.equal(rankPlace(pool, "s11").ordinal, "12th");
    assert.equal(rankPlace(pool, "s12").ordinal, "13th");
  });
});
