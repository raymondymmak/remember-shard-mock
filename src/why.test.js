import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { draftNote } from "./ingest.js";
import { SHARDS } from "./shards.js";
import { composeWhy } from "./why.js";

const NOTE =
  "I didn’t want to go out this morning. I went anyway. By the third mile the heaviness had somewhere else to live.";

function sentences(line) {
  return (String(line).match(/[.!?]/g) || []).length;
}

describe("why this helps today", () => {
  it("gives the same note a different why for each job", () => {
    const lines = ["push", "soft", "people"].map((job) => composeWhy({ job, note: NOTE }));
    assert.equal(new Set(lines).size, 3);
    for (const line of lines) {
      assert.ok(line.trim().length > 0);
      assert.ok(sentences(line) <= 2);
    }
    assert.match(lines[0], /push|heavy|door|anyway/i);
    assert.match(lines[1], /highlight|quiet|thread|ordinary/i);
    assert.match(lines[2], /room|walk in|true thing/i);
  });

  it("can mention a name that is actually in the note", () => {
    const note = "Sam’s laugh is the loud one. He always asks about the thing you mentioned last time.";
    for (const job of ["push", "soft", "people"]) {
      const line = composeWhy({ job, note });
      assert.match(line, /Sam/);
      assert.ok(line.trim().length > 0);
    }
    assert.match(composeWhy({ job: "people", note }), /You’re about to see Sam|Before you walk in: Sam/);
  });

  it("keeps a useful why for a photo with no real note", () => {
    const lines = ["push", "soft", "people"].map((job) =>
      composeWhy({
        job,
        note: draftNote(),
        placeholder: true,
        hasPhoto: true,
      }),
    );
    assert.equal(new Set(lines).size, 3);
    for (const line of lines) {
      assert.ok(line.trim().length > 0);
      assert.doesNotMatch(line, /haven’t written|have not written/i);
    }
  });

  it("uses the picture when that read is ready", () => {
    const plain = composeWhy({
      job: "push",
      note: draftNote(),
      placeholder: true,
      hasPhoto: true,
    });
    const seen = composeWhy({
      job: "push",
      note: draftNote(),
      placeholder: true,
      hasPhoto: true,
      image: 0.42,
      imageMode: "semantic",
      photoAlt: "A runner on an empty road in early light",
    });
    assert.notEqual(seen, plain);
    assert.match(seen, /runner|picture|frame/i);
    assert.ok(seen.trim().length > 0);
  });

  it("is never empty once a job is selected", () => {
    const notes = ["", "   ", null, draftNote(), NOTE, "hello", SHARDS[7].note];
    for (const job of ["push", "soft", "people"]) {
      for (const note of notes) {
        const line = composeWhy({
          job,
          note,
          placeholder: note === draftNote(),
          hasPhoto: note === draftNote(),
        });
        assert.ok(String(line).trim().length > 0, `${job} / ${note}`);
      }
    }
    assert.equal(composeWhy({ note: NOTE }), "");
  });

  it("changes the line when a different score part wins", () => {
    const base = { job: "push", note: NOTE, hasPhoto: true, imageMode: "semantic" };
    const fromWords = composeWhy({ ...base, text: 0.86, jobScore: 0.2, image: 0.05 });
    const fromJob = composeWhy({ ...base, text: 0.1, jobScore: 0.8, image: 0.05 });
    const fromImage = composeWhy({ ...base, text: 0.1, jobScore: 0.2, image: 0.9 });
    assert.notEqual(fromWords, fromJob);
    assert.notEqual(fromWords, fromImage);
    assert.match(fromImage, /picture|frame/i);
    assert.doesNotMatch(fromWords, /\bAI\b|as an assistant|remembered that/i);
  });

  it("stays job-specific across the sample letters", () => {
    for (const shard of SHARDS) {
      const lines = ["push", "soft", "people"].map((job) =>
        composeWhy({ job, note: shard.note, hasPhoto: true, photoAlt: shard.photoAlt }),
      );
      assert.equal(new Set(lines).size, 3, shard.id);
      for (const line of lines) assert.ok(sentences(line) <= 2, line);
    }
  });
});
