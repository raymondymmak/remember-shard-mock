# remember

A tiny, single-page prototype of a **memory shard** — not a product, not a vault, not a feed.

**remember** is the idea that past-you can prod present-you with one useful piece of your own life (a photo bound to a note), without searching. You pick the job. The system picks the memory.

This page exists so the shard can be *felt*: layout, tone, and the meaning-link between image and words. It is not Apple Memories, not On This Day, not a collage. It should read like a short letter from an earlier self that helps *today*.

## The v0 loop

retrieve → rank → feedback. Each job is a query (a small grit / softness / people vibe, plus words). Every shard in the pool is scored with cosine similarity, a not-shown-recently term, a light recency term, and your keep / nah marks. A photograph also gets a small fingerprint read in the browser from the pixels themselves — brightness, warmth, and a rough histogram — compared with what that job likes in a picture: push a bit brighter and outdoor, soft warmer and dimmer, people in the middle. It nudges the score. It does not overrule the note, and keep / nah do not train it. The letter is whoever wins — **another** takes the next unused candidate, not a shuffle. Marks land in localStorage so the next ranking, even after a reload, can move. Open **why this ranked** to see the arithmetic; it is a classroom overlay, not a product surface.

## This is supervised learning

keep and nah are labels: wanted / not wanted, stored with the score parts from that moment. **learn from my marks** fits a small logistic model (gradient descent, starting from the hand-written mix) that predicts P(keep) from those parts — job, freshness, recency, vibe, words. The ranking formula then uses the learned weights. **another** is ignored here; it is a skip, not a clean class. **reset to default mix** restores the prior. You can download the marks as JSON. No backend, no neural net.

## Train vs test

We hide the newest ~30% of keep/nah marks and fit only on the rest. Then we score both the default mix and the learned mix on the hidden marks (accuracy and log-loss). That holdout is the honest quiz: a mix can look clever on marks it already saw and still fail on ones it didn’t. If there aren’t enough hidden marks, we say so — we don’t invent a score. If the learned mix loses on the holdout, that’s overfitting, and we say that too.

## Bring your own

This is the population path, before Photos or Drive. Nothing is uploaded.

Under the letter: **bring a photo or a note**, **or a folder**, or drop files on the page. Photos are jpg, png, or webp. Notes are `.md` or `.txt`. The live site supports phone capture: take or choose a photo, add an optional short note, and it joins the pool.

- A note binds to a photo when they share a name (`hike.jpg` + `hike.md`), including differences in case and punctuation.
- One photo and one note dropped together, names aside, bind too.
- A photo alone gets a short first-person placeholder you can revise, and a provisional why-line from the job you have open.
- A note alone is a letter on warm paper.
- Several photos and one unrelated note stay separate, so a caption is not pasted onto the wrong frame.

Images are kept in IndexedDB. The words, the vibe guess, and the keep / nah log stay in localStorage, so a reload still has them. A keyword guess sets the grit / softness / people vector (mid values when the note doesn’t lean). Revise the note and that guess moves with it. Imported letters join the same pool as the samples — data, then retrieve, then rank. **samples in** / **samples aside** leaves the demo library in the pool or steps it out. keep / nah still teach the mix.

No account, no backend, no Google Photos or Drive API.

## Jobs in this mock

1. **Need a push** — motivation when down
2. **Soft memory** — gentle continuity / texture
3. **Prep for people & names** — one true thing about someone before you see them

Quiet marks on the letter: **keep** (boost this shard for this job), **another** (weak negative, show the next-best unused), **nah** (demote, then move on).

The sample photos are Unsplash stand-ins. Sample copy is invented. Your own files never leave the browser.

## Run

Live, without npm: https://raymondymmak.github.io/remember-shard-mock/

A push to `main` builds the page with GitHub Actions and publishes that URL. The workflow uses the default `GITHUB_TOKEN` only.

Locally:

```bash
npm install
npm run dev
```

Then open the local URL Vite prints (usually `http://localhost:5173`).

```bash
npm test
npm run build
npm run preview
```

## Iterate

Shard copy and hand-authored vibe vectors live in `src/shards.js`. The scoring math lives in `src/ranker.js`. The photograph's fingerprint lives in `src/image.js`. The tiny trainer lives in `src/train.js`. Turning local files into shards lives in `src/ingest.js`; keeping them lives in `src/library.js`. Layout and type live in `src/style.css`. Keep the page a letter.
