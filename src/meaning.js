// Sentence meaning for job ↔ note closeness.
// The model stays in the browser. Notes are not uploaded.
// Until it is ready — and if it never loads — callers keep the hashed embedText.

import { embedText } from "./ranker.js";

export const MODEL_ID = "Xenova/all-MiniLM-L6-v2";

// A slow or stuck download should not leave the status on "loading" forever.
// The letter has already been ranking with the hash the whole time.
const DEFAULT_TIMEOUT_MS = 120_000;

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

function withTimeout(promise, ms) {
  if (!ms) return promise;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("meaning timed out")), ms);
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
export async function defaultLoadPipeline() {
  const { pipeline, env } = await import("@xenova/transformers");
  env.allowLocalModels = false;
  // Cache API in the browser. Node has no `caches`, and forcing it throws.
  if (typeof caches !== "undefined") env.useBrowserCache = true;
  const wasm = env.backends?.onnx?.wasm;
  // GitHub Pages is not cross-origin isolated, so the wasm runtime stays single-threaded.
  if (wasm && typeof window !== "undefined") {
    wasm.numThreads = 1;
    wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/@xenova/transformers@${env.version}/dist/`;
  }

  const extractor = await pipeline("feature-extraction", MODEL_ID, {
    quantized: true,
  });

  return async (text) => {
    const output = await extractor(String(text ?? ""), {
      pooling: "mean",
      normalize: true,
    });
    const data = output?.data;
    if (!data?.length) throw new Error("empty embedding");
    const dim = output.dims?.[output.dims.length - 1] ?? data.length;
    const start = Math.max(0, data.length - dim);
    return data.subarray ? data.subarray(start) : data.slice(start);
  };
}

export function createMeaning({
  loadPipeline = defaultLoadPipeline,
  timeoutMs = 0,
} = {}) {
  let status = "idle";
  let embedder = null;
  let loadPromise = null;
  const cache = new Map();
  const listeners = new Set();

  function setStatus(next) {
    if (status === next) return;
    status = next;
    for (const fn of listeners) {
      try {
        fn(status);
      } catch {
        // A status listener must not break ranking.
      }
    }
  }

  function fail() {
    embedder = null;
    cache.clear();
    setStatus("fallback");
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function load() {
    if (status === "ready" || status === "fallback") return Promise.resolve(status);
    if (loadPromise) return loadPromise;

    // Assign the promise before any listener runs. Status listeners may call
    // embedDocuments, and that waits on this promise while the model loads.
    let finish;
    const promise = new Promise((resolve) => {
      finish = resolve;
    });
    loadPromise = promise;
    setStatus("loading");

    (async () => {
      try {
        const pending = Promise.resolve().then(() => loadPipeline());
        const next = await withTimeout(pending, timeoutMs);
        if (typeof next !== "function") throw new Error("embedder missing");
        const probe = l2(await next("hello"));
        if (!probe.length) throw new Error("empty embedding");
        embedder = next;
        cache.set("hello", probe);
        setStatus("ready");
        // A listener may have fallen back while embedding the pool.
        finish(status);
      } catch {
        fail();
        finish("fallback");
      }
    })();

    return promise;
  }

  function cachedDocuments(texts) {
    if (status !== "ready") return null;
    const keys = texts.map((text) => String(text ?? ""));
    if (!keys.length || !keys.every((key) => cache.has(key))) return null;
    const vectors = keys.map((key) => cache.get(key));
    const dim = vectors[0]?.length;
    if (!dim || vectors.some((vec) => vec.length !== dim)) return null;
    return vectors;
  }

  async function embedDocuments(texts) {
    const keys = texts.map((text) => String(text ?? ""));
    const hashed = () => ({ mode: "hash", vectors: keys.map((key) => embedText(key)) });

    if (status === "idle") return hashed();
    if (status === "loading" && loadPromise) await loadPromise;
    if (status !== "ready" || typeof embedder !== "function") return hashed();

    try {
      const vectors = [];
      for (const key of keys) {
        if (!cache.has(key)) {
          const vec = l2(await embedder(key));
          if (!vec.length) throw new Error("empty embedding");
          const dim = cache.values().next().value?.length;
          if (dim && vec.length !== dim) throw new Error("mixed widths");
          cache.set(key, vec);
        }
        vectors.push(cache.get(key));
      }
      const dim = vectors[0]?.length ?? 0;
      if (vectors.some((vec) => vec.length !== dim)) throw new Error("mixed widths");
      return { mode: "semantic", vectors };
    } catch {
      fail();
      return hashed();
    }
  }

  return {
    load,
    embedDocuments,
    cachedDocuments,
    subscribe,
    status: () => status,
  };
}

export const meaning = createMeaning({ timeoutMs: DEFAULT_TIMEOUT_MS });
