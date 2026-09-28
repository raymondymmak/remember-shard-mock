import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JOBS, SHARDS } from "./shards.js";
import { prepareJobs, prepareShards, rankShards } from "./ranker.js";
import {
  buildImportedShards,
  captureEntries,
  classifyEntry,
  describeIntake,
  draftNote,
  mergePlan,
  noteBody,
  pairFiles,
  stemKey,
  vibeFromNote,
  whyForJob,
} from "./ingest.js";

function entry(relativePath, extra = {}) {
  const name = relativePath.split("/").pop();
  return classifyEntry({ name, relativePath, ...extra });
}

function ids() {
  let n = 0;
  return () => {
    n += 1;
    return `import-${n}`;
  };
}

describe("note and photo pairing", () => {
  it("treats My Photo.JPG and my-photo.md as the same stem", () => {
    assert.equal(stemKey("My Photo.JPG"), stemKey("my-photo.md"));
    const grouped = pairFiles([entry("My Photo.JPG"), entry("my-photo.md")]);
    assert.equal(grouped.pairs.length, 1);
    assert.equal(grouped.pairs[0].reason, "stem");
    assert.equal(grouped.photoOnly.length, 0);
    assert.equal(grouped.noteOnly.length, 0);
  });

  it("binds a note dropped alongside one photo when the names differ", () => {
    const grouped = pairFiles([entry("kitchen.jpg"), entry("sunday.txt")]);
    assert.equal(grouped.pairs.length, 1);
    assert.equal(grouped.pairs[0].reason, "alongside");
    assert.equal(grouped.pairs[0].image.name, "kitchen.jpg");
    assert.equal(grouped.pairs[0].note.name, "sunday.txt");
  });

  it("binds a leftover pair in the same folder after the stem matches are taken", () => {
    const grouped = pairFiles([
      entry("a.jpg"),
      entry("a.txt"),
      entry("b.jpg"),
      entry("letter.md"),
    ]);
    assert.equal(grouped.pairs.length, 2);
    assert.equal(grouped.pairs[0].reason, "stem");
    assert.equal(grouped.pairs[1].reason, "alongside");
    assert.equal(grouped.pairs[1].image.name, "b.jpg");
    assert.equal(grouped.pairs[1].note.name, "letter.md");
  });

  it("does not glue one note onto several photos", () => {
    const grouped = pairFiles([entry("a.jpg"), entry("b.png"), entry("letter.md")]);
    assert.equal(grouped.pairs.length, 0);
    assert.equal(grouped.photoOnly.length, 2);
    assert.equal(grouped.noteOnly.length, 1);
  });

  it("prefers the note sitting in the photo's folder over a same stem elsewhere", () => {
    const grouped = pairFiles([
      entry("pics/dog.jpg"),
      entry("pics/caption.txt"),
      entry("notes/dog.md"),
    ]);
    assert.equal(grouped.pairs.length, 1);
    assert.equal(grouped.pairs[0].reason, "alongside");
    assert.equal(grouped.pairs[0].note.name, "caption.txt");
    assert.equal(grouped.noteOnly[0].name, "dog.md");
  });

  it("still binds a unique stem across folders", () => {
    const grouped = pairFiles([entry("pics/dog.jpg"), entry("notes/dog.md")]);
    assert.equal(grouped.pairs.length, 1);
    assert.equal(grouped.pairs[0].reason, "stem");
    assert.equal(grouped.pairs[0].note.relativePath, "notes/dog.md");
  });

  it("leaves a stem alone when two photos could claim one note", () => {
    const grouped = pairFiles([
      entry("trip/a.jpg"),
      entry("other/a.jpg"),
      entry("misc/a.md"),
    ]);
    assert.equal(grouped.pairs.length, 0);
    assert.equal(grouped.photoOnly.length, 2);
    assert.equal(grouped.noteOnly.length, 1);
  });

  it("ignores files that are neither a photo nor a note", () => {
    const grouped = pairFiles([entry("scan.pdf"), entry("keep.webp")]);
    assert.equal(grouped.skipped.length, 1);
    assert.equal(grouped.photoOnly.length, 1);
    assert.equal(grouped.photoOnly[0].name, "keep.webp");
  });
});

describe("shards from an import", () => {
  it("keeps a shared note on the photo and a lone note on paper", () => {
    const grouped = pairFiles([
      entry("hike.jpg", { lastModified: new Date(2024, 4, 9, 15).getTime(), size: 10 }),
      entry("hike.md"),
      entry("alone.txt"),
    ]);
    const texts = new Map([
      ["hike.md", "# Ridge\n\nHalfway up I wanted to turn around. I went anyway."],
      ["alone.txt", "Sunday. Quiet rain on the window. I was just here."],
    ]);
    const shards = buildImportedShards(grouped, {
      jobId: "push",
      createId: ids(),
      textFor: (note) => texts.get(note.relativePath) || "",
      now: new Date(2026, 8, 28).getTime(),
    });

    assert.equal(shards.length, 2);
    const hike = shards.find((shard) => shard.filename === "hike.jpg");
    const alone = shards.find((shard) => shard.noteName === "alone.txt");
    assert.equal(hike.hasPhoto, true);
    assert.equal(hike.paper, false);
    assert.equal(hike.date, "2024-05-09");
    assert.match(hike.note, /^Ridge/);
    assert.doesNotMatch(hike.note, /#/);
    assert.equal(hike.why, whyForJob("push"));
    assert.ok(hike.vibe[0] > hike.vibe[1] && hike.vibe[0] > hike.vibe[2]);
    assert.equal(alone.hasPhoto, false);
    assert.equal(alone.paper, true);
    assert.ok(alone.vibe[1] > alone.vibe[0]);
  });

  it("drafts a first-person note when a photo arrives alone", () => {
    const grouped = pairFiles([entry("desk.png")]);
    const [shard] = buildImportedShards(grouped, { jobId: "people", createId: ids() });
    assert.equal(shard.note, draftNote());
    assert.equal(shard.placeholder, true);
    assert.deepEqual(shard.vibe, [0.5, 0.5, 0.5]);
    assert.equal(shard.why, whyForJob("people"));
    assert.match(shard.photoAlt, /desk/);
  });

  it("strips a markdown heading into prose", () => {
    assert.equal(noteBody("# Sunday\n\nThe light was kind."), "Sunday\n\nThe light was kind.");
  });

  it("tilts vibe from the words, and stays mid when there are none", () => {
    const grit = vibeFromNote("I ran uphill anyway");
    const people = vibeFromNote("Sam's laugh at dinner with friends");
    assert.ok(grit[0] > grit[1] && grit[0] > grit[2]);
    assert.ok(people[2] > people[0] && people[2] > people[1]);
    assert.deepEqual(vibeFromNote("hello there"), [0.5, 0.5, 0.5]);
  });

  it("updates a placeholder when the same photo comes back with a note", () => {
    const actions = mergePlan(
      [{ id: "import-1", fingerprint: "desk.png|4|9", placeholder: true }],
      [
        { id: "import-new", fingerprint: "desk.png|4|9", placeholder: false, note: "We shipped it." },
        { id: "import-again", fingerprint: "desk.png|4|9", placeholder: false, note: "again" },
      ],
    );
    assert.equal(actions[0].type, "update");
    assert.equal(actions[0].id, "import-1");
    assert.equal(actions[1].type, "skip");
  });

  it("joins the same prepareShards → rankShards pipeline", () => {
    const grouped = pairFiles([
      entry("push-me.jpg"),
      entry("push-me.md"),
      entry("soft-day.jpg"),
      entry("soft-day.md"),
    ]);
    const texts = new Map([
      ["push-me.md", "I ran the ridge anyway. Tired, cold, and I finished."],
      ["soft-day.md", "Sunday rain, quiet coffee, a slow walk home."],
    ]);
    const imported = buildImportedShards(grouped, {
      jobId: "push",
      createId: ids(),
      textFor: (note) => texts.get(note.relativePath) || "",
    });
    const jobs = prepareJobs(JOBS);
    const pool = prepareShards([...SHARDS, ...imported]);
    const push = rankShards({
      shards: pool,
      job: jobs.find((job) => job.id === "push"),
    });
    const pushOnly = rankShards({
      shards: prepareShards(imported),
      job: jobs.find((job) => job.id === "push"),
    });

    assert.equal(push.length, SHARDS.length + imported.length);
    assert.ok(push.some((row) => row.shard.id === "import-1"));
    assert.equal(pushOnly[0].shard.filename, "push-me.jpg");
    assert.ok(pushOnly[0].parts.job > pushOnly[1].parts.job);
  });
});

describe("phone capture", () => {
  function shot(name, extra = {}) {
    return { name, type: "image/jpeg", size: 40, lastModified: 10, ...extra };
  }

  it("leaves an empty note on the photo-only placeholder path", () => {
    for (const note of ["", "   \n", null]) {
      const entries = captureEntries({ file: shot("image.jpg"), note }).map(classifyEntry);
      const grouped = pairFiles(entries);
      assert.equal(grouped.pairs.length, 0);
      assert.equal(grouped.photoOnly.length, 1);
      assert.equal(grouped.noteOnly.length, 0);
      const [shard] = buildImportedShards(grouped, { jobId: "soft", createId: ids() });
      assert.equal(shard.placeholder, true);
      assert.equal(shard.note, draftNote());
      assert.equal(shard.hasPhoto, true);
      assert.equal(shard.noteName, "");
    }
  });

  it("binds a written note to that photo and keeps the file for the library", async () => {
    const file = shot("IMG_2201.JPEG", { size: 80, lastModified: 20 });
    const entries = captureEntries({ file, note: "  I laughed with Sam at dinner. " });
    assert.equal(entries.length, 2);
    const body = await entries[1].file.text();
    const grouped = pairFiles(entries.map(classifyEntry));
    assert.equal(grouped.pairs.length, 1);
    assert.equal(grouped.pairs[0].reason, "stem");
    const [shard] = buildImportedShards(grouped, {
      jobId: "people",
      createId: ids(),
      textFor: () => body,
    });
    assert.equal(shard.placeholder, false);
    assert.equal(shard.note, "I laughed with Sam at dinner.");
    assert.equal(shard.filename, "IMG_2201.JPEG");
    assert.equal(shard.photoFile, file);
    assert.equal(shard.why, whyForJob("people"));
    assert.ok(shard.vibe[2] > shard.vibe[0]);
  });

  it("treats two phone shots that share a camera name as different letters", () => {
    const first = buildImportedShards(
      pairFiles(
        captureEntries({ file: shot("image.jpg", { size: 10, lastModified: 1 }) }).map(classifyEntry),
      ),
      { createId: ids() },
    );
    const second = buildImportedShards(
      pairFiles(
        captureEntries({ file: shot("image.jpg", { size: 11, lastModified: 2 }) }).map(classifyEntry),
      ),
      { createId: () => "import-b" },
    );
    const actions = mergePlan(first, second);
    assert.equal(actions.length, 1);
    assert.equal(actions[0].type, "add");
  });
});

describe("intake copy", () => {
  it("says what joined the pool", () => {
    const grouped = pairFiles([
      entry("a.jpg"),
      entry("a.txt"),
      entry("trip/b.jpg"),
      entry("notes/c.md"),
    ]);
    const line = describeIntake(grouped, { added: 3, updated: 0, duplicate: 0 });
    assert.match(line, /1 photo with its note/);
    assert.match(line, /1 photo, note still unwritten/);
    assert.match(line, /1 note on paper/);
    assert.match(line, /In the pool/);
  });
});
