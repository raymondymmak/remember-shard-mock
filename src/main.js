import { JOBS as RAW_JOBS, SHARDS as RAW_SHARDS } from "./shards.js";
import { MIX_KEYS, WEIGHTS, prepareJobs, prepareShards, rankShards } from "./ranker.js";
import { explainEval, inspectLog, learnAndEvaluate } from "./train.js";
import * as store from "./store.js";

const JOBS = prepareJobs(RAW_JOBS);
const SHARDS = prepareShards(RAW_SHARDS);

const jobsEl = document.querySelector("#jobs");
const shardEl = document.querySelector("#shard");
const teachEl = document.querySelector("#teach");
const teachBodyEl = document.querySelector("#teach-body");

const state = {
  job: "push",
  shardId: null,
  usedIds: new Set(),
  ranking: [],
  animating: false,
  kept: false,
  trainNote: "",
};

function currentJob() {
  return JOBS.find((job) => job.id === state.job);
}

function currentShard() {
  return SHARDS.find((shard) => shard.id === state.shardId);
}

function formatWhen(iso) {
  const then = new Date(`${iso}T12:00:00`);
  const now = new Date();
  const months =
    (now.getFullYear() - then.getFullYear()) * 12 +
    (now.getMonth() - then.getMonth());
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
  const one = text.replace(/\s+/g, " ").trim();
  return one.length <= n ? one : `${one.slice(0, n).trim()}…`;
}

function fmt(n) {
  return n.toFixed(2);
}

function activeWeights() {
  return store.loadWeights() || WEIGHTS;
}

function rerank({ excludeIds = [], shown = store.shown() } = {}) {
  return rankShards({
    shards: SHARDS,
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
  if (!ranking.length) {
    state.usedIds = new Set(state.shardId ? [state.shardId] : []);
    ranking = rerank({ excludeIds: [...state.usedIds] });
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

function shardMarkup(shard) {
  return `
    <figure class="print">
      <img src="${shard.photo}" alt="${shard.photoAlt}" />
    </figure>
    <blockquote class="note">
      <p>${shard.note}</p>
    </blockquote>
    <p class="why-kicker">why this, why now</p>
    <p class="why">${shard.why}</p>
    <p class="when">${formatWhen(shard.date)}</p>
    <div class="marks" role="group" aria-label="How this memory landed">
      <button type="button" class="mark ${state.kept ? "is-kept" : ""}" data-act="keep">
        ${state.kept ? "kept" : "keep"}
      </button>
      <button type="button" class="mark" data-act="another">another</button>
      <button type="button" class="mark" data-act="nah">nah</button>
    </div>
  `;
}

function renderTeach() {
  const shard = currentShard();
  if (!shard) {
    teachBodyEl.innerHTML = "";
    return;
  }

  const pool = rerank({ shown: shownForExplain() });
  const row = pool.find((item) => item.shard.id === shard.id);
  if (!row) {
    teachBodyEl.innerHTML = "";
    return;
  }

  const top3 = pool.slice(0, 3);
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
    <p class="teach-lede">
      The job asked for <em>${job.label}</em>.
      Here is how this memory scored among ${pool.length}.
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
    ${state.trainNote ? `<p class="teach-note">${state.trainNote}</p>` : ""}
    <div class="teach-actions">
      <button type="button" class="teach-act" data-train="learn">learn from my marks</button>
      <button type="button" class="teach-act" data-train="reset">reset to default mix</button>
      <button type="button" class="teach-act" data-train="export">download the marks</button>
    </div>
  `;
}

function renderShard() {
  const shard = currentShard();
  if (!shard) return;
  shardEl.innerHTML = shardMarkup(shard);
  renderTeach();
}

function applyShard(shard, { kept = false } = {}) {
  state.shardId = shard.id;
  state.kept = kept;
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

function chooseJob(jobId) {
  if (jobId === state.job && state.shardId) return;
  state.job = jobId;
  state.usedIds = new Set();
  const next = pickCandidate();
  if (next) swapTo(next.shard);
}

function currentScores() {
  const pool = rerank({ shown: shownForExplain() });
  return pool.find((item) => item.shard.id === state.shardId) ?? pool[0] ?? null;
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
  record("keep");
  state.kept = true;
  renderShard();
}

function onAdvance(action) {
  record(action);
  const next = pickCandidate({ consumeCurrent: true });
  if (next) swapTo(next.shard);
}

jobsEl.addEventListener("click", (event) => {
  const button = event.target.closest("[data-job]");
  if (!button) return;
  chooseJob(button.dataset.job);
});

shardEl.addEventListener("click", (event) => {
  const button = event.target.closest("[data-act]");
  if (!button || state.animating) return;
  const act = button.dataset.act;
  if (act === "keep") onKeep();
  else if (act === "another") onAdvance("another");
  else if (act === "nah") onAdvance("nah");
});

function evalMarkup(report) {
  const lines = explainEval(report);
  if (!lines.length) return "";
  return `
    <p class="teach-kicker">train and test</p>
    ${lines.map((line) => `<p class="teach-note">${line}</p>`).join("")}
  `;
}

function onLearn() {
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
}

function onResetMix() {
  store.clearWeights();
  state.trainNote = "Back to the hand-written mix.";
  state.usedIds = new Set();
  const next = pickCandidate();
  if (next) swapTo(next.shard);
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
});

const first = pickCandidate();
if (first) applyShard(first.shard);
