import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { EMPTY_POOL_INVITE, poolFace, samplesAsideAfterIntake } from "./own.js";

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

const library = await import("./library.js");

const META_KEY = "remember.library.v0";
const SAMPLES = [{ id: "push-run" }, { id: "soft-rain" }];

function note(id, name) {
  return {
    id,
    note: "Sunday. Quiet rain. I was just here.",
    why: "A texture from a day that was yours.",
    date: "2024-05-09",
    vibe: [0.2, 0.7, 0.2],
    photoAlt: "A letter without a photograph",
    hasPhoto: false,
    noteName: name,
    fingerprint: `${name}|12|9`,
    placeholder: false,
  };
}

function photo(id, name) {
  return {
    id,
    note: "I kept this. I haven’t written what it meant yet — but I was there.",
    why: "A texture from a day that was yours.",
    date: "2024-05-09",
    vibe: [0.5, 0.5, 0.5],
    photoAlt: "A photo you kept",
    hasPhoto: true,
    filename: name,
    fingerprint: `${name}|40|10`,
    placeholder: true,
  };
}

function savedMeta() {
  return JSON.parse(localStorage.getItem(META_KEY));
}

async function emptyLibrary() {
  memory.clear();
  await library.hydrate();
}

describe("my shards", { concurrency: 1 }, () => {
  it("sets samples aside on the first import and ranks that pool", async () => {
    await emptyLibrary();
    assert.equal(library.includeSamplesOn(), true);
    assert.equal(samplesAsideAfterIntake({ ownBefore: 0, added: 1 }), true);
    assert.equal(samplesAsideAfterIntake({ ownBefore: 0, added: 0 }), false);
    assert.equal(samplesAsideAfterIntake({ ownBefore: 2, added: 1 }), false);
    assert.equal(library.rankingPool(SAMPLES).length, SAMPLES.length);

    const kept = await library.rememberShards([photo("import-1", "porch.jpg")]);
    assert.equal(kept.added.length, 1);
    assert.equal(library.includeSamplesOn(), false);

    const pool = library.rankingPool(SAMPLES);
    assert.deepEqual(
      pool.map((shard) => shard.id),
      ["import-1"],
    );
    assert.equal(pool[0].imported, true);
  });

  it("leaves the toggle alone once the user pool already has a shard", async () => {
    await emptyLibrary();
    await library.rememberShards([photo("import-1", "porch.jpg")]);
    assert.equal(library.includeSamplesOn(), false);

    library.setIncludeSamples(true);
    const kept = await library.rememberShards([note("import-2", "sunday.txt")]);
    assert.equal(kept.added.length, 1);
    assert.equal(library.includeSamplesOn(), true);
    assert.equal(savedMeta().includeSamples, true);
    assert.ok(library.rankingPool(SAMPLES).some((shard) => shard.id === "push-run"));
    assert.ok(library.rankingPool(SAMPLES).some((shard) => shard.id === "import-2"));
  });

  it("persists samples aside in localStorage and reads it back", async () => {
    await emptyLibrary();
    await library.rememberShards([photo("import-9", "kitchen.jpg")]);
    assert.equal(library.includeSamplesOn(), false);

    const stored = savedMeta();
    assert.equal(stored.includeSamples, false);
    assert.equal(stored.shards.length, 1);
    assert.equal(stored.shards[0].id, "import-9");

    library.setIncludeSamples(true);
    assert.equal(library.includeSamplesOn(), true);
    localStorage.setItem(META_KEY, JSON.stringify({ ...stored, includeSamples: false }));

    await library.hydrate();
    assert.equal(library.includeSamplesOn(), false);
    assert.equal(library.list().length, 1);
    assert.deepEqual(
      library.rankingPool(SAMPLES).map((shard) => shard.id),
      ["import-9"],
    );
  });

  it("shows an invite only while the user pool is empty", () => {
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    const empty = poolFace({ ownCount: 0, includeSamples: true });
    const mine = poolFace({ ownCount: 1, includeSamples: false });
    const mixed = poolFace({ ownCount: 2, includeSamples: true });

    assert.equal(empty.invite, EMPTY_POOL_INVITE);
    assert.equal(empty.invite, "One of yours, if you want.");
    assert.doesNotMatch(empty.invite, /\b(take|choose|drop|bring)\b/i);
    assert.doesNotMatch(empty.invite, /samples/i);
    assert.equal(empty.cue, "Ranking the samples.");
    assert.equal(mine.invite, "");
    assert.equal(mine.cue, "Ranking my shards.");
    assert.equal(poolFace({ ownCount: 0, drafting: true }).invite, "");
    assert.equal(poolFace({ ownCount: 0, drafting: true }).cue, "Ranking the samples.");
    assert.equal(mixed.invite, "");
    assert.equal(mixed.cue, "Ranking the samples with yours.");
    assert.ok(html.includes('id="pool-invite"'));
    assert.ok(html.includes(EMPTY_POOL_INVITE));
    assert.equal((html.match(/take a photo/gi) || []).length, 1);
    assert.equal((html.match(/choose one/gi) || []).length, 1);
    assert.match(html, /id="capture-take"[^>]*>take a photo</);
    assert.match(html, /id="capture-choose"[^>]*>choose one</);
    assert.match(html, /id="bring-files"[\s\S]*?>\s*files\s*</);
    assert.match(html, /id="bring-folder"[\s\S]*?>\s*folder\s*</);
    assert.equal(html.includes("bring a photo or a note"), false);
    assert.equal(html.includes("or a folder"), false);
    assert.equal(html.includes("drop it here"), false);
    const strip = html.slice(html.indexOf('class="intake-line"'), html.indexOf("</p>", html.indexOf('class="intake-line"')));
    assert.equal(strip.includes("samples"), false);
    assert.ok(html.includes('class="samples-line"'));
    assert.ok(html.includes('id="samples-toggle"'));
    assert.ok(html.includes('id="pool-cue"'));
    assert.ok(html.includes("Ranking the samples."));
    assert.match(
      html,
      /class="intake pool-box"[\s\S]*class="intake-line"[\s\S]*class="samples-line"[\s\S]*id="pool-cue"/,
    );
    assert.equal(html.includes('id="folio-rank"'), false);
    assert.equal(html.includes(">all shards<"), false);
    assert.match(
      html,
      /id="folio-prev"[\s\S]*id="folio-all"[\s\S]*id="folio-place"[\s\S]*id="folio-next"/,
    );
    assert.match(
      html,
      /<details class="teach" id="teach">\s*<summary>why this showed up<\/summary>\s*<div class="teach-body"/,
    );
    assert.doesNotMatch(html, /<summary[^>]*\blens\b/);
  });

  it("keeps the score breakdown inline and has no numbers disclosure", () => {
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
    const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
    for (const source of [html, main, css]) {
      assert.equal(/the numbers/i.test(source), false);
      assert.equal(source.includes("teach-math"), false);
    }
    assert.match(main, /class="teach-scores"/);
    assert.match(main, /how it scored/);
    assert.equal(main.includes("<details"), false);
    assert.match(css, /\.teach \{[^}]*backdrop-filter:\s*blur/);
    const summary = css.slice(
      css.indexOf(".teach > summary {"),
      css.indexOf("}", css.indexOf(".teach > summary {")),
    );
    assert.match(summary, /background:\s*none/);
    assert.match(summary, /border:\s*0/);
    assert.match(summary, /box-shadow:\s*none/);
    const body = css.slice(css.indexOf(".teach-body {"), css.indexOf("}", css.indexOf(".teach-body {")));
    assert.equal(body.includes("backdrop-filter: blur"), false);
    assert.match(body, /background:\s*none/);
  });
});
