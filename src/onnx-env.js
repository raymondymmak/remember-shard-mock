// Shared browser setup for the sentence model and the photograph model.
// GitHub Pages is not cross-origin isolated, so the wasm runtime stays single-threaded.

export function configureTransformers(env) {
  env.allowLocalModels = false;
  // Cache API in the browser. Node has no `caches`, and forcing it throws.
  if (typeof caches !== "undefined") env.useBrowserCache = true;
  const wasm = env.backends?.onnx?.wasm;
  if (wasm && typeof window !== "undefined") {
    wasm.numThreads = 1;
    wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/@xenova/transformers@${env.version}/dist/`;
  }
}
