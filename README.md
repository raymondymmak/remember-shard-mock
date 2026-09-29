# remember

One photo, one note, brought back when it would help.

**remember** is a small offline letter for passive resurfacing. You say what today needs. It picks one shard of your own life — a photograph bound to a few words — and shows it like a note from an earlier self. For anyone who captures a lot and almost never goes back to look.

**Live:** https://raymondymmak.github.io/remember-shard-mock/

## Why

The camera roll gets longer. The useful bits stay buried. The bet is small: past-you can prod present-you with one true thing — a push when the day is heavy, a quiet ordinary moment, or one fact about a person before you walk in. You pick the job. The page picks the memory.

## What’s working

- **Job, then a letter.** Three jobs: Need a push, Soft memory, Prep for people & names. Every shard in the pool is scored. The letter is whoever wins.
- **Like and dislike.** Those are the keep and nah marks, stored with the score from that moment, so the next ranking can move — including after a reload. One letter, one mark, for the job you are on. Tap the filled icon again and it clears. Leave it unmarked and turn the page: that is a pass. Prev and next do not write a mark, and they do not count the other letters as shown.
- **Your files, on this machine.** Take a photo, choose one, pick files or a folder, or drop them on the page. A shared name binds a note to a photo (`hike.jpg` + `hike.md`). One photo and one note dropped together bind too. A photo alone gets a short placeholder you can revise. A note alone is a letter on warm paper. The first real shard sets the sample library aside.
- **Meaning in the browser.** Notes use a small sentence model (`all-MiniLM-L6-v2`). Photos use CLIP against the job’s words. The letter paints first. While the weights download — or if they never do — ranking uses hashed words and a brightness/warmth fingerprint read from the pixels. Vectors are cached on the device and reused until the note, the photo, or the model changes.
- **Why this showed up.** The line under the note is composed here from the job and the note (a name, a verb, a short phrase), and from the picture once that read is ready. The glass box under the letter opens the same line, a few reasons, how it scored, the total, and the closest three.
- **A mix you can teach, per job.** “Learn from this job” fits a small logistic model on the keep and nah marks for the job you are on. Ranking for that job uses that job’s weights. A job with fewer than two keeps and two nahs stays on the hand-written mix; marks on the other jobs do not count. “Reset this job’s mix” clears only the job you are on. An older shared mix still in this browser is kept as a fallback until that job learns its own, or you reset it. The newest marks on that job are hidden as a quiz. If there are not enough held-out marks, it says so. You can download the log as JSON.

Sample photos are Unsplash stand-ins. The sample copy is invented.

## How it’s put together

One narrow column. Top to bottom on the page:

1. **Room.** Parchment, plus a grain overlay. Dropping files covers it with “leave them here.”
2. **Mast.** The wordmark, “You pick the job. The system picks the memory.”, and a quiet status while the models load.
3. **Jobs.** Three tabs under “What do you need.”
4. **The pool, above the letter.** Prev, “1 of N”, next. “1 of N” opens every shard in ranked order. That order stays put while you browse, so the count does not reshuffle under you. Ends do not wrap. Arrow keys walk the same list.
5. **The letter.** The photo, or warm paper when there is no photo. The note. “Why this, why now.” The date. Like and dislike.
6. **Bring your own.** Take a photo, choose one, files, folder, and samples in / samples aside. One quiet plate.
7. **Why this showed up.** One glass box. Learn this job, reset this job’s mix, download, and (for a letter of yours) let this one go, live inside it.

`index.html` is the shell. `src/main.js` boots the page and paints it. `src/style.css` is the room, the type, and the glass.

| Module | What it owns |
| --- | --- |
| `src/shards.js` | The three jobs and the twelve sample letters |
| `src/ranker.js` | The score. Highest total is the letter |
| `src/why.js` | The why-line and the short reasons |
| `src/meaning.js` | Sentence embeddings |
| `src/vision.js` | CLIP for the photograph |
| `src/image.js` | The fingerprint, until CLIP is ready |
| `src/embed-cache.js` | Saved vectors |
| `src/ingest.js`, `src/collect.js` | Turning a drop or a file picker into shards |
| `src/library.js` | Your letters, and whether samples are in the pool |
| `src/marks.js`, `src/store.js` | Like / dislike, the learned mix, last-shown times |
| `src/browse.js` | “1 of N”, prev, next |
| `src/train.js` | The logistic fit and the holdout |
| `src/own.js` | The invite line and the samples toggle |

The score is a mix: closeness to the job (a grit / softness / people vibe, plus the words), your marks, not-shown-recently, a light recency term, and a small read of the photo. Default weights are job `0.58`, feedback `0.20`, freshness `0.14`, recency `0.08`, image `0.08`. Vibe and words already sit inside job closeness, so their extra weights start at `0` until your marks ask for them. The photo can nudge. It cannot drown the note.

Last-shown times live in `remember.shown.v0`. A reload still knows what was retrieved. Browsing the pool does not stamp the rest as shown.

## Run it

Vite and vanilla JS. No framework. The only runtime dependency is `@xenova/transformers`. A push to `main` runs the tests, builds, and publishes the live page with GitHub Actions.

```bash
git clone https://github.com/raymondymmak/remember-shard-mock.git
cd remember-shard-mock
npm install
npm run dev
```

Open the URL Vite prints, usually http://localhost:5173.

```bash
npm test
npm run build
npm run preview
```

`npm test` runs `node --test src/*.test.js`. The tests sit next to the modules they cover.

Locally the site is at `/`. The Pages build uses `/remember-shard-mock/` so the sample photos still resolve.

## Locks

- You pick the job. The page picks one memory.
- Offline. Notes, photos, and vectors stay in this browser. No account, no API key. Bringing your own is a file or a picture you take — there is no Photos or Drive connection.
- The why-line is composed here. No cloud LLM writes it. Ranking does not use that sentence.
- Like and dislike teach the mix of the job you are on — job, freshness, recency, vibe, and words. They do not teach the other jobs, and they do not teach the photo nudge or the feedback weight.
- A vector from another model, or another width, is never folded into the same cosine. Hash, MiniLM, the fingerprint, and CLIP each stay in their own slot.

On this device:

| Key | Holds |
| --- | --- |
| `remember.feedback.v0` | The like / dislike log |
| `remember.weights.v0` | Each job’s learned mix, and that job’s holdout note. An older flat mix is kept as a shared fallback |
| `remember.shown.v0` | When each shard was last retrieved |
| `remember.library.v0` | Your words, and whether the samples are in |

Photos and embedding vectors sit in IndexedDB, database `remember`, beside that log.

## Where it is

The letter works. The pool is the twelve samples plus whatever you keep locally, and a shown time survives a reload so the same shard is a little less eager to win again. That is the current edge of it.
