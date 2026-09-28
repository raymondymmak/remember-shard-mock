# remember

A tiny, single-page prototype of a **memory shard** — not a product, not a vault, not a feed.

**remember** is the idea that past-you can prod present-you with one useful piece of your own life (a photo bound to a note), without searching. You pick the job. The system picks the memory.

This page exists so the shard can be *felt*: layout, tone, and the meaning-link between image and words. It is not Apple Memories, not On This Day, not a collage. It should read like a short letter from an earlier self that helps *today*.

## The v0 loop

retrieve → rank → feedback. Each job is a query (a small grit / softness / people vibe, plus words). Every shard in the pool is scored with cosine similarity, a not-shown-recently term, a light recency term, and your keep / nah marks.

Word closeness uses a small sentence model, `Xenova/all-MiniLM-L6-v2`, through Transformers.js. It runs in the browser. The first visit may download the weights; after that they stay in the browser cache. Notes and photos are not uploaded, and there is no API key. The letter paints first and loads the model after. While it is loading — or if it cannot load — ranking uses the hashed word buckets in `embedText` instead. keep / nah still learn from the same score parts (closeness, freshness, recency, vibe, words). Only the vectors behind the word cosine change. A revised note is embedded again. The vectors themselves stay on this device, in IndexedDB next to the photographs. A return visit reuses them. Editing the note, replacing the photo, or changing the model (`minilm-l6-v2`, `clip-vit-base-patch32`) embeds again. A vector from a different model, or a different width, is never mixed into the cosine. A photograph also gets a small fingerprint read in the browser from the pixels themselves — brightness, warmth, and a rough histogram — compared with what that job likes in a picture: push a bit brighter and outdoor, soft warmer and dimmer, people in the middle. It nudges the score. It does not overrule the note, and keep / nah do not train it. Once `Xenova/clip-vit-base-patch32` is ready, that same image slot is a CLIP cosine between the photograph and the job’s words (one shared width, still in the browser); the fingerprint stays the fallback, and the two widths are never mixed. The letter is whoever wins. Under that letter, **prev** and **next** walk the rest of the same ranked pool. The **1 of 12** control between them opens every shard in that order, and it moves when you turn the page, change jobs, or mark like / dislike. Looking through the pool does not replace retrieve → rank, and it does not mark the others as shown. Marks land in localStorage so the next ranking, even after a reload, can move. **why this showed up** opens the same why-line that sits under the note, plus a few short reasons, with the score breakdown beside them in the same glass box.

The line under the note — why this helps today — is composed in the browser from the job you picked and from the note (a name, a verb, a short phrase), plus the picture when that read is ready. It is not a remote model. Ranking does not use that composed line.

## This is supervised learning

Like and dislike on the letter are the keep and nah marks. keep and nah are labels: wanted / not wanted, stored with the score parts from that moment. **learn from my marks** fits a small logistic model (gradient descent, starting from the hand-written mix) that predicts P(keep) from those parts — job, freshness, recency, vibe, words. The ranking formula then uses the learned weights. An older skip still sitting in the log is ignored here; it is not a clean class. **reset to default mix** restores the prior. You can download the marks as JSON. No backend. The learned mix is a small logistic model. It does not train the sentence vectors.

## Train vs test

We hide the newest ~30% of keep/nah marks and fit only on the rest. Then we score both the default mix and the learned mix on the hidden marks (accuracy and log-loss). That holdout is the honest quiz: a mix can look clever on marks it already saw and still fail on ones it didn’t. If there aren’t enough hidden marks, we say so — we don’t invent a score. If the learned mix loses on the holdout, that’s overfitting, and we say that too.

## Bring your own

This is the population path, before Photos or Drive. Nothing is uploaded.

Under the letter, one quiet box holds importing and the sample pool together: **take a photo**, **choose one**, **files**, or a **folder** — or drop files on the page — and **samples in** / **samples aside**. Photos are jpg, png, or webp. Notes are `.md` or `.txt`. A photo you take or choose can carry a short note before you keep it.

- A note binds to a photo when they share a name (`hike.jpg` + `hike.md`), including differences in case and punctuation.
- One photo and one note dropped together, names aside, bind too.
- A photo alone gets a short first-person placeholder you can revise. The why-line still comes from the job, and from the picture once that read is ready.
- A note alone is a letter on warm paper.
- Several photos and one unrelated note stay separate, so a caption is not pasted onto the wrong frame.

Images are kept in IndexedDB, and so are the note and photo vectors once a model has produced them. The words, the vibe guess, and the keep / nah log stay in localStorage, so a reload still has them. The vectors are not uploaded. A keyword guess sets the grit / softness / people vector (mid values when the note doesn’t lean). Revise the note and that guess moves with it. Imported letters join the pool — data, then retrieve, then rank. The first photo or note you keep sets the samples aside, so the letter ranks your shards; **samples in** brings the demo library back. keep / nah still teach the mix.

No account, no backend, no Google Photos or Drive API.

## Jobs in this mock

1. **Need a push** — motivation when down
2. **Soft memory** — gentle continuity / texture
3. **Prep for people & names** — one true thing about someone before you see them

Quiet marks on the letter: **like** and **dislike** (the keep and nah marks — like fills while keep is the latest mark for this shard and job, dislike fills while nah is, and tapping a filled icon lifts that mark). Leaving a letter unmarked and turning the page with **prev** / **next** is a pass. Switching shards or jobs reads the fill from the log again.

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

Shard copy and hand-authored vibe vectors live in `src/shards.js`. The scoring math lives in `src/ranker.js`. The why-line under the note is composed in `src/why.js`. Sentence meaning lives in `src/meaning.js`; the hashed fallback stays in `embedText`. The photograph's fingerprint lives in `src/image.js`; its CLIP embedding lives in `src/vision.js`. Saved vectors live in `src/embed-cache.js`. The tiny trainer lives in `src/train.js`. Turning local files into shards lives in `src/ingest.js`; keeping them lives in `src/library.js`. Layout and type live in `src/style.css`. Keep the page a letter.
