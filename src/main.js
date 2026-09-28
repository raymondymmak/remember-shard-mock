import { JOBS as RAW_JOBS, SHARDS as RAW_SHARDS } from "./shards.js";
import { fingerprintImage } from "./image.js";
import {
  MIX_KEYS,
  WEIGHTS,
  explainShard,
  jobDocument,
  prepareJobs,
  rankShards,
  shardDocument,
  withTextVectors,
} from "./ranker.js";
import { CACHE_MODEL as NOTE_MODEL, meaning } from "./meaning.js";
import { CACHE_MODEL as IMAGE_MODEL, vision } from "./vision.js";
import { embedCache, photoFingerprintOf, textFingerprint } from "./embed-cache.js";
import { explainEval, inspectLog, learnAndEvaluate } from "./train.js";
import * as store from "./store.js";
import * as library from "./library.js";
import { entriesFromDataTransfer, entriesFromFileList } from "./collect.js";
import {
  buildImportedShards,
  captureEntries,
  classifyEntry,
  describeIntake,
  draftNote,
  noteBody,
  pairFiles,
  paperLine,
  paperWash,
  vibeFromNote,
} from "./ingest.js";
import { composeWhy } from "./why.js";
import { poolFace } from "./own.js";
import { isKept, isNixed } from "./marks.js";
import { rankPlace, stepRank } from "./browse.js";

let JOBS = prepareJobs(RAW_JOBS);

const jobsEl = document.querySelector("#jobs");
const shardEl = document.querySelector("#shard");
const teachEl = document.querySelector("#teach");
const teachBodyEl = document.querySelector("#teach-body");
const hintEl = document.querySelector("#bring-hint");
const inviteEl = document.querySelector("#pool-invite");
const cueEl = document.querySelector("#pool-cue");
const samplesBtn = document.querySelector("#samples-toggle");
const pickFilesEl = document.querySelector("#pick-files");
const pickFolderEl = document.querySelector("#pick-folder");
const captureCameraEl = document.querySelector("#capture-camera");
const captureLibraryEl = document.querySelector("#capture-library");
const captureDraftEl = document.querySelector("#capture-draft");
const capturePreviewEl = document.querySelector("#capture-preview");
const captureNoteEl = document.querySelector("#capture-note");
const meaningEl = document.querySelector("#meaning");
const folioEl = document.querySelector("#folio");
const folioPlaceEl = document.querySelector("#folio-place");
const folioRankEl = document.querySelector("#folio-rank");
const folioPrevEl = document.querySelector("#folio-prev");
const folioNextEl = document.querySelector("#folio-next");
const folioAllEl = document.querySelector("#folio-all");
const folioDrawerEl = document.querySelector("#folio-drawer");
const folioListEl = document.querySelector("#folio-list");

const capture = {
  file: null,
  url: "",
};

let pool = [];
let booted = false;
// Fingerprints are cheap, but we still keep them so a rebuild doesn't
// decode the same photograph again. Vision vectors are the semantic
// stand-in for the same photographs, keyed the same way.
const imageFeel = new Map();
const visionById = new Map();
let jobVision = null;
const photoPrints = new Map();
let vectorNote = "";

const state = {
  job: "push",
  shardId: null,
  usedIds: new Set(),
  ranking: [],
  animating: false,
  kept: false,
  nixed: false,
  // True after like or dislike on the letter now showing, so a loading model
  // does not swap it away. The icons themselves are read from the log.
  held: false,
  // True once prev / next / all shards has left the retrieved letter.
  // The ranked order stays put until the next retrieve.
  browsed: false,
  marking: false,
  editing: false,
  busy: false,
  trainNote: "",
  textMode: "hash",
};

// Shard ids in ranked order for the folio. Frozen while browsing so
// "3 of 12" does not reshuffle as freshness updates.
let folioIds = [];

function currentJob() {
  return JOBS.find((job) => job.id === state.job);
}

function currentShard() {
  return pool.find((shard) => shard.id === state.shardId);
}

function publicUrl(path) {
  if (!path) return "";
  // blob: and data: already point at the bytes. Sample photos are site-relative
  // and need the Pages base (/remember-shard-mock/ in production, / locally).
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return path;
  const base = import.meta.env.BASE_URL || "/";
  return `${base}${String(path).replace(/^\//, "")}`;
}

const TEXT_COPY = {
  loading: "loading meaning…",
  ready: "meaning ready",
  fallback: "word match, for now",
};

function paintStatus() {
  if (!meaningEl) return;
  const text = TEXT_COPY[meaning.status()] || "";
  const imageStatus = vision.status();
  let image = "";
  if (imageStatus === "loading") {
    const pct = vision.progress();
    image =
      pct == null ? "loading the photograph…" : `loading the photograph… ${Math.round(pct * 100)}%`;
  } else if (imageStatus === "ready") {
    image = "image ready";
  } else if (imageStatus === "fallback") {
    image = "photo feel, for now";
  }
  meaningEl.textContent = [text, image].filter(Boolean).join(" · ");
}

function rawShards() {
  return library.rankingPool(RAW_SHARDS);
}

let vectorGen = 0;
let vectorFlight = Promise.resolve();

function photoKey(shard) {
  return shard.photo ? publicUrl(shard.photo) : null;
}

function rememberVision(raw, result) {
  if (!result || result.mode !== "semantic") {
    jobVision = null;
    visionById.clear();
    return;
  }
  jobVision = result.jobVectors;
  visionById.clear();
  raw.forEach((shard, i) => {
    const vec = result.photoVectors[i];
    if (vec) visionById.set(shard.id, vec);
  });
}

function pullCachedVision(raw) {
  const cached = vision.cachedJobsAndPhotos(RAW_JOBS.map(jobDocument), raw.map(photoKey));
  if (cached) rememberVision(raw, { mode: "semantic", ...cached });
}

// Text refresh rebuilds the pool. Fingerprints and CLIP vectors are put
// back on afterwards so one update cannot wipe the other.
function attachSideChannels() {
  const dim = jobVision?.[0]?.length || 0;
  const jobsAligned =
    dim > 0 && jobVision.length === JOBS.length && jobVision.every((vec) => vec?.length === dim);

  JOBS = JOBS.map((job, i) => {
    const next = { ...job };
    delete next.visionVec;
    if (jobsAligned) next.visionVec = jobVision[i];
    return next;
  });

  pool = pool.map((shard) => {
    const next = { ...shard };
    delete next.imageVec;
    delete next.visionVec;
    const feel = imageFeel.get(shard.id);
    if (feel) next.imageVec = feel;
    const seen = visionById.get(shard.id);
    if (jobsAligned && seen?.length === dim) next.visionVec = seen;
    return next;
  });
}

function applyVectors(mode, jobVecs, shardVecs, raw = rawShards()) {
  const projected = withTextVectors(RAW_JOBS, raw, jobVecs, shardVecs, mode);
  JOBS = projected.jobs;
  pool = projected.shards;
  state.textMode = projected.mode === "semantic" ? "semantic" : "hash";
  pullCachedVision(raw);
  attachSideChannels();
  return state.textMode;
}

function applyCachedOrHash() {
  const raw = rawShards();
  const jobDocs = RAW_JOBS.map(jobDocument);
  const shardDocs = raw.map(shardDocument);
  const cached = meaning.cachedDocuments([...jobDocs, ...shardDocs]);
  if (!cached) return applyVectors("hash", null, null, raw);
  return applyVectors(
    "semantic",
    cached.slice(0, jobDocs.length),
    cached.slice(jobDocs.length),
    raw,
  );
}

function noteVectorStats(stats, ms) {
  const line = `${stats.hits} reused, ${stats.encoded} encoded, ${Math.round(ms)}ms`;
  console.info(`[remember] text: ${line}`);
  return line;
}

function imageVectorStats(stats, ms) {
  const line = `${stats.hits} reused, ${stats.encoded} encoded, ${Math.round(ms)}ms`;
  console.info(`[remember] photos: ${line}`);
  return line;
}

const vectorTiming = { text: "", photos: "" };

function publishVectorTiming(kind, line) {
  vectorTiming[kind] = line ? `${kind} ${line}` : "";
  const both = [vectorTiming.text, vectorTiming.photos].filter(Boolean).join(" · ");
  vectorNote = both ? `On this device — ${both}.` : "";
}

async function photoFingerprint(shard) {
  if (!shard?.photo && !shard?.hasPhoto) return "";
  const memoKey = `${shard.id}:${shard.fingerprint || shard.photo || ""}`;
  if (photoPrints.has(memoKey)) return photoPrints.get(memoKey);
  const print = await photoFingerprintOf(shard, {
    readBlob: shard.imported && shard.hasPhoto ? (id) => library.readPhoto(id) : null,
    fetchBytes: async (url) => {
      const response = await fetch(publicUrl(url));
      if (!response.ok) return null;
      return new Uint8Array(await response.arrayBuffer());
    },
  });
  if (print) photoPrints.set(memoKey, print);
  return print;
}

function noteItems(jobDocs, shardDocs, raw, dim) {
  return [
    ...RAW_JOBS.map((job, i) => ({
      kind: "job",
      id: job.id,
      model: NOTE_MODEL,
      fingerprint: textFingerprint(jobDocs[i]),
      dim,
      text: jobDocs[i],
    })),
    ...raw.map((shard, i) => ({
      kind: "note",
      id: shard.id,
      model: NOTE_MODEL,
      fingerprint: textFingerprint(shardDocs[i]),
      dim,
      text: shardDocs[i],
    })),
  ];
}

async function refreshVectors() {
  const gen = ++vectorGen;
  const raw = rawShards();
  const jobDocs = RAW_JOBS.map(jobDocument);
  const shardDocs = raw.map(shardDocument);
  const started = performance.now();

  if (meaning.status() === "loading") await meaning.load();

  const ready = meaning.status() === "ready" && meaning.vectorWidth() > 0;
  let mode = "hash";
  let jobVecs = null;
  let shardVecs = null;
  let stats = { hits: 0, encoded: 0 };

  if (ready) {
    const dim = meaning.vectorWidth();
    const items = noteItems(jobDocs, shardDocs, raw, dim);
    const resolved = await embedCache.resolve(items, async (missing) => {
      const embedded = await meaning.embedDocuments(missing.map((item) => item.text));
      if (embedded.mode !== "semantic") return { ok: false };
      return { ok: true, vectors: embedded.vectors };
    });
    stats = resolved;
    const aligned =
      !resolved.failed &&
      resolved.vectors.length === items.length &&
      resolved.vectors.every((vec) => vec?.length === dim);
    if (aligned) {
      mode = "semantic";
      jobVecs = resolved.vectors.slice(0, jobDocs.length);
      shardVecs = resolved.vectors.slice(jobDocs.length);
      meaning.rememberDocuments(
        items.map((item, i) => ({ text: item.text, vector: resolved.vectors[i] })),
      );
    }
  } else {
    const embedded = await meaning.embedDocuments([...jobDocs, ...shardDocs]);
    mode = embedded.mode === "semantic" ? "semantic" : "hash";
    if (mode === "semantic") {
      jobVecs = embedded.vectors.slice(0, jobDocs.length);
      shardVecs = embedded.vectors.slice(jobDocs.length);
    }
  }

  if (gen !== vectorGen) return mode;
  const rawNow = rawShards();
  const same =
    rawNow.length === raw.length &&
    rawNow.every((shard, i) => shard.id === raw[i].id && shardDocument(shard) === shardDocs[i]);
  if (!same) return mode;

  if (mode === "semantic" && ready) {
    publishVectorTiming("text", noteVectorStats(stats, performance.now() - started));
  }
  applyVectors(mode, jobVecs, shardVecs, rawNow);
  if (booted && teachEl?.open) renderTeach();
  refreshLetterWhy();
  return state.textMode;
}

function scheduleVectors() {
  const run = refreshVectors().catch(() => {
    applyCachedOrHash();
    refreshLetterWhy();
    return state.textMode;
  });
  vectorFlight = run;
  return run;
}

let visionGen = 0;
let visionFlight = Promise.resolve();

async function refreshVision() {
  const gen = ++visionGen;
  const raw = rawShards();
  const photos = raw.map(photoKey);
  const jobDocs = RAW_JOBS.map(jobDocument);
  const started = performance.now();

  if (vision.status() === "loading") await vision.load();

  const dim = vision.status() === "ready" ? vision.vectorWidth() : 0;
  let result = { mode: "feel", jobVectors: jobDocs.map(() => null), photoVectors: photos.map(() => null) };
  let stats = { hits: 0, encoded: 0 };

  if (!dim) {
    result = await vision.embedJobsAndPhotos(jobDocs, photos);
  } else {
    const jobItems = RAW_JOBS.map((job, i) => ({
      kind: "vision-job",
      id: job.id,
      model: IMAGE_MODEL,
      fingerprint: textFingerprint(jobDocs[i]),
      dim,
      text: jobDocs[i],
    }));
    const photoItems = [];
    const photoAt = [];
    for (let i = 0; i < raw.length; i += 1) {
      if (!photos[i]) continue;
      const fingerprint = await photoFingerprint(raw[i]);
      if (!fingerprint) continue;
      photoAt.push(i);
      photoItems.push({
        kind: "image",
        id: raw[i].id,
        model: IMAGE_MODEL,
        fingerprint,
        dim,
        url: photos[i],
      });
    }

    const jobs = await embedCache.resolve(jobItems, async (missing) => {
      const embedded = await vision.embedJobsAndPhotos(
        missing.map((item) => item.text),
        [],
      );
      if (embedded.mode !== "semantic") return { ok: false };
      return { ok: true, vectors: embedded.jobVectors };
    });
    const frames = await embedCache.resolve(photoItems, async (missing) => {
      const embedded = await vision.embedJobsAndPhotos(
        [],
        missing.map((item) => item.url),
      );
      if (embedded.mode !== "semantic") return { ok: false };
      return { ok: true, vectors: embedded.photoVectors };
    });

    stats = {
      hits: jobs.hits + frames.hits,
      encoded: jobs.encoded + frames.encoded,
    };

    const jobVectors = jobs.failed ? null : jobs.vectors;
    const photoVectors = photos.map(() => null);
    if (!frames.failed) {
      frames.vectors.forEach((vec, j) => {
        photoVectors[photoAt[j]] = vec;
      });
    }
    const jobsOk =
      jobVectors &&
      jobVectors.length === jobDocs.length &&
      jobVectors.every((vec) => vec?.length === dim);
    const photosOk =
      !frames.failed &&
      photoVectors.every((vec) => vec == null || vec.length === dim);
    if (jobsOk && photosOk && vision.status() === "ready") {
      result = { mode: "semantic", jobVectors, photoVectors };
    }
  }

  if (gen !== visionGen) return result.mode;
  const rawNow = rawShards();
  const same =
    rawNow.length === raw.length &&
    rawNow.every((shard, i) => shard.id === raw[i].id && photoKey(shard) === photos[i]);
  if (!same) return result.mode;
  if (result.mode === "semantic" && dim) {
    publishVectorTiming("photos", imageVectorStats(stats, performance.now() - started));
  }
  rememberVision(rawNow, result);
  attachSideChannels();
  if (booted && teachEl?.open) renderTeach();
  refreshLetterWhy();
  return result.mode;
}

function scheduleVision() {
  const run = refreshVision().catch(() => {
    jobVision = null;
    visionById.clear();
    attachSideChannels();
    refreshLetterWhy();
    return "feel";
  });
  visionFlight = run;
  return run;
}

function rebuildPool() {
  const mode = applyCachedOrHash();
  const status = meaning.status();
  if (mode !== "semantic" && (status === "ready" || status === "loading")) {
    void scheduleVectors();
  }
  const imageStatus = vision.status();
  if (imageStatus === "ready" || imageStatus === "loading") {
    void scheduleVision();
  }
}

async function attachImageFeel(shards) {
  await Promise.all(
    shards.map(async (shard) => {
      if (!shard.photo) return;
      const cached = imageFeel.get(shard.id);
      if (cached) {
        shard.imageVec = cached;
        return;
      }
      try {
        const vec = await fingerprintImage(publicUrl(shard.photo));
        if (!vec) return;
      imageFeel.set(shard.id, vec);
      shard.imageVec = vec;
      const live = pool.find((item) => item.id === shard.id);
      if (live && live !== shard) live.imageVec = vec;
      } catch {
        // Words still rank. A picture we can't read simply has no image term.
      }
    }),
  );
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatWhen(iso) {
  const then = new Date(`${iso}T12:00:00`);
  const now = new Date();
  const months =
    (now.getFullYear() - then.getFullYear()) * 12 + (now.getMonth() - then.getMonth());
  const label = then.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  const sameDay =
    then.getFullYear() === now.getFullYear() &&
    then.getMonth() === now.getMonth() &&
    then.getDate() === now.getDate();

  let age;
  if (sameDay) age = "today";
  else if (months <= 0) age = "this month";
  else if (months < 2) age = "weeks ago";
  else if (months < 12) age = `${months} months ago`;
  else {
    const years = Math.max(1, Math.round(months / 12));
    age = years === 1 ? "1 year ago" : `${years} years ago`;
  }

  return `${label} · ${age}`;
}

function clip(text, n = 42) {
  const one = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const cut = one.length <= n ? one : `${one.slice(0, n).trim()}…`;
  return escapeHtml(cut);
}

function fmt(n) {
  return n.toFixed(2);
}

let hintLead = (hintEl?.textContent || "").replace(/\s+/g, " ").trim();

function paintHint(placement = currentPlacement()) {
  if (!hintEl) return;
  const rank = placement?.letter ? `This one ${placement.letter}.` : "";
  hintEl.textContent = [hintLead, rank].filter(Boolean).join(" ");
}

function setHint(text) {
  hintLead = String(text ?? "")
    .replace(/\s*This one ranked \d+(?:st|nd|rd|th) of \d+\.?/gi, "")
    .trim();
  paintHint();
}

function syncSamplesToggle() {
  if (!samplesBtn) return;
  const on = library.includeSamplesOn();
  samplesBtn.setAttribute("aria-pressed", on ? "true" : "false");
  samplesBtn.textContent = on ? "samples in" : "samples aside";
}

function syncPoolFace() {
  const face = poolFace({
    ownCount: library.list().length,
    includeSamples: library.includeSamplesOn(),
    drafting: Boolean(captureDraftEl && !captureDraftEl.hidden),
  });
  if (inviteEl) {
    inviteEl.textContent = face.invite;
    inviteEl.hidden = !face.invite;
  }
  if (cueEl) cueEl.textContent = face.cue;
  syncSamplesToggle();
}

function activeWeights() {
  return store.loadWeights() || WEIGHTS;
}

function rerank({ excludeIds = [], shown = store.shown() } = {}) {
  return rankShards({
    shards: pool,
    job: currentJob(),
    now: Date.now(),
    shown,
    log: store.log(),
    excludeIds,
    weights: activeWeights(),
  });
}

function shownForExplain() {
  const shown = { ...store.shown() };
  if (state.shardId) delete shown[state.shardId];
  return shown;
}

// usedIds still lets ranking walk past shards already set aside. The marks
// row no longer records a skip; prev / next browse without consuming.
function pickCandidate({ consumeCurrent = false } = {}) {
  if (consumeCurrent && state.shardId) {
    state.usedIds.add(state.shardId);
  }

  let ranking = rerank({ excludeIds: [...state.usedIds] });
  if (!ranking.length && pool.length) {
    const held = state.shardId;
    state.usedIds = new Set();
    ranking = rerank();
    if (held && ranking.length > 1) {
      state.usedIds = new Set([held]);
      ranking = rerank({ excludeIds: [held] });
    }
  }

  state.ranking = ranking;
  return ranking[0] ?? null;
}

function renderJobs() {
  jobsEl.innerHTML = JOBS.map((job) => {
    const selected = job.id === state.job;
    return `
      <button
        type="button"
        class="job ${selected ? "is-on" : ""}"
        role="tab"
        aria-selected="${selected}"
        data-job="${job.id}"
      >
        <span class="job-label">${job.label}</span>
        <span class="job-hint">${job.hint}</span>
      </button>
    `;
  }).join("");
}

function printMarkup(shard) {
  if (!shard.photo) {
    const wash = paperWash(shard.note || shard.id);
    const kicker = shard.hasPhoto ? "from you" : "a note";
    const line = paperLine(shard.note);
    const titled = String(shard.note || "").includes("\n") && line;
    return `
      <figure class="print print-paper" style="--wash: ${wash}">
        <p class="paper-kicker">${kicker}</p>
        ${
          titled
            ? `<p class="paper-line">${escapeHtml(line)}</p>`
            : `<p class="paper-mark" aria-hidden="true">—</p>`
        }
      </figure>
    `;
  }

  return `
    <figure class="print">
      <img src="${escapeHtml(publicUrl(shard.photo))}" alt="${escapeHtml(shard.photoAlt || "")}" />
    </figure>
  `;
}

function noteMarkup(shard) {
  if (state.editing && shard.imported) {
    return `
      <blockquote class="note">
        <label class="sr-only" for="note-edit">Revise this note</label>
        <textarea class="note-edit" id="note-edit" rows="5" autocomplete="off"></textarea>
        <button type="button" class="revise" data-act="done">done</button>
      </blockquote>
    `;
  }

  const revise = shard.imported
    ? `<button type="button" class="revise" data-act="revise">revise the note</button>`
    : "";
  return `
    <blockquote class="note">
      <p>${escapeHtml(shard.note)}</p>
      ${revise}
    </blockquote>
  `;
}

function letterWhy(shard) {
  const job = currentJob();
  if (!job || !shard) return "";
  const row = explainShard(shard, {
    job,
    now: Date.now(),
    shown: {},
    log: [],
  });
  return composeWhy({
    job,
    note: shard.note,
    placeholder: Boolean(shard.placeholder),
    hasPhoto: Boolean(shard.photo || shard.hasPhoto),
    photoAlt: shard.photoAlt || "",
    text: row.text,
    jobScore: row.parts.job,
    image: row.image,
    imageMode: row.imageMode,
    imageVec: shard.imageVec,
  });
}

function refreshLetterWhy() {
  if (!booted || state.editing) return;
  const shard = currentShard();
  const line = shardEl.querySelector(".why");
  if (shard && line) line.textContent = letterWhy(shard);
  if (!state.browsed) folioIds = [];
  renderFolio();
  if (teachEl?.open) renderTeach();
}

function currentPlacement() {
  const shard = currentShard();
  if (!shard) return null;
  const placement = rankPlace(folioShards(), shard.id);
  return placement.letter ? placement : null;
}

function syncMarks() {
  const log = store.log();
  state.kept = Boolean(state.shardId && isKept(log, state.shardId, state.job));
  state.nixed = Boolean(state.shardId && isNixed(log, state.shardId, state.job));
  return { like: state.kept, dislike: state.nixed };
}

function resetBrowse() {
  state.browsed = false;
  folioIds = [];
}

function shownForFolio() {
  const shown = { ...store.shown() };
  if (state.shardId) delete shown[state.shardId];
  return shown;
}

function ensureFolioOrder() {
  const missing = state.shardId && folioIds.length && !folioIds.includes(state.shardId);
  if (state.browsed && folioIds.length && !missing) return folioIds;
  folioIds = rerank({ excludeIds: [], shown: shownForFolio() }).map((row) => row.shard.id);
  return folioIds;
}

function folioShards() {
  const byId = new Map(pool.map((shard) => [shard.id, shard]));
  return ensureFolioOrder()
    .map((id) => byId.get(id))
    .filter(Boolean);
}

function voteIcon() {
  return `<svg class="mark-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path class="mark-icon-body" d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/>
    <path class="mark-icon-cuff" d="M7 10v12"/>
  </svg>`;
}

function paintVote(action, on) {
  const button = shardEl.querySelector(`[data-act="${action}"]`);
  if (!button) return;
  button.classList.toggle("is-on", on);
  button.setAttribute("aria-pressed", on ? "true" : "false");
}

function paintMarks() {
  paintVote("keep", state.kept);
  paintVote("nah", state.nixed);
}

function folioThumb(shard) {
  if (shard.photo) {
    return `<img src="${escapeHtml(publicUrl(shard.photo))}" alt="" />`;
  }
  const wash = paperWash(shard.note || shard.id);
  return `<span class="folio-paper" style="--wash: ${wash}"></span>`;
}

function folioItem(shard, index, here) {
  return `
    <li>
      <button
        type="button"
        class="folio-item${here ? " is-here" : ""}"
        data-shard="${escapeHtml(shard.id)}"
        ${here ? 'aria-current="true"' : ""}
      >
        <span class="folio-thumb">${folioThumb(shard)}</span>
        <span class="folio-copy">
          <span class="folio-index">${index + 1}${here ? " · this letter" : ""}</span>
          <span class="folio-note">${clip(shard.note, 72)}</span>
        </span>
      </button>
    </li>
  `;
}

function drawerOpen() {
  return folioAllEl?.getAttribute("aria-expanded") === "true";
}

function revealFolioHere() {
  if (!folioDrawerEl) return;
  const here = folioDrawerEl.querySelector(".is-here");
  if (!here) return;
  const drawerRect = folioDrawerEl.getBoundingClientRect();
  const hereRect = here.getBoundingClientRect();
  if (hereRect.top < drawerRect.top) {
    folioDrawerEl.scrollTop -= drawerRect.top - hereRect.top;
  } else if (hereRect.bottom > drawerRect.bottom) {
    folioDrawerEl.scrollTop += hereRect.bottom - drawerRect.bottom;
  }
}

function renderFolioList(shards) {
  if (!folioListEl) return;
  folioListEl.innerHTML = shards
    .map((shard, index) => folioItem(shard, index, shard.id === state.shardId))
    .join("");
  if (drawerOpen()) revealFolioHere();
}

function renderFolio() {
  if (!folioEl) return;
  const shard = currentShard();
  if (!shard) {
    folioEl.hidden = true;
    paintHint(null);
    return;
  }
  const shards = folioShards();
  const place = rankPlace(shards, shard.id);
  if (!place.total || place.index < 0) {
    folioEl.hidden = true;
    paintHint(null);
    return;
  }
  folioEl.hidden = false;
  if (folioPlaceEl) folioPlaceEl.textContent = place.label;
  if (folioRankEl) folioRankEl.textContent = `This one ${place.letter}.`;
  paintHint(place);
  if (folioPrevEl) folioPrevEl.disabled = place.index <= 0;
  if (folioNextEl) folioNextEl.disabled = place.index >= place.total - 1;
  if (drawerOpen()) renderFolioList(shards);
}

function setDrawer(open) {
  if (!folioAllEl || !folioDrawerEl) return;
  folioAllEl.setAttribute("aria-expanded", open ? "true" : "false");
  folioDrawerEl.hidden = !open;
  if (open) renderFolioList(folioShards());
}

function shardMarkup(shard) {
  const yours = shard.imported ? ' <span class="yours">· yours</span>' : "";
  return `
    ${printMarkup(shard)}
    ${noteMarkup(shard)}
    <p class="why-kicker">why this, why now</p>
    <p class="why">${escapeHtml(letterWhy(shard))}</p>
    <p class="when">${escapeHtml(formatWhen(shard.date))}${yours}</p>
    <div class="marks" role="group" aria-label="How this memory landed">
      <button type="button" class="mark mark-vote mark-like ${state.kept ? "is-on" : ""}" data-act="keep" aria-label="like" aria-pressed="${state.kept ? "true" : "false"}">
        ${voteIcon()}
      </button>
      <button type="button" class="mark mark-vote mark-dislike ${state.nixed ? "is-on" : ""}" data-act="nah" aria-label="dislike" aria-pressed="${state.nixed ? "true" : "false"}">
        ${voteIcon()}
      </button>
    </div>
  `;
}

function focusEditor(shard) {
  const area = shardEl.querySelector("#note-edit");
  if (!area) return;
  area.value = shard.note === draftNote() && shard.placeholder ? "" : shard.note;
  area.placeholder = draftNote();
  area.focus();
}

function poolLine() {
  return `<p class="teach-note">Imported letters join this pool — data, then retrieve, then rank.</p>
    <p class="teach-note">The line under the note is composed here from the job and the note — a name, a verb, a short phrase — and from the picture when that read is ready. No remote model writes it.</p>
    <p class="teach-note">Note and photo vectors stay on this device, next to the pictures. A changed note or a replaced photo is embedded again. Nothing is uploaded.</p>
    ${vectorNote ? `<p class="teach-note">${escapeHtml(vectorNote)}</p>` : ""}`;
}

function renderTeach() {
  const shard = currentShard();
  if (!shard) {
    teachBodyEl.innerHTML = poolLine();
    return;
  }

  const viewed = folioShards();
  const placement = rankPlace(viewed, shard.id);
  const ranked = rerank({ shown: shownForFolio() });
  const row = ranked.find((item) => item.shard.id === shard.id);
  if (!row || !placement.letter) {
    teachBodyEl.innerHTML = poolLine();
    return;
  }

  const byId = new Map(ranked.map((item) => [item.shard.id, item]));
  const top3 = viewed
    .slice(0, 3)
    .map((item) => byId.get(item.id))
    .filter(Boolean);
  const job = currentJob();
  const learned = store.loadWeights();
  const mixLabels = {
    job: "closeness to the job",
    freshness: "not shown recently",
    recency: "how recent the day was",
    vibe: "grit / softness / people",
    text: "words in the note",
  };

  teachBodyEl.innerHTML = `
    ${poolLine()}
    <p class="teach-lede">
      The job asked for <em>${escapeHtml(job.label)}</em>.
      Here is how this memory ${placement.teach}.
    </p>
    <p class="teach-kicker">how it scored</p>
    <ul class="teach-list">
      <li><span>closeness to the job</span><span>${fmt(row.parts.job)}</span></li>
      <li class="is-sub"><span>vibe cosine — grit / softness / people</span><span>${fmt(row.vibe)}</span></li>
      <li class="is-sub"><span>words in the note${state.textMode === "semantic" ? " · meaning" : ""}</span><span>${fmt(row.text)}</span></li>
      ${
        row.image == null
          ? ""
          : row.imageMode === "semantic"
            ? `<li><span>what the photo means</span><span>${fmt(row.image)}</span></li>
               <li class="is-sub"><span>the picture, against this job’s words</span></li>`
            : `<li><span>how the photo feels</span><span>${fmt(row.image)}</span></li>
               <li class="is-sub"><span>brightness ${fmt(shard.imageVec[0])}, warmth ${fmt(shard.imageVec[1])} — ${escapeHtml(job.imageHint || "")}</span></li>`
      }
      <li><span>not shown recently</span><span>${fmt(row.parts.freshness)}</span></li>
      <li><span>how recent the day was</span><span>${fmt(row.parts.recency)}</span></li>
      <li><span>your keep / nah marks</span><span>${fmt(row.parts.feedback)}</span></li>
      <li class="is-total"><span>together</span><span>${fmt(row.total)}</span></li>
    </ul>
    <p class="teach-kicker">closest three</p>
    <ul class="teach-also">
      ${top3
        .map((item) => {
          const here = item.shard.id === shard.id;
          return `<li class="${here ? "is-here" : ""}"><span>${clip(item.shard.note)}${here ? " · this letter" : ""}</span><span>${fmt(item.total)}</span></li>`;
        })
        .join("")}
    </ul>
    ${
      learned
        ? `<p class="teach-kicker">the mix</p>
           <p class="teach-lede teach-mix-lede">Default on the left. Learned on the right.</p>
           <ul class="teach-list teach-mix">
             ${MIX_KEYS.map((key) => {
               const now = Number(learned[key] ?? WEIGHTS[key]);
               const moved = Math.abs(now - WEIGHTS[key]) >= 0.02;
               return `<li class="${moved ? "is-moved" : ""}"><span>${mixLabels[key]}</span><span>${fmt(WEIGHTS[key])} → ${fmt(now)}</span></li>`;
             }).join("")}
           </ul>`
        : ""
    }
    ${evalMarkup(store.loadEval())}
    ${state.trainNote ? `<p class="teach-note">${escapeHtml(state.trainNote)}</p>` : ""}
    <div class="teach-actions">
      <button type="button" class="teach-act" data-train="learn">learn from my marks</button>
      <button type="button" class="teach-act" data-train="reset">reset to default mix</button>
      <button type="button" class="teach-act" data-train="export">download the marks</button>
      ${
        shard.imported
          ? `<button type="button" class="teach-act" data-train="forget">let this one go</button>`
          : ""
      }
    </div>
  `;
}

function renderEmpty() {
  shardEl.innerHTML = `
    <div class="empty-letter">
      <p>Nothing in the pool yet.</p>
      <p class="empty-aside">Take a photo, or bring a note. It will sit here like the others.</p>
    </div>
  `;
  renderTeach();
  renderFolio();
}

function renderShard() {
  const shard = currentShard();
  if (!shard) {
    renderEmpty();
    return;
  }
  syncMarks();
  shardEl.innerHTML = shardMarkup(shard);
  if (state.editing) focusEditor(shard);
  renderTeach();
  renderFolio();
}

function showEmpty() {
  state.shardId = null;
  state.kept = false;
  state.nixed = false;
  state.held = false;
  state.editing = false;
  resetBrowse();
  renderJobs();
  renderEmpty();
}

function applyShard(shard, { rememberShown = true } = {}) {
  state.shardId = shard.id;
  state.held = false;
  state.editing = false;
  if (rememberShown) store.markShown(shard.id);
  renderJobs();
  renderShard();
}

let flight = 0;

function swapTo(shard, { rememberShown = true } = {}) {
  if (!shard) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || state.animating || shard.id === state.shardId) {
    flight += 1;
    state.animating = false;
    shardEl.classList.remove("is-leaving", "is-entering");
    applyShard(shard, { rememberShown });
    return;
  }

  const token = ++flight;
  state.animating = true;
  shardEl.classList.add("is-leaving");

  window.setTimeout(() => {
    if (token !== flight) return;
    applyShard(shard, { rememberShown });
    shardEl.classList.remove("is-leaving");
    shardEl.classList.add("is-entering");
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (token !== flight) return;
        shardEl.classList.remove("is-entering");
      });
    });
    window.setTimeout(() => {
      if (token === flight) state.animating = false;
    }, 240);
  }, 220);
}

async function commitNote(text) {
  const shard = currentShard();
  if (!shard?.imported) return false;
  const written = noteBody(text);
  const note = written || draftNote();
  if (note === shard.note) return false;
  library.updateShard(shard.id, {
    note,
    vibe: vibeFromNote(note),
    placeholder: !written,
  });
  // A revised note needs a new vector. Wait only when meaning is already
  // here — otherwise the hash stands in and the model fills it in later.
  if (meaning.status() === "ready") await scheduleVectors();
  else rebuildPool();
  return true;
}

async function finishEditing() {
  const area = shardEl.querySelector("#note-edit");
  if (area) await commitNote(area.value);
  state.editing = false;
}

async function chooseJob(jobId) {
  if (!booted) return;
  if (jobId === state.job && state.shardId && !state.editing) return;
  await finishEditing();
  if (jobId === state.job && state.shardId) {
    renderShard();
    return;
  }
  state.job = jobId;
  state.usedIds = new Set();
  resetBrowse();
  const next = pickCandidate();
  if (next) swapTo(next.shard);
  else showEmpty();
}

function currentScores() {
  const ranked = rerank({ shown: shownForExplain() });
  return ranked.find((item) => item.shard.id === state.shardId) ?? ranked[0] ?? null;
}

function record(action) {
  const row = currentScores();
  const shard = currentShard();
  if (!shard) return;
  store.recordFeedback({
    shardId: shard.id,
    job: state.job,
    action,
    scores: row
      ? {
          total: row.total,
          job: row.parts.job,
          freshness: row.parts.freshness,
          recency: row.parts.recency,
          feedback: row.parts.feedback,
          vibe: row.vibe,
          text: row.text,
          image: row.image,
        }
      : {},
  });
}

// Like records keep; dislike records nah. A filled icon lifts that trailing
// mark. Neither one turns the page — prev and next do that. An unmarked
// letter is already a pass.
async function onVote(action) {
  if (state.marking || state.animating || state.busy) return;
  if (action !== "keep" && action !== "nah") return;
  const shardId = state.shardId;
  const jobId = state.job;
  if (!shardId) return;
  state.marking = true;
  const wasEditing = state.editing;
  try {
    await finishEditing();
    if (state.shardId !== shardId || state.job !== jobId) return;
    const log = store.log();
    const filled = action === "keep" ? isKept(log, shardId, jobId) : isNixed(log, shardId, jobId);
    if (filled) {
      if (action === "keep") store.undoKeep(shardId, jobId);
      else store.undoNah(shardId, jobId);
      state.held = false;
    } else {
      record(action);
      state.held = true;
    }
    syncMarks();
    if (wasEditing) renderShard();
    else {
      paintMarks();
      if (!state.browsed) renderFolio();
      if (teachEl?.open) renderTeach();
    }
  } finally {
    state.marking = false;
  }
}

async function browseBy(delta) {
  if (!booted || state.busy || state.animating || state.marking) return;
  state.marking = true;
  try {
    await finishEditing();
    ensureFolioOrder();
    const step = stepRank(
      folioIds.map((id) => ({ id })),
      state.shardId,
      delta,
    );
    if (!step) return;
    const shard = pool.find((item) => item.id === step.id);
    if (!shard || shard.id === state.shardId) return;
    state.browsed = true;
    swapTo(shard, { rememberShown: false });
  } finally {
    state.marking = false;
  }
}

async function openRanked(shardId) {
  if (!booted || state.busy || state.animating || state.marking) return;
  if (!shardId || shardId === state.shardId) return;
  state.marking = true;
  try {
    await finishEditing();
    ensureFolioOrder();
    if (!folioIds.includes(shardId)) return;
    const shard = pool.find((item) => item.id === shardId);
    if (!shard || shard.id === state.shardId) return;
    state.browsed = true;
    swapTo(shard, { rememberShown: false });
  } finally {
    state.marking = false;
  }
}

function showFresh(ids, summary) {
  if (!ids.size) {
    setHint(summary);
    return;
  }
  state.usedIds = new Set();
  resetBrowse();
  const ranking = rerank({ shown: shownForFolio() });
  const best = ranking.find((row) => ids.has(row.shard.id));
  if (!best) {
    setHint(summary);
    return;
  }
  setHint(summary);
  swapTo(best.shard);
}

async function intake(entries) {
  if (!booted || state.busy || !entries?.length) return false;
  state.busy = true;
  await finishEditing();
  setHint("Reading…");
  try {
    const grouped = pairFiles(entries.map(classifyEntry));
    const noteEntries = [...grouped.pairs.map((pair) => pair.note), ...grouped.noteOnly];
    const texts = new Map();
    await Promise.all(
      noteEntries.map(async (note) => {
        if (!note.file || typeof note.file.text !== "function") {
          texts.set(note.relativePath, "");
          return;
        }
        try {
          texts.set(note.relativePath, await note.file.text());
        } catch {
          texts.set(note.relativePath, "");
        }
      }),
    );

    const drafts = buildImportedShards(grouped, {
      jobId: state.job,
      textFor: (note) => texts.get(note.relativePath) || "",
    });
    const blobs = new Map();
    for (const draft of drafts) {
      if (draft.photoFile) blobs.set(draft.id, draft.photoFile);
    }
    const result = await library.rememberShards(drafts, blobs);
    rebuildPool();
    if (meaning.status() === "ready") await vectorFlight;
    const freshIds = new Set([...result.added, ...result.updated].map((shard) => shard.id));
    await attachImageFeel(pool.filter((shard) => freshIds.has(shard.id)));
    if (vision.status() === "ready") await visionFlight;
    const summary = describeIntake(grouped, {
      added: result.added.length,
      updated: result.updated.length,
      duplicate: result.duplicates.length,
    });
    showFresh(freshIds, summary);
    return true;
  } catch {
    setHint("Couldn’t keep those just now.");
    return false;
  } finally {
    syncPoolFace();
    state.busy = false;
  }
}

jobsEl.addEventListener("click", (event) => {
  const button = event.target.closest("[data-job]");
  if (!button || state.busy || state.marking) return;
  chooseJob(button.dataset.job);
});

shardEl.addEventListener("click", (event) => {
  const button = event.target.closest("[data-act]");
  if (!button || state.animating || state.busy || state.marking) return;
  const act = button.dataset.act;
  if (act === "revise") {
    state.editing = true;
    renderShard();
    return;
  }
  if (act === "done") {
    const area = shardEl.querySelector("#note-edit");
    void (async () => {
      if (area) await commitNote(area.value);
      state.editing = false;
      renderShard();
    })();
    return;
  }
  if (act === "keep" || act === "nah") void onVote(act);
});

shardEl.addEventListener("focusout", (event) => {
  if (event.target?.id !== "note-edit") return;
  void commitNote(event.target.value);
});

shardEl.addEventListener("keydown", (event) => {
  if (event.target?.id !== "note-edit") return;
  const done =
    event.key === "Escape" || ((event.metaKey || event.ctrlKey) && event.key === "Enter");
  if (!done) return;
  event.preventDefault();
  const area = event.target;
  void (async () => {
    await commitNote(area.value);
    state.editing = false;
    renderShard();
  })();
});

function evalMarkup(report) {
  const lines = explainEval(report);
  if (!lines.length) return "";
  return `
    <p class="teach-kicker">train and test</p>
    ${lines.map((line) => `<p class="teach-note">${escapeHtml(line)}</p>`).join("")}
  `;
}

async function onLearn() {
  await finishEditing();
  const check = inspectLog(store.log());
  if (!check.ok) {
    state.trainNote = check.reason;
    renderTeach();
    return;
  }
  const { weights, report } = learnAndEvaluate(store.log());
  store.saveWeights(weights, report);
  state.trainNote = `Learned from ${check.keeps} keep and ${check.nahs} nah.`;
  state.usedIds = new Set();
  resetBrowse();
  const next = pickCandidate();
  if (next) swapTo(next.shard);
  else showEmpty();
}

async function onResetMix() {
  await finishEditing();
  store.clearWeights();
  state.trainNote = "Back to the hand-written mix.";
  state.usedIds = new Set();
  resetBrowse();
  const next = pickCandidate();
  if (next) swapTo(next.shard);
  else showEmpty();
}

async function onForget() {
  const shard = currentShard();
  if (!shard?.imported) return;
  await finishEditing();
  await library.forget(shard.id);
  await embedCache.forget(shard.id);
  photoPrints.delete(`${shard.id}:${shard.fingerprint || shard.photo || ""}`);
  rebuildPool();
  syncPoolFace();
  state.usedIds = new Set();
  resetBrowse();
  setHint("Let go. The pool moved on.");
  const next = pickCandidate();
  if (next) swapTo(next.shard);
  else showEmpty();
}

async function onSamplesToggle() {
  if (!booted) return;
  await finishEditing();
  const shardId = state.shardId;
  library.setIncludeSamples(!library.includeSamplesOn());
  rebuildPool();
  syncPoolFace();
  state.usedIds = new Set();
  resetBrowse();
  if (shardId && pool.some((shard) => shard.id === shardId)) {
    renderJobs();
    renderShard();
    return;
  }
  const next = pickCandidate();
  if (next) swapTo(next.shard);
  else showEmpty();
}

teachEl.addEventListener("toggle", () => {
  if (teachEl.open) renderTeach();
});

teachEl.addEventListener("click", (event) => {
  const button = event.target.closest("[data-train]");
  if (!button) return;
  event.preventDefault();
  const act = button.dataset.train;
  if (act === "learn") void onLearn();
  else if (act === "reset") void onResetMix();
  else if (act === "export") store.downloadLog();
  else if (act === "forget") void onForget();
});

function clearCapture() {
  if (capture.url && typeof URL !== "undefined" && URL.revokeObjectURL) {
    URL.revokeObjectURL(capture.url);
  }
  capture.file = null;
  capture.url = "";
  if (capturePreviewEl) capturePreviewEl.removeAttribute("src");
  if (captureNoteEl) captureNoteEl.value = "";
  if (captureDraftEl) captureDraftEl.hidden = true;
  syncPoolFace();
}

function showCaptureDraft(file) {
  const kind = classifyEntry({
    name: file?.name || "",
    type: file?.type || "",
    relativePath: file?.name || "",
  }).kind;
  if (kind !== "image") {
    setHint("That isn’t a photo this page can keep.");
    return;
  }
  if (capture.url && typeof URL !== "undefined" && URL.revokeObjectURL) {
    URL.revokeObjectURL(capture.url);
  }
  capture.file = file;
  try {
    capture.url = URL.createObjectURL(file);
  } catch {
    capture.file = null;
    capture.url = "";
    setHint("Couldn’t read that photo.");
    return;
  }
  if (capturePreviewEl) capturePreviewEl.src = capture.url;
  if (captureDraftEl) {
    captureDraftEl.hidden = false;
    captureDraftEl.scrollIntoView({ block: "nearest" });
  }
  syncPoolFace();
}

async function onCaptureKeep() {
  if (!capture.file || state.busy || !booted) return;
  const entries = captureEntries({
    file: capture.file,
    note: captureNoteEl?.value || "",
  });
  const kept = await intake(entries);
  if (kept) clearCapture();
}

document.querySelector("#capture-take")?.addEventListener("click", () => {
  if (state.busy) return;
  captureCameraEl?.click();
});

document.querySelector("#capture-choose")?.addEventListener("click", () => {
  if (state.busy) return;
  captureLibraryEl?.click();
});

document.querySelector("#capture-keep")?.addEventListener("click", () => {
  void onCaptureKeep();
});

document.querySelector("#capture-discard")?.addEventListener("click", () => {
  if (state.busy) return;
  clearCapture();
});

function onCaptureInput(input) {
  const file = input?.files?.[0];
  if (file) showCaptureDraft(file);
  if (input) input.value = "";
}

captureCameraEl?.addEventListener("change", () => onCaptureInput(captureCameraEl));
captureLibraryEl?.addEventListener("change", () => onCaptureInput(captureLibraryEl));

document.querySelector("#bring-files")?.addEventListener("click", () => {
  pickFilesEl?.click();
});

document.querySelector("#bring-folder")?.addEventListener("click", () => {
  pickFolderEl?.click();
});

samplesBtn?.addEventListener("click", () => {
  void onSamplesToggle();
});

folioPrevEl?.addEventListener("click", () => {
  void browseBy(-1);
});

folioNextEl?.addEventListener("click", () => {
  void browseBy(1);
});

folioAllEl?.addEventListener("click", () => {
  if (state.busy || state.marking) return;
  setDrawer(!drawerOpen());
});

folioListEl?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-shard]");
  if (!button) return;
  void openRanked(button.dataset.shard);
});

window.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  const tag = event.target?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || event.target?.isContentEditable) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  event.preventDefault();
  void browseBy(event.key === "ArrowLeft" ? -1 : 1);
});

pickFilesEl?.addEventListener("change", () => {
  const files = pickFilesEl.files;
  if (files?.length) void intake(entriesFromFileList(files));
  pickFilesEl.value = "";
});

pickFolderEl?.addEventListener("change", () => {
  const files = pickFolderEl.files;
  if (files?.length) void intake(entriesFromFileList(files));
  pickFolderEl.value = "";
});

function dragHasFiles(event) {
  return [...(event.dataTransfer?.types || [])].includes("Files");
}

let dragTimer = 0;

function endReceiving() {
  window.clearTimeout(dragTimer);
  document.body.classList.remove("is-receiving");
}

window.addEventListener("dragover", (event) => {
  if (!dragHasFiles(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  document.body.classList.add("is-receiving");
  window.clearTimeout(dragTimer);
  dragTimer = window.setTimeout(() => {
    document.body.classList.remove("is-receiving");
  }, 180);
});

window.addEventListener("drop", (event) => {
  if (!dragHasFiles(event)) return;
  event.preventDefault();
  endReceiving();
  void entriesFromDataTransfer(event.dataTransfer)
    .then((entries) => {
      if (!entries.length) {
        setHint("Nothing there to keep.");
        return;
      }
      return intake(entries);
    })
    .catch(() => setHint("Couldn’t read what you dropped."));
});

function paintPreview() {
  rebuildPool();
  syncPoolFace();
  const preview = pickCandidate();
  if (!preview) {
    renderJobs();
    return null;
  }
  state.shardId = preview.shard.id;
  state.held = false;
  state.editing = false;
  resetBrowse();
  syncMarks();
  renderJobs();
  shardEl.innerHTML = shardMarkup(preview.shard);
  renderTeach();
  renderFolio();
  return preview.shard.id;
}

async function boot() {
  const previewId = paintPreview();
  try {
    await library.hydrate();
  } catch {
    // Samples still rank if the library can’t be opened.
  }
  rebuildPool();
  syncPoolFace();
  await attachImageFeel(pool);
  booted = true;
  const yours = library.list().length;
  if (yours === 1) setHint("One letter of yours is already in the pool.");
  else if (yours) setHint(`${yours} letters of yours are already in the pool.`);

  state.usedIds = new Set();
  state.shardId = previewId;
  const first = pickCandidate();
  if (!first) {
    showEmpty();
  } else if (first.shard.id === previewId) applyShard(first.shard);
  else swapTo(first.shard);

  // The letter is up. Meaning and the photograph load after, and ranking
  // switches when they land — once, and only if nobody has moved on.
  function maybeAdopt() {
    if (!booted || state.editing || state.busy || state.held || state.marking || state.browsed) return;
    if (state.usedIds.size) return;
    // The fingerprint letter may still be fading in. Try once that settles
    // so a fast model can still correct who is on the page.
    if (state.animating) {
      window.setTimeout(maybeAdopt, 80);
      return;
    }
    const next = pickCandidate();
    if (!next || next.shard.id === state.shardId) {
      if (teachEl?.open) renderTeach();
      return;
    }
    swapTo(next.shard);
  }

  meaning.subscribe((status) => {
    paintStatus();
    if (status !== "ready" && status !== "fallback") return;
    void scheduleVectors().then(() => {
      if (status === "ready") maybeAdopt();
    });
  });
  vision.subscribe((status) => {
    paintStatus();
    if (status !== "ready" && status !== "fallback") return;
    void scheduleVision().then(() => maybeAdopt());
  });
  void meaning.load();
  void vision.load();
}

boot();
