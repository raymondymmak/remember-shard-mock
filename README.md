# remember

A single-page letter. Past-you shows present-you one photo bound to a note. You pick the job. The system picks the memory.

Live, without npm: https://raymondymmak.github.io/remember-shard-mock/

This is how that page is put together on `main`, after shown-history sticks across reloads (`remember.shown.v0`).

## Product spine

Pick a job, rank photo-and-note shards, then like or dislike. The page is offline-first: notes and photos stay in the browser, and the line under the note is composed here. No cloud LLM writes that why-line.

- Three jobs in `src/shards.js`: **Need a push**, **Soft memory**, **Prep for people & names**.
- Every shard in the current pool is scored. The letter is whoever wins.
- Like and dislike are the keep and nah labels. They change the next ranking.
- Leaving a letter unmarked and turning the page with **prev** / **next** is a pass. Nothing is written to the mark log, and browsing does not mark those letters as shown.

## Repo, build, and deploy

Vite 6 and vanilla JS. No framework. One page.

| Path | Role |
| --- | --- |
| `index.html` | Document shell. Loads `src/style.css` and `src/main.js`. |
| `src/main.js` | Boot, DOM, events. The only file that paints the page. |
| `src/style.css` | Layout and type. |
| `src/shards.js` | The three jobs and the twelve sample letters. |
| `public/photos/` | Sample jpgs named like the shard ids (`push-run.jpg`, …). Unsplash stand-ins. Sample copy is invented. |
| `vite.config.js` | Dev base `/`. Pages base `/${repo}/` when `GITHUB_PAGES=true`. |
| `.github/workflows/pages.yml` | On push to `main`: `npm ci`, `npm test`, `npm run build`, upload `dist`, deploy Pages. |

Scripts in `package.json`: `dev` (Vite, port 5173), `build`, `preview` (port 4173), `test` (`node --test src/*.test.js`). Node 22 in the Pages workflow. The only runtime dependency is `@xenova/transformers`. The workflow uses the default `GITHUB_TOKEN` only.

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

`index.html` links Fraunces and Outfit from Google Fonts. Reading text is the serif. Controls are the sans, on the shared glass styles `.lens` and `.lens-seg`.

`src/onnx-env.js` keeps the ONNX wasm single-threaded because GitHub Pages is not cross-origin isolated, and it points wasm files at the jsDelivr copy of `@xenova/transformers`. Model weights use the browser Cache API when `caches` exists. Notes and photos are not uploaded.

Sample image URLs go through `publicUrl()` in `src/main.js`, which prefixes `import.meta.env.BASE_URL`. `blob:` and `data:` URLs are left alone. Local `npm run dev` stays at `/`.

## On-screen layout

The column is `.page`: `min(440px, calc(100% - 2.4rem))`, centered. Regions below are top to bottom as the DOM paints them.

### Room

- `body` is a parchment radial gradient (`--paper`, `--paper-deep`).
- `.grain` is a fixed noise overlay (`pointer-events: none`). It sits above the page.
- Dropping files adds `is-receiving` on `body` and shows `.receive` (“leave them here”). Owner: drag handlers in `src/main.js`, styles at the bottom of `src/style.css`.

### Mast

`header.mast`

- `.wordmark` — “remember”
- `.thesis` — “You pick the job. The system picks the memory.”
- `#meaning.meaning` — model status from `paintStatus()`. Sentence side: “loading meaning…”, “meaning ready”, or “word match, for now”. Photo side: “loading the photograph…”, “image ready”, or “photo feel, for now”.

### Jobs

`nav.jobs`, filled by `renderJobs()`.

- `.jobs-kicker` — “What do you need”
- `#jobs.jobs-row` — one `.job` button per job (`role="tab"`, `data-job`). The selected job has `.is-on`. The third job spans the row (`.job:nth-child(3)`).
- Click calls `chooseJob()`. That clears the browse freeze, ranks again, and shows the winner. Switching jobs reads like / dislike from the log for the new job.

### 1 of N, prev, and next

`nav#folio.folio`, above the letter. Hidden when the pool is empty. Owner: `renderFolio()` plus `src/browse.js`.

- `.folio-turn` holds three controls: `#folio-prev.folio-step` (“prev”), `#folio-all.folio-all` (the place label `#folio-place`, “1 of 12”), `#folio-next.folio-step` (“next”).
- The place comes from `rankPlace()`. Ends do not wrap (`stepRank`). Arrow keys do the same walk unless focus is in a field.
- `#folio-all` toggles `#folio-drawer` (`aria-expanded`, `aria-controls`). Open, the drawer lists `#folio-list`: each `.folio-item` is a thumb (`.folio-thumb` or `.folio-paper`), an index, and a clipped note. The current row is `.is-here`. Kicker: “ranked for this job”.
- The ranked id list is frozen in `folioIds` once you have left the retrieved letter (`state.browsed`). Freshness does not reshuffle “3 of 12” while you are browsing. A job change, a new import, learn, or reset clears that freeze.

### Letter card

`article#shard.shard` inside `section.stage`. Markup is `shardMarkup()` in `src/main.js`. Swap animation uses `.is-leaving` / `.is-entering` unless reduced motion is on.

Top to bottom inside the card:

- `.print` — the photo (`img`, sepia-leaning filter). No photo: `.print-paper` with a wash from `paperWash()`, a kicker (“a note” or “from you”), and a short line or an em dash.
- `blockquote.note` — the note. Imported letters get “revise the note” (`.revise`), which swaps in `#note-edit`.
- `.why-kicker` — “why this, why now”
- `p.why` — the composed why-line (`letterWhy()` → `composeWhy()` in `src/why.js`). Ranking does not read this string.
- `.when` — the date. Imported letters add `.yours` (“· yours”).
- `.marks` — like and dislike. See below.

Empty pool: `.empty-letter` (“Nothing in the pool yet.”).

### Like and dislike

Inside `.marks`. Two round buttons, class `.mark.mark-vote`:

- `.mark-like` — `data-act="keep"`, aria-label “like”. Thumb SVG `.mark-icon`.
- `.mark-dislike` — `data-act="nah"`, aria-label “dislike”. Same icon, flipped with `scaleY(-1)`.

Filled state is `.is-on` and `aria-pressed="true"`. One letter has one mark for the job you are on: like, dislike, or unmarked. Like replaces dislike and the reverse (`placeMark` in `src/marks.js`). A second tap on the filled icon clears it (`undoKeep` / `undoNah`); the other mark does not come back. Neither button turns the page.

`syncMarks()` reads the log with `isKept` / `isNixed`. An older `another` (skip) still in the log fills neither icon.

### Capture, import, and samples

`#capture.intake.pool-box`, under the letter. One glass plate. Copy for the invite and the cue comes from `poolFace()` in `src/own.js`.

- `#pool-invite` — “One of yours, if you want.” Hidden once you have a letter of your own, or while a capture draft is open.
- `#pool-cue` — “Ranking the samples.”, “Ranking my shards.”, or “Ranking the samples with yours.”
- `.intake-line` — **take a photo** (`#capture-take` → `#capture-camera`, `capture="environment"`), **choose one** (`#capture-choose` → `#capture-library`), **files** (`#bring-files` → `#pick-files`), **folder** (`#bring-folder` → `#pick-folder`). The file inputs are `.sr-only`.
- `#capture-draft` — preview (`.capture-print`), `#capture-note`, **keep this** / **let it go**. Kept photos go through `captureEntries()` then the same `intake()` path as a drop.
- `.samples-line` — `#samples-toggle.samples-act`. Label is “samples in” or “samples aside” (`aria-pressed`). The first shard that actually lands sets samples aside (`samplesAsideAfterIntake`). A later import leaves the toggle where you put it. Samples stay in `src/shards.js` either way; `library.rankingPool()` only decides who is ranked.
- `#bring-hint` — short status after an import (“Reading…”, counts, errors).

Dropping files on the window uses `entriesFromDataTransfer()` in `src/collect.js`. The file and folder inputs use `entriesFromFileList()`. Your own files never leave the browser.

### Why this showed up

`details#teach.teach` under the intake plate. The summary is the header of one glass box (`backdrop-filter`, same quiet plate as `.lens`). `renderTeach()` fills `#teach-body` when the details opens.

Inside `.teach-body`, in order:

- `.teach-lede` — the same why-line as under the note.
- `ul.teach-factors` — short reasons from `plainReasons()` in `src/why.js`.
- `.teach-scores`
  - kicker **how it scored**, list `.teach-list`: closeness to the job, then mood and words as `.is-sub` rows, photo meaning or photo feel when there is a picture, not shown recently, how recent the day was, your likes and dislikes, then `.is-total` **together**.
  - kicker **closest three**, list `.teach-also`. The first three ids in the frozen folio order, with their totals. The letter you are on is `.is-here`.
- If a learned mix is stored: kicker **the mix**, default weight → learned weight for each `MIX_KEYS` entry. Moved rows are `.is-moved`.
- If a holdout report exists: kicker **train and test**, from `explainEval()`.
- A few `.teach-note` lines: imports join the pool, the why-line is local, vectors stay on the device, plus the last embed timing when there is one.
- `.teach-actions`: **learn from my marks**, **reset to default mix**, **download the marks**. An imported letter also gets **let this one go**.

## Data and ranking

Flow: ingest → pool → embed (or hash / fingerprint) → `rankShards` → letter. Feedback writes a log. The next rank reads it.

### Ingest

`src/collect.js` turns a file list or a drop into entries. `src/ingest.js` classifies and pairs them.

- Photos: jpg, png, webp. Notes: `.md`, `.txt`, `.markdown`.
- Pairing (`pairFiles`): same folder and same stem (case and punctuation ignored), then one leftover photo beside one leftover note in that folder, then a stem that is unique across the whole drop.
- A photo alone gets `draftNote()` and `placeholder: true`. A note alone is paper (`paper: true`). Several photos and one unrelated note stay separate.
- `vibeFromNote()` sets a grit / softness / people vector. Mid values when the note does not lean. Revising the note updates that guess.
- `buildImportedShards()` makes the draft. `library.rememberShards()` merges it (`mergePlan`: add, update a note on the same photo, or skip a duplicate).

### Samples versus the real pool

`library.rankingPool(samples)` in `src/library.js`:

- Samples in: the twelve `SHARDS` plus your letters.
- Samples aside: your letters only.
- `includeSamples` lives in `remember.library.v0`. Default is on.

### Embeddings

Two models, both after first paint. `optimizeDeps.exclude` keeps `@xenova/transformers` out of the eager Vite scan. Dynamic `import()` is inside `src/meaning.js` and `src/vision.js`.

| Signal | Module | Model id | Cache model string | Width | Fallback |
| --- | --- | --- | --- | --- | --- |
| Note and job words | `src/meaning.js` | `Xenova/all-MiniLM-L6-v2` | `minilm-l6-v2` | 384 | `embedText` in `src/ranker.js`, 48 hashed buckets |
| Photograph vs job words | `src/vision.js` | `Xenova/clip-vit-base-patch32` | `clip-vit-base-patch32` | 512 | 6-d fingerprint in `src/image.js` |

`withTextVectors` and `withVisionVectors` attach a vector only when every job (and, for text, every shard) shares one width. A mismatch drops that channel. Hash, MiniLM, fingerprint, and CLIP are never cosine-mixed.

The fingerprint (`fingerprintImage`) shrinks the photo to 16×16 and stores `[brightness, warmth, dark, dim, light, bright]`. Each job has a hand-written `imagePrior` in the same shape. Similarity is 1 minus the average absolute difference (`imageSimilarity`). It is a light nudge (`WEIGHTS.image` is 0.08). It is not in `MIX_KEYS`, so keep / nah do not train it.

While a model is loading, or if it fails or times out (120s sentence, 180s vision), ranking keeps the fallback. When a model becomes ready, `maybeAdopt()` may swap the letter to the new winner, unless you have marked it, are browsing, are editing, or have already walked past a shard (`usedIds`).

### Cache keys

`src/embed-cache.js`. IndexedDB store `embeddings` in the database `remember` (see Persistence). Key shape is `` `${kind}:${id}` `` via `embedKey`.

A stored record is a hit only when `model`, `fingerprint`, and `dim` all match.

| Kind | Id | Fingerprint |
| --- | --- | --- |
| `job` | job id | FNV-1a of the job document (`label` + `hint` + `query`) |
| `note` | shard id | FNV-1a of `note` + `why` |
| `vision-job` | job id | same text fingerprint as the job document |
| `image` | shard id | hash of the photo bytes, or a path / file stamp if the bytes cannot be read (`photoFingerprintOf`) |

`embedCache.forget(id)` deletes `note:${id}` and `image:${id}`. Job vectors stay. A revised note, a replaced photo, or a different model id is a miss and is embedded again.

The 6-d fingerprint is not in this store. `src/main.js` keeps it in the `imageFeel` map for the visit.

### Ranking

`rankShards()` / `explainShard()` in `src/ranker.js`.

Job document: `jobDocument()` = label, hint, and query. Shard document: `shardDocument()` = note and the stored `why` field. That stored `why` is sample copy or an import placeholder. It is not the composed line on the card.

Inside job closeness: `0.72 * cosine(vibes) + 0.28 * cosine(text vectors)`.

Default mix (`WEIGHTS`):

| Part | Weight | What it is |
| --- | --- | --- |
| `job` | 0.58 | vibe share + text share, above |
| `freshness` | 0.14 | `freshnessScore` from last-shown time. Unseen is 1. Just shown is 0, then `1 - exp(-hours / 8)`. |
| `recency` | 0.08 | `1 / (1 + years)` from the shard date. Small on purpose. |
| `vibe` | 0 | Extra slot. Already inside `job`. Training may give it weight. |
| `text` | 0 | Same. |
| `feedback` | 0.20 | `tanh` of keep (+1) and nah (−1.2) for this shard and this job. An old `another` still counts as −0.25. The learned mix does not replace this weight. |
| `image` | 0.08 | CLIP cosine, or fingerprint similarity. `null` (paper, or not read yet) adds 0. |

`MIX_KEYS` is `job`, `freshness`, `recency`, `vibe`, `text`. Ties break by shard id.

`pickCandidate()` is the retrieve step. It ranks with `state.usedIds` excluded, and `applyShard()` calls `store.markShown` for the letter that lands. Browsing does not.

### Shown history

`remember.shown.v0` in `src/store.js`. Map of shard id → last shown timestamp. Cap 400, oldest dropped. `boot()` calls `loadShown()` before the first rank, so freshness still moves after a reload.

What writes a time: the retrieved letter (`applyShard`, including boot, job change, after learn or reset, and the winner after an import). What does not: **prev**, **next**, and picking a row in the drawer (`swapTo(..., { rememberShown: false })`). Looking through the pool does not mark the others as shown.

The folio and the why-box re-rank with the current letter’s id removed from `shown`, so the letter you are looking at is not punished for being on screen.

### Why-line

`src/why.js`. `composeWhy()` builds one sentence from the job, a name or verb or short phrase in the note, and the picture when that read is ready. `plainReasons()` is the bullet list in the glass box. Neither string is a score input.

### Learning the mix

`src/train.js`. **learn from my marks** fits a small logistic model by gradient descent, starting from the hand-written mix, on `MIX_KEYS` only. It needs at least two keep and two nah examples (`inspectLog`). Newest ~30% of labeled marks are held out (`splitExamples`). If that holdout is smaller than 2, there is no quiz score. The report is stored next to the weights and rendered by `explainEval()`. **reset to default mix** deletes the weights. **download the marks** saves `remember-marks.json` (`{ v: 1, log }`). `another` events are ignored as training labels.

## Persistence

Nothing is uploaded. If `localStorage` or IndexedDB is missing, the tab keeps a memory fallback (`__rememberFeedback`, `__rememberShown`, `__rememberWeights`, `__rememberLibrary`).

### localStorage

| Key | Shape | Owner |
| --- | --- | --- |
| `remember.feedback.v0` | `{ v: 1, log }` last 200 events. Each event: `shardId`, `job`, `action` (`keep`, `nah`, or a legacy `another`), `timestamp`, `scores`. | `src/store.js` |
| `remember.weights.v0` | `{ v: 2, mix, eval }`. `mix` is the learned weights. `eval` is the holdout report. | `src/store.js` |
| `remember.shown.v0` | `{ v: 1, shown }` map of shard id → timestamp. Cap 400. | `src/store.js` |
| `remember.library.v0` | `{ v: 1, includeSamples, shards }`. Shard rows keep words, vibe, date, filenames, fingerprint stamp, placeholder flag. Not the photo bytes. | `src/library.js` |

### IndexedDB

Database name `remember`, version 2. Opened by `openRememberDb()` in `src/library.js`.

| Store | Contents |
| --- | --- |
| `photos` | Image blobs, keyed by imported shard id. |
| `embeddings` | Vectors from `src/embed-cache.js`. See cache keys above. |

## Tests

`npm test` runs `node --test src/*.test.js`. Tests sit next to the module they cover. There is no browser runner and no test for `main.js`, `style.css`, `shards.js`, `library.js`, `collect.js`, or `onnx-env.js`.

| File | Covers |
| --- | --- |
| `src/ranker.test.js` | Cosine, hash embed, mix, freshness, recency, feedback, rank order, vector-width guards. |
| `src/why.test.js` | Composed why-line and plain reasons. |
| `src/meaning.test.js` | Sentence embedder status, timeout, width guard. |
| `src/vision.test.js` | CLIP status, timeout, shared width. |
| `src/image.test.js` | 6-d fingerprint and similarity. |
| `src/embed-cache.test.js` | Key, fingerprint, hit / miss, dim and model mismatch. |
| `src/ingest.test.js` | Classify, pair, draft note, vibe, paper, import ids. |
| `src/own.test.js` | Pool face copy and samples-aside, including `remember.library.v0`. |
| `src/marks.test.js` | Like / dislike replace and undo. |
| `src/store.test.js` | Feedback log, weights, and `remember.shown.v0` across a reload. |
| `src/browse.test.js` | “N of M”, step, no wrap. |
| `src/train.test.js` | Fit, holdout, skip ignored. |

## Module index

| Module | Owns |
| --- | --- |
| `src/main.js` | Boot, paint, events, when to re-rank or adopt a new winner. |
| `src/style.css` | Room, glass, letter, folio, intake, why box. |
| `src/shards.js` | `JOBS`, `SHARDS`. |
| `src/collect.js` | File list and folder drop → entries. |
| `src/ingest.js` | Classify, pair, vibe, paper, import drafts. |
| `src/library.js` | Your letters, samples toggle, photo blobs. |
| `src/own.js` | Invite / cue copy, first-import samples aside. |
| `src/meaning.js` | Sentence model. |
| `src/vision.js` | CLIP. |
| `src/image.js` | Photo fingerprint. |
| `src/embed-cache.js` | Saved vectors and cache keys. |
| `src/onnx-env.js` | Transformers.js browser setup. |
| `src/ranker.js` | Score and sort. |
| `src/why.js` | Why-line and reason bullets. |
| `src/browse.js` | Place in the ranked list, prev / next step. |
| `src/marks.js` | Like / dislike as one state per shard and job. |
| `src/store.js` | Feedback log, learned mix, shown times. |
| `src/train.js` | Logistic mix and holdout. |
