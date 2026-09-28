import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JOBS } from "./shards.js";
import { fingerprintFromPixels, imageSimilarity } from "./image.js";

function solid(r, g, b, n = 4) {
  const data = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i += 1) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return fingerprintFromPixels(data, n, n);
}

describe("image fingerprint", () => {
  it("reads brightness, warmth, and a histogram that adds up to 1", () => {
    const white = solid(255, 255, 255);
    const black = solid(0, 0, 0);
    const red = solid(220, 40, 20);
    const blue = solid(20, 40, 220);

    assert.ok(white[0] > 0.99);
    assert.ok(Math.abs(white[1] - 0.5) < 1e-9);
    assert.deepEqual(white.slice(2).map((n) => Math.round(n)), [0, 0, 0, 1]);

    assert.ok(black[0] < 0.01);
    assert.equal(Math.round(black[2]), 1);

    assert.ok(red[1] > blue[1]);
    assert.ok(red[1] > 0.7);
    assert.ok(blue[1] < 0.3);

    for (const vec of [white, black, red, blue]) {
      const sum = vec.slice(2).reduce((total, n) => total + n, 0);
      assert.ok(Math.abs(sum - 1) < 1e-9);
    }
  });

  it("refuses an empty buffer", () => {
    assert.equal(fingerprintFromPixels(new Uint8Array(0), 0, 0), null);
    assert.equal(fingerprintFromPixels(new Uint8Array(8), 2, 2), null);
  });

  it("similarity is 1 for the same feel and null without a picture", () => {
    const vec = solid(180, 140, 90);
    assert.equal(imageSimilarity(vec, vec), 1);
    assert.equal(imageSimilarity(null, vec), null);
    assert.equal(imageSimilarity(vec, null), null);
    assert.equal(imageSimilarity(vec, vec.slice(0, 3)), null);
  });

  it("matches the job priors: push brighter, soft warmer and dimmer, people mid", () => {
    const prior = Object.fromEntries(JOBS.map((job) => [job.id, job.imagePrior]));
    const daylight = solid(214, 220, 228);
    const lamp = solid(120, 64, 36);
    const room = solid(140, 132, 120);

    assert.ok(imageSimilarity(daylight, prior.push) > imageSimilarity(lamp, prior.push));
    assert.ok(imageSimilarity(lamp, prior.soft) > imageSimilarity(daylight, prior.soft));
    assert.ok(imageSimilarity(room, prior.people) > imageSimilarity(daylight, prior.people));
    assert.ok(imageSimilarity(room, prior.people) > imageSimilarity(lamp, prior.people));
  });
});
