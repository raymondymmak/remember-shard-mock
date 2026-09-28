// A photograph, reduced to a few numbers, in the browser.
// We do not send the picture anywhere and we do not download a model.
//
// On load we shrink the image to a 16×16 thumbnail and read the pixels.
// Those pixels become a fingerprint of length 6:
//   [brightness, warmth, dark, dim, light, bright]
// brightness — 0 is a dark frame, 1 is full daylight
// warmth — 0 is blue/cool, 0.5 is neutral, 1 is amber
// the last four — what share of the thumbnail sits in each brightness band
//   (they add up to 1). A noon ridge piles up on the right; a lamp on the left.
//
// A job carries a hand-written prior in the same shape ("a bit brighter").
// Similarity is 1 minus the average absolute difference, so levels matter.
// Cosine would treat a dim amber photo and a bright amber photo as the same
// direction. Here the level is the point.

export const IMAGE_EDGE = 16;

export function fingerprintFromPixels(pixels, width, height) {
  const w = width | 0;
  const h = height | 0;
  const count = w * h;
  if (!pixels || count <= 0 || pixels.length < count * 4) return null;

  let brightness = 0;
  let warmth = 0;
  const bins = [0, 0, 0, 0];

  for (let i = 0; i < count; i += 1) {
    const offset = i * 4;
    const r = pixels[offset];
    const g = pixels[offset + 1];
    const b = pixels[offset + 2];
    // Perceived lightness. Green counts more than red, red more than blue.
    const y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    brightness += y;
    // Red above blue is warm. Grey, white, and black sit at 0.5.
    warmth += ((r - b) / 255) * 0.5 + 0.5;
    // y === 1 would land past the last band; keep it in "bright".
    bins[Math.min(3, Math.floor(y * 4))] += 1;
  }

  return [
    brightness / count,
    warmth / count,
    bins[0] / count,
    bins[1] / count,
    bins[2] / count,
    bins[3] / count,
  ];
}

// 1 = same feel, 0 = as far apart as these numbers can be. null = no picture.
export function imageSimilarity(fingerprint, prior) {
  if (!fingerprint || !prior || fingerprint.length !== prior.length || !fingerprint.length) {
    return null;
  }
  let mad = 0;
  for (let i = 0; i < fingerprint.length; i += 1) {
    const a = Number(fingerprint[i]);
    const b = Number(prior[i]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    mad += Math.abs(a - b);
  }
  return 1 - Math.min(1, mad / fingerprint.length);
}

function loadHtmlImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not read the photograph"));
    img.src = src;
  });
}

// Shrink, then the pure function above. Safe to call again; 16×16 is cheap.
export async function fingerprintImage(src) {
  if (!src || typeof document === "undefined") return null;
  const img = await loadHtmlImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = IMAGE_EDGE;
  canvas.height = IMAGE_EDGE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, IMAGE_EDGE, IMAGE_EDGE);
  const { data } = ctx.getImageData(0, 0, IMAGE_EDGE, IMAGE_EDGE);
  return fingerprintFromPixels(data, IMAGE_EDGE, IMAGE_EDGE);
}
