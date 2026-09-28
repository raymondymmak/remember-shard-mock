// Photograph meaning for job ↔ picture closeness.
//
// Xenova/clip-vit-base-patch32 (quantized) is a CLIP model: the text tower
// and the vision tower share one 512-d space, so a job's words and a photo
// can be cosine-compared. all-MiniLM is 384-d and the photo-feel fingerprint
// is 6-d. Those widths stay in their own slots and are never mixed in cosine.
//
// The weights stay in the browser cache. Photos and notes are not uploaded.
// Until the model is ready — and if it never loads — callers keep the
// fingerprint in src/image.js.

import { configureTransformers } from "./onnx-env.js";

export const MODEL_ID = "Xenova/clip-vit-base-patch32";

// Written next to a stored vector. A different id must not reuse these numbers.
export const CACHE_MODEL = "clip-vit-base-patch32";

// Vision weights are larger than the sentence model. A stuck download should
// still give the letter back its fingerprint instead of spinning forever.
const DEFAULT_TIMEOUT_MS = 180_000;

function l2(vec) {
  const arr = [];
  let sum = 0;
  const source = vec?.data ?? vec;
  const length = source?.length ?? 0;
  for (let i = 0; i < length; i += 1) {
    const n = Number(source[i]);
    const x = Number.isFinite(n) ? n : 0;
    arr.push(x);
    sum += x * x;
  }
  const norm = Math.sqrt(sum);
  if (!norm) return arr.map(() => 0);
  return arr.map((n) => n / norm);
}

function vectorFromOutput(output) {
  const data = output?.data ?? output;
  if (!data?.length) return [];
  const dim = output?.dims?.[output.dims.length - 1] ?? data.length;
  const start = Math.max(0, data.length - dim);
  const row = data.subarray ? data.subarray(start) : data.slice(start);
  return l2(row);
}

function withTimeout(promise, ms) {
  if (!ms) return promise;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("vision timed out")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

// Dynamic import so the letter's first paint does not wait on this package.
export async function defaultLoadPipeline({ onProgress } = {}) {
  const { pipeline, AutoTokenizer, CLIPTextModelWithProjection, env } = await import(
    "@xenova/transformers"
  );
  configureTransformers(env);
  const options = { quantized: true, progress_callback: onProgress };

  const [imageExtractor, tokenizer, textModel] = await Promise.all([
    pipeline("image-feature-extraction", MODEL_ID, options),
    AutoTokenizer.from_pretrained(MODEL_ID, options),
    CLIPTextModelWithProjection.from_pretrained(MODEL_ID, options),
  ]);

  return {
    async embedText(text) {
      const inputs = tokenizer([String(text ?? "")], { padding: true, truncation: true });
      const { text_embeds: embeds } = await textModel(inputs);
      return vectorFromOutput(embeds);
    },
    async embedImage(src) {
      const features = await imageExtractor(src);
      return vectorFromOutput(features);
    },
  };
}

export function createVision({ loadPipeline = defaultLoadPipeline, timeoutMs = 0 } = {}) {
  let status = "idle";
  let embedder = null;
  let width = 0;
  let loadPromise = null;
  let progress = null;
  const textCache = new Map();
  const imageCache = new Map();
  const listeners = new Set();

  function notify() {
    for (const fn of listeners) {
      try {
        fn(status);
      } catch {
        // A status listener must not break ranking.
      }
    }
  }

  function setStatus(next) {
    if (status === next) return;
    status = next;
    if (next !== "loading") progress = null;
    notify();
  }

  function noteProgress(info) {
    if (status !== "loading" || info?.status !== "progress") return;
    const loaded = Number(info.loaded);
    const total = Number(info.total);
    if (!Number.isFinite(loaded) || !Number.isFinite(total) || total <= 0) return;
    const files = noteProgress.files || (noteProgress.files = new Map());
    files.set(info.file || "model", { loaded, total });
    let sumLoaded = 0;
    let sumTotal = 0;
    for (const row of files.values()) {
      sumLoaded += row.loaded;
      sumTotal += row.total;
    }
    if (!sumTotal) return;
    const next = Math.max(0, Math.min(1, sumLoaded / sumTotal));
    if (progress != null && Math.abs(next - progress) < 0.01) return;
    progress = next;
    notify();
  }

  function fail() {
    embedder = null;
    width = 0;
    textCache.clear();
    imageCache.clear();
    setStatus("fallback");
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function load() {
    if (status === "ready" || status === "fallback") return Promise.resolve(status);
    if (loadPromise) return loadPromise;

    let finish;
    const promise = new Promise((resolve) => {
      finish = resolve;
    });
    loadPromise = promise;
    setStatus("loading");

    (async () => {
      try {
        const pending = Promise.resolve().then(() => loadPipeline({ onProgress: noteProgress }));
        const next = await withTimeout(pending, timeoutMs);
        if (typeof next?.embedText !== "function" || typeof next?.embedImage !== "function") {
          throw new Error("embedder missing");
        }
        const probe = l2(await next.embedText("a photo"));
        if (!probe.length) throw new Error("empty embedding");
        embedder = next;
        width = probe.length;
        textCache.set("a photo", probe);
        setStatus("ready");
        finish(status);
      } catch {
        fail();
        finish("fallback");
      }
    })();

    return promise;
  }

  async function cachedText(key) {
    if (textCache.has(key)) return textCache.get(key);
    const vec = l2(await embedder.embedText(key));
    if (!vec.length || vec.length !== width) throw new Error("mixed widths");
    textCache.set(key, vec);
    return vec;
  }

  async function cachedImage(key) {
    if (imageCache.has(key)) return imageCache.get(key);
    try {
      const vec = l2(await embedder.embedImage(key));
      if (!vec.length || vec.length !== width) throw new Error("mixed widths");
      imageCache.set(key, vec);
      return vec;
    } catch (error) {
      if (error?.message === "mixed widths") throw error;
      // One unreadable frame falls back to its fingerprint. The model stays.
      imageCache.set(key, null);
      return null;
    }
  }

  function cachedJobsAndPhotos(texts, photos) {
    if (status !== "ready" || !width) return null;
    const textKeys = texts.map((text) => String(text ?? ""));
    const photoKeys = photos.map((photo) => (photo ? String(photo) : null));
    if (!textKeys.length || !textKeys.every((key) => textCache.has(key))) return null;
    if (photoKeys.some((key) => key && !imageCache.has(key))) return null;
    const jobVectors = textKeys.map((key) => textCache.get(key));
    const photoVectors = photoKeys.map((key) => (key ? imageCache.get(key) : null));
    const aligned =
      jobVectors.every((vec) => vec?.length === width) &&
      photoVectors.every((vec) => vec == null || vec.length === width);
    if (!aligned) return null;
    return { jobVectors, photoVectors };
  }

  async function embedJobsAndPhotos(texts, photos) {
    const textKeys = texts.map((text) => String(text ?? ""));
    const photoKeys = photos.map((photo) => (photo ? String(photo) : null));
    const feel = () => ({
      mode: "feel",
      jobVectors: textKeys.map(() => null),
      photoVectors: photoKeys.map(() => null),
    });

    if (status === "idle") return feel();
    if (status === "loading" && loadPromise) await loadPromise;
    if (status !== "ready" || !embedder) return feel();

    try {
      const jobVectors = [];
      for (const key of textKeys) jobVectors.push(await cachedText(key));
      const photoVectors = [];
      for (const key of photoKeys) {
        photoVectors.push(key ? await cachedImage(key) : null);
      }
      if (
        jobVectors.some((vec) => vec.length !== width) ||
        photoVectors.some((vec) => vec && vec.length !== width)
      ) {
        throw new Error("mixed widths");
      }
      return { mode: "semantic", jobVectors, photoVectors };
    } catch {
      fail();
      return feel();
    }
  }

  function vectorWidth() {
    return status === "ready" ? width : 0;
  }

  return {
    load,
    embedJobsAndPhotos,
    cachedJobsAndPhotos,
    vectorWidth,
    subscribe,
    status: () => status,
    progress: () => progress,
  };
}

export const vision = createVision({ timeoutMs: DEFAULT_TIMEOUT_MS });
