import { JOBS, SHARDS } from "./shards.js";

const jobsEl = document.querySelector("#jobs");
const shardEl = document.querySelector("#shard");
const anotherEl = document.querySelector("#another");
const indexEl = document.querySelector("#shard-index");

const state = {
  job: "push",
  index: 0,
  animating: false,
};

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
  `;
}

function currentShard() {
  return SHARDS[state.job][state.index];
}

function renderShard() {
  const list = SHARDS[state.job];
  shardEl.innerHTML = shardMarkup(currentShard());
  indexEl.textContent = `${state.index + 1} of ${list.length}`;
  anotherEl.hidden = list.length < 2;
}

function swap(next) {
  if (state.animating) return;
  const same = next.job === state.job && next.index === state.index;
  if (same) return;

  const apply = () => {
    state.job = next.job;
    state.index = next.index;
    renderJobs();
    renderShard();
  };

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

jobsEl.addEventListener("click", (event) => {
  const button = event.target.closest("[data-job]");
  if (!button) return;
  swap({ job: button.dataset.job, index: 0 });
});

anotherEl.addEventListener("click", () => {
  const list = SHARDS[state.job];
  swap({ job: state.job, index: (state.index + 1) % list.length });
});

renderJobs();
renderShard();
