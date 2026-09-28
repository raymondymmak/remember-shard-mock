import { JOBS as RAW_JOBS, SHARDS as RAW_SHARDS } from "./shards.js";
import { MIX_KEYS, WEIGHTS, prepareJobs, prepareShards, rankShards } from "./ranker.js";
import { explainEval, inspectLog, learnAndEvaluate } from "./train.js";
import * as store from "./store.js";
import * as library from "./library.js";
import { entriesFromDataTransfer, entriesFromFileList } from "./collect.js";
import {
  buildImportedShards,
  classifyEntry,
  describeIntake,
  draftNote,
  noteBody,
  pairFiles,
  paperLine,
  paperWash,
  vibeFromNote,
} from "./ingest.js";

const JOBS = prepareJobs(RAW_JOBS);

const jobsEl = document.querySelector("#jobs");
const shardEl = document.querySelector("#shard");
const teachEl = document.querySelector("#teach");
const teachBodyEl = document.querySelector("#teach-body");
const hintEl = document.querySelector("#bring-hint");
const samplesBtn = document.querySelector("#samples-toggle");
const pickFilesEl = document.querySelector("#pick-files");
const pickFolderEl = document.querySelector("#pick-folder");

let pool = [];
let booted = false;

const state = {
  job: "push",
  shardId: null,
  usedIds: new Set(),
  ranking: [],
  animating: false,
  kept: false,
  editing: false,
  busy: false,
  trainNote: "",
};

function currentJob() {
  return JOBS.find((job) => job.id === state.job);
}

function currentShard() {
  return pool.find((shard) => shard.id === state.shardId);
}

function rebuildPool() {
  const imported = library.list();
  const samples = library.includeSamplesOn() ? RAW_SHARDS : [];
  pool = prepareShards([...samples, ...imported]);
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

  let age;
  if (months < 2) age = "weeks ago";
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

function ordinal(n) {
  const mod = n % 100;
  if (mod >= 11 && mod <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

function setHint(text) {
  if (hintEl) hintEl.textContent = text;
}

function syncSamplesToggle() {
  if (!samplesBtn) return;
  const on = library.includeSamplesOn();
  samplesBtn.setAttribute("aria-pressed", on ? "true" : "false");
  samplesBtn.textContent = on ? "samples in" : "samples aside";
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
    return `
      <figure class="print print-paper" style="--wash: ${wash}">
        <p class="paper-kicker">${kicker}</p>
        <p class="paper-line">${escapeHtml(paperLine(shard.note))}</p>
      </figure>
    `;
  }

  return `
    <figure class="print">
      <img src="${escapeHtml(shard.photo)}" alt="${escapeHtml(shard.photoAlt || "")}" />
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

function shardMarkup(shard) {
  const yours = shard.imported ? ' <span class="yours">· yours</span>' : "";
  return `
    ${printMarkup(shard)}
    ${noteMarkup(shard)}
    <p class="why-kicker">why this, why now</p>
    <p class="why">${escapeHtml(shard.why)}</p>
    <p class="when">${escapeHtml(formatWhen(shard.date))}${yours}</p>
    <div class="marks" role="group" aria-label="How this memory landed">
      <button type="button" class="mark ${state.kept ? "is-kept" : ""}" data-act="keep">
        ${state.kept ? "kept" : "keep"}
      </button>
      <button type="button" class="mark" data-act="another">another</button>
      <button type="button" class="mark" data-act="nah">nah</button>
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
  return `<p class="teach-note">Imported letters join this pool — data, then retrieve, then rank.</p>`;
}

function renderTeach() {
  const shard = currentShard();
  if (!shard) {
    teachBodyEl.innerHTML = poolLine();
    return;
  }

  const ranked = rerank({ shown: shownForExplain() });
  const row = ranked.find((item) => item.shard.id === shard.id);
  if (!row) {
    teachBodyEl.innerHTML = poolLine();
    return;
  }

  const top3 = ranked.slice(0, 3);
  const job = currentJob();
  const learned = store.loadWeights();
  const mixLabels = {
    job: "closeness to the job",
    freshness: "not shown recently",
    recency: "how recent the day was",
    vibe: "grit / softness / people",
    text: "words in the note",
  };
  const place = ranked.findIndex((item) => item.shard.id === shard.id) + 1;

  teachBodyEl.innerHTML = `
    ${poolLine()}
    <p class="teach-lede">
      The job asked for <em>${escapeHtml(job.label)}</em>.
      Here is how this memory scored among ${ranked.length}${
        shard.imported ? `, placing ${ordinal(place)}` : ""
      }.
    </p>
    <p class="teach-kicker">how it scored</p>
    <ul class="teach-list">
      <li><span>closeness to the job</span><span>${fmt(row.parts.job)}</span></li>
      <li class="is-sub"><span>vibe cosine — grit / softness / people</span><span>${fmt(row.vibe)}</span></li>
      <li class="is-sub"><span>words in the note</span><span>${fmt(row.text)}</span></li>
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
      <p class="empty-aside">Bring a photo or a note. It will sit here like the others.</p>
    </div>
  `;
  renderTeach();
}

function renderShard() {
  const shard = currentShard();
  if (!shard) {
    renderEmpty();
    return;
  }
  shardEl.innerHTML = shardMarkup(shard);
  if (state.editing) focusEditor(shard);
  renderTeach();
}

function showEmpty() {
  state.shardId = null;
  state.kept = false;
  state.editing = false;
  renderJobs();
  renderEmpty();
}

function applyShard(shard, { kept = false } = {}) {
  state.shardId = shard.id;
  state.kept = kept;
  state.editing = false;
  store.markShown(shard.id);
  renderJobs();
  renderShard();
}

function swapTo(shard, { kept = false } = {}) {
  if (!shard) return;
  if (state.animating) return;
  if (shard.id === state.shardId) {
    applyShard(shard, { kept });
    return;
  }

  const apply = () => applyShard(shard, { kept });
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) {
    apply();
    return;
  }

  state.animating = true;
  shardEl.classList.add("is-leaving");

  window.setTimeout(() => {
    apply();
    shardEl.classList.remove("is-leaving");
    shardEl.classList.add("is-entering");
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        shardEl.classList.remove("is-entering");
      });
    });
    window.setTimeout(() => {
      state.animating = false;
    }, 240);
  }, 220);
}

function commitNote(text) {
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
  rebuildPool();
  return true;
}

function finishEditing() {
  const area = shardEl.querySelector("#note-edit");
  if (area) commitNote(area.value);
  state.editing = false;
}

function chooseJob(jobId) {
  if (!booted) return;
  if (jobId === state.job && state.shardId && !state.editing) return;
  finishEditing();
  if (jobId === state.job && state.shardId) {
    renderShard();
    return;
  }
  state.job = jobId;
  state.usedIds = new Set();
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
        }
      : {},
  });
}

function onKeep() {
  finishEditing();
  record("keep");
  state.kept = true;
  renderShard();
}

function onAdvance(action) {
  finishEditing();
  record(action);
  const next = pickCandidate({ consumeCurrent: true });
  if (next) swapTo(next.shard);
  else showEmpty();
}

function showFresh(ids, summary) {
  if (!ids.size) {
    setHint(summary);
    return;
  }
  state.usedIds = new Set();
  const ranking = rerank();
  const best = ranking.find((row) => ids.has(row.shard.id));
  if (!best) {
    setHint(summary);
    return;
  }
  const place = ranking.findIndex((row) => row.shard.id === best.shard.id) + 1;
  setHint(`${summary} This one ranked ${ordinal(place)} of ${ranking.length}.`);
  if (state.animating) applyShard(best.shard);
  else swapTo(best.shard);
}

async function intake(entries) {
  if (!booted || state.busy || !entries?.length) return;
  state.busy = true;
  finishEditing();
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
    const summary = describeIntake(grouped, {
      added: result.added.length,
      updated: result.updated.length,
      duplicate: result.duplicates.length,
    });
    const freshIds = new Set([...result.added, ...result.updated].map((shard) => shard.id));
    showFresh(freshIds, summary);
  } catch {
    setHint("Couldn’t keep those just now.");
  } finally {
    state.busy = false;
  }
}

jobsEl.addEventListener("click", (event) => {
  const button = event.target.closest("[data-job]");
  if (!button || state.busy) return;
  chooseJob(button.dataset.job);
});

shardEl.addEventListener("click", (event) => {
  const button = event.target.closest("[data-act]");
  if (!button || state.animating || state.busy) return;
  const act = button.dataset.act;
  if (act === "revise") {
    state.editing = true;
    renderShard();
    return;
  }
  if (act === "done") {
    const area = shardEl.querySelector("#note-edit");
    if (area) commitNote(area.value);
    state.editing = false;
    renderShard();
    return;
  }
  if (act === "keep") onKeep();
  else if (act === "another") onAdvance("another");
  else if (act === "nah") onAdvance("nah");
});

shardEl.addEventListener("focusout", (event) => {
  if (event.target?.id !== "note-edit") return;
  commitNote(event.target.value);
});

shardEl.addEventListener("keydown", (event) => {
  if (event.target?.id !== "note-edit") return;
  const done =
    event.key === "Escape" || ((event.metaKey || event.ctrlKey) && event.key === "Enter");
  if (!done) return;
  event.preventDefault();
  commitNote(event.target.value);
  state.editing = false;
  renderShard();
});

function evalMarkup(report) {
  const lines = explainEval(report);
  if (!lines.length) return "";
  return `
    <p class="teach-kicker">train and test</p>
    ${lines.map((line) => `<p class="teach-note">${escapeHtml(line)}</p>`).join("")}
  `;
}

function onLearn() {
  finishEditing();
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
  const next = pickCandidate();
  if (next) swapTo(next.shard);
  else showEmpty();
}

function onResetMix() {
  finishEditing();
  store.clearWeights();
  state.trainNote = "Back to the hand-written mix.";
  state.usedIds = new Set();
  const next = pickCandidate();
  if (next) swapTo(next.shard);
  else showEmpty();
}

async function onForget() {
  const shard = currentShard();
  if (!shard?.imported) return;
  finishEditing();
  await library.forget(shard.id);
  rebuildPool();
  state.usedIds = new Set();
  setHint("Let go. The pool moved on.");
  const next = pickCandidate();
  if (next) swapTo(next.shard);
  else showEmpty();
}

function onSamplesToggle() {
  if (!booted) return;
  finishEditing();
  const shardId = state.shardId;
  library.setIncludeSamples(!library.includeSamplesOn());
  rebuildPool();
  syncSamplesToggle();
  state.usedIds = new Set();
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
  if (act === "learn") onLearn();
  else if (act === "reset") onResetMix();
  else if (act === "export") store.downloadLog();
  else if (act === "forget") void onForget();
});

document.querySelector("#bring-files")?.addEventListener("click", () => {
  pickFilesEl?.click();
});

document.querySelector("#bring-folder")?.addEventListener("click", () => {
  pickFolderEl?.click();
});

samplesBtn?.addEventListener("click", onSamplesToggle);

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
  syncSamplesToggle();
  const preview = pickCandidate();
  if (!preview) {
    renderJobs();
    return null;
  }
  state.shardId = preview.shard.id;
  state.kept = false;
  state.editing = false;
  renderJobs();
  shardEl.innerHTML = shardMarkup(preview.shard);
  renderTeach();
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
  syncSamplesToggle();
  booted = true;
  const yours = library.list().length;
  if (yours === 1) setHint("One letter of yours is already in the pool.");
  else if (yours) setHint(`${yours} letters of yours are already in the pool.`);

  state.usedIds = new Set();
  state.shardId = previewId;
  const first = pickCandidate();
  if (!first) {
    showEmpty();
    return;
  }
  if (first.shard.id === previewId) applyShard(first.shard);
  else swapTo(first.shard);
}

boot();
