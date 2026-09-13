# remember

A tiny, single-page prototype of a **memory shard** — not a product, not a vault, not a feed.

**remember** is the idea that past-you can prod present-you with one useful piece of your own life (a photo bound to a note), without searching. You pick the job. The system picks the memory.

This page exists so the shard can be *felt*: layout, tone, and the meaning-link between image and words. It is not Apple Memories, not On This Day, not a collage. It should read like a short letter from an earlier self that helps *today*.

## The v0 loop

retrieve → rank → feedback. Each job is a query (a small grit / softness / people vibe, plus words). Every shard in the pool is scored with cosine similarity, a not-shown-recently term, a light recency term, and your keep / nah marks. The letter is whoever wins — **another** takes the next unused candidate, not a shuffle. Marks land in localStorage so the next ranking, even after a reload, can move. Open **why this ranked** to see the arithmetic; it is a classroom overlay, not a product surface.

## Jobs in this mock

1. **Need a push** — motivation when down
2. **Soft memory** — gentle continuity / texture
3. **Prep for people & names** — one true thing about someone before you see them

Quiet marks on the letter: **keep** (boost this shard for this job), **another** (weak negative, show the next-best unused), **nah** (demote, then move on).

Photos are Unsplash stand-ins (not personal photos). Copy is invented. No auth, no backend, no capture flow.

## Run

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

Shard copy and hand-authored vibe vectors live in `src/shards.js`. The scoring math lives in `src/ranker.js`. Layout and type live in `src/style.css`. Keep the page a letter.
