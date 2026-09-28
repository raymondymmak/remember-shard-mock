// Turn files you already have into shards. No Photos API, no account.
// Pairing is deliberate: same name, or one photo and one note sitting together.

const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "webp"]);
const NOTE_EXT = new Set(["md", "txt", "markdown"]);

const GRIT = new Set([
  "run",
  "running",
  "ran",
  "push",
  "finish",
  "finished",
  "heavy",
  "heaviness",
  "mile",
  "miles",
  "work",
  "ship",
  "shipped",
  "cold",
  "colder",
  "start",
  "started",
  "door",
  "uphill",
  "practice",
  "anyway",
  "desk",
  "tired",
  "stroke",
  "strokes",
  "ridge",
  "hike",
  "hiking",
]);
const SOFT = new Set([
  "rain",
  "quiet",
  "light",
  "coffee",
  "sunday",
  "walk",
  "walked",
  "walking",
  "warm",
  "ordinary",
  "soft",
  "read",
  "reading",
  "window",
  "gentle",
  "morning",
  "kitchen",
  "slow",
  "calm",
  "home",
  "grass",
  "book",
]);
const PEOPLE = new Set([
  "friend",
  "friends",
  "dinner",
  "laugh",
  "laughed",
  "laughs",
  "sister",
  "brother",
  "uncle",
  "aunt",
  "mom",
  "dad",
  "table",
  "cafe",
  "name",
  "names",
  "together",
  "birthday",
  "party",
  "porch",
]);

const GRIT_PHRASES = ["kept going", "one more", "get out", "went anyway"];
const SOFT_PHRASES = ["good life", "nothing is happening", "cut grass"];
const PEOPLE_PHRASES = ["about to see", "true thing", "last time"];

const WHY = {
  push: "You asked for a push. This is a day you already lived through.",
  soft: "Not a highlight. A texture from a day that was yours.",
  people: "Before the room fills up — someone from your own life is here.",
};

export function draftNote() {
  return "I kept this. I haven’t written what it meant yet — but I was there.";
}

export function whyForJob(jobId) {
  return WHY[jobId] || WHY.soft;
}

export function basename(path) {
  const clean = String(path || "").replace(/\\/g, "/");
  const cut = clean.lastIndexOf("/");
  return cut === -1 ? clean : clean.slice(cut + 1);
}

export function directoryOf(relativePath) {
  const path = String(relativePath || "").replace(/\\/g, "/");
  const cut = path.lastIndexOf("/");
  return cut === -1 ? "" : path.slice(0, cut);
}

export function extensionOf(name) {
  const base = basename(name);
  const cut = base.lastIndexOf(".");
  if (cut <= 0) return "";
  return base.slice(cut + 1).toLowerCase();
}

// "My Photo.JPG" and "my-photo.md" share a stem.
export function stemKey(name) {
  const base = basename(name);
  const cut = base.lastIndexOf(".");
  const stem = cut > 0 ? base.slice(0, cut) : base;
  return stem
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

export function classifyEntry(entry) {
  const name = entry.name || basename(entry.relativePath || "");
  const relativePath = entry.relativePath || name;
  const ext = extensionOf(name);
  const type = String(entry.type || "");
  let kind = "other";
  if (IMAGE_EXT.has(ext) || /^image\/(jpeg|jpg|png|webp)$/.test(type)) kind = "image";
  else if (NOTE_EXT.has(ext)) kind = "note";
  return {
    ...entry,
    name,
    relativePath,
    directory: directoryOf(relativePath),
    stem: stemKey(name),
    kind,
  };
}

function takePair(pairs, image, note, reason) {
  image.paired = true;
  note.paired = true;
  pairs.push({ image, note, reason });
}

// 1. Same folder + same stem (unique on both sides).
// 2. Dropped alongside: one leftover photo and one leftover note in that folder.
// 3. A stem that is unique across the whole drop, even in different folders.
export function pairFiles(entries) {
  const images = entries.filter((entry) => entry.kind === "image").map((entry) => ({ ...entry }));
  const notes = entries.filter((entry) => entry.kind === "note").map((entry) => ({ ...entry }));
  const skipped = entries.filter((entry) => entry.kind !== "image" && entry.kind !== "note");
  const pairs = [];
  const dirs = new Set([...images, ...notes].map((entry) => entry.directory));

  for (const dir of dirs) {
    const imgs = images.filter((entry) => !entry.paired && entry.directory === dir && entry.stem);
    const nts = notes.filter((entry) => !entry.paired && entry.directory === dir && entry.stem);
    const stems = new Set([...imgs, ...nts].map((entry) => entry.stem));
    for (const stem of stems) {
      const sameImages = imgs.filter((entry) => entry.stem === stem && !entry.paired);
      const sameNotes = nts.filter((entry) => entry.stem === stem && !entry.paired);
      if (sameImages.length === 1 && sameNotes.length === 1) {
        takePair(pairs, sameImages[0], sameNotes[0], "stem");
      }
    }
  }

  for (const dir of dirs) {
    const imgs = images.filter((entry) => !entry.paired && entry.directory === dir);
    const nts = notes.filter((entry) => !entry.paired && entry.directory === dir);
    if (imgs.length === 1 && nts.length === 1) {
      takePair(pairs, imgs[0], nts[0], "alongside");
    }
  }

  const stems = new Set([...images, ...notes].map((entry) => entry.stem).filter(Boolean));
  for (const stem of stems) {
    const sameImages = images.filter((entry) => !entry.paired && entry.stem === stem);
    const sameNotes = notes.filter((entry) => !entry.paired && entry.stem === stem);
    if (sameImages.length === 1 && sameNotes.length === 1) {
      takePair(pairs, sameImages[0], sameNotes[0], "stem");
    }
  }

  return {
    pairs,
    photoOnly: images.filter((entry) => !entry.paired),
    noteOnly: notes.filter((entry) => !entry.paired),
    skipped,
  };
}

export function noteBody(raw) {
  return String(raw || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function vibeFromNote(note) {
  const text = String(note || "").toLowerCase();
  const tokens = text.match(/[a-z0-9']+/g) || [];
  let grit = 0;
  let soft = 0;
  let people = 0;

  for (const rawToken of tokens) {
    const token = rawToken.replace(/'/g, "");
    if (GRIT.has(token)) grit += 1;
    if (SOFT.has(token)) soft += 1;
    if (PEOPLE.has(token)) people += 1;
  }
  for (const phrase of GRIT_PHRASES) if (text.includes(phrase)) grit += 2;
  for (const phrase of SOFT_PHRASES) if (text.includes(phrase)) soft += 2;
  for (const phrase of PEOPLE_PHRASES) if (text.includes(phrase)) people += 2;

  const sum = grit + soft + people;
  if (!sum) return [0.5, 0.5, 0.5];
  const mix = (count) => Math.round((0.12 + 0.84 * (count / sum)) * 100) / 100;
  return [mix(grit), mix(soft), mix(people)];
}

export function isoDate(ms) {
  const when = new Date(ms);
  if (Number.isNaN(when.getTime())) return "";
  const y = when.getFullYear();
  const m = String(when.getMonth() + 1).padStart(2, "0");
  const d = String(when.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function altFromName(name) {
  const stem = basename(name)
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .trim();
  return stem ? `A photo you kept — ${stem}` : "A photo you kept";
}

export function fingerprintOf(entry) {
  const path = entry?.relativePath || entry?.name || "";
  return `${path}|${entry?.size || 0}|${entry?.lastModified || 0}`;
}

// One phone photo, plus a note only when the words are really there.
// Empty notes stay on the photo-only path so the placeholder is unchanged.
export function captureEntries({ file, note } = {}) {
  if (!file) return [];
  const name = file.name || "capture.jpg";
  const photo = {
    file,
    name,
    relativePath: file.webkitRelativePath || name,
    type: file.type || "",
    size: file.size || 0,
    lastModified: file.lastModified || 0,
  };
  const body = noteBody(note);
  if (!body) return [photo];

  const base = basename(name);
  const cut = base.lastIndexOf(".");
  const stem = cut > 0 ? base.slice(0, cut) : base || "capture";
  const noteName = `${stem}.txt`;
  const directory = directoryOf(photo.relativePath);
  const relativePath = directory ? `${directory}/${noteName}` : noteName;
  return [
    photo,
    {
      file: {
        name: noteName,
        type: "text/plain",
        size: body.length,
        lastModified: photo.lastModified,
        text: async () => body,
      },
      name: noteName,
      relativePath,
      type: "text/plain",
      size: body.length,
      lastModified: photo.lastModified,
    },
  ];
}

export function createImportId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `import-${uuid}`;
  return `import-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function paperWash(seed) {
  const text = String(seed || "paper");
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 33) ^ text.charCodeAt(i);
  }
  const n = Math.abs(hash);
  const hue = 22 + (n % 16);
  const sat = 28 + (n % 14);
  const light = 68 + (n % 8);
  return `hsl(${hue} ${sat}% ${light}%)`;
}

export function paperLine(note) {
  const line =
    String(note || "")
      .split("\n")
      .map((part) => part.trim())
      .find(Boolean) || "a note";
  return line.length > 72 ? `${line.slice(0, 72).trim()}…` : line;
}

function shardBase({ id, note, why, date, vibe, photoAlt, hasPhoto, filename, noteName, fingerprint, placeholder }) {
  return {
    id,
    imported: true,
    hasPhoto,
    paper: !hasPhoto,
    photoAlt,
    date,
    note,
    why,
    vibe,
    filename: filename || "",
    noteName: noteName || "",
    fingerprint,
    placeholder: Boolean(placeholder),
  };
}

export function buildImportedShards(
  grouped,
  { jobId = "soft", textFor = () => "", createId = createImportId, now = Date.now() } = {},
) {
  const shards = [];
  const why = whyForJob(jobId);
  const today = isoDate(now) || "1970-01-01";

  const dated = (entry) => isoDate(entry?.lastModified) || today;

  for (const { image, note } of grouped.pairs) {
    const body = noteBody(textFor(note));
    const written = body.length > 0;
    const text = written ? body : draftNote();
    shards.push({
      ...shardBase({
        id: createId(),
        note: text,
        why,
        date: dated(image),
        vibe: vibeFromNote(text),
        photoAlt: altFromName(image.name),
        hasPhoto: true,
        filename: image.name,
        noteName: note.name,
        fingerprint: fingerprintOf(image),
        placeholder: !written,
      }),
      photoFile: image.file || null,
      mime: image.type || "",
    });
  }

  for (const image of grouped.photoOnly) {
    const text = draftNote();
    shards.push({
      ...shardBase({
        id: createId(),
        note: text,
        why,
        date: dated(image),
        vibe: vibeFromNote(text),
        photoAlt: altFromName(image.name),
        hasPhoto: true,
        filename: image.name,
        fingerprint: fingerprintOf(image),
        placeholder: true,
      }),
      photoFile: image.file || null,
      mime: image.type || "",
    });
  }

  for (const note of grouped.noteOnly) {
    const body = noteBody(textFor(note));
    const text = body || draftNote();
    shards.push({
      ...shardBase({
        id: createId(),
        note: text,
        why,
        date: dated(note),
        vibe: vibeFromNote(text),
        photoAlt: "A letter without a photograph",
        hasPhoto: false,
        noteName: note.name,
        fingerprint: fingerprintOf(note),
        placeholder: !body,
      }),
      photoFile: null,
      mime: "",
    });
  }

  return shards;
}

export function mergePlan(existing, drafts) {
  const known = new Map(
    existing
      .filter((row) => row.fingerprint)
      .map((row) => [row.fingerprint, { id: row.id, placeholder: Boolean(row.placeholder) }]),
  );
  const actions = [];

  for (const draft of drafts) {
    const prev = draft.fingerprint ? known.get(draft.fingerprint) : null;
    if (!prev) {
      actions.push({ type: "add", draft });
      if (draft.fingerprint) {
        known.set(draft.fingerprint, { id: draft.id, placeholder: Boolean(draft.placeholder) });
      }
      continue;
    }
    if (prev.placeholder && !draft.placeholder) {
      actions.push({ type: "update", id: prev.id, draft });
      prev.placeholder = false;
      continue;
    }
    actions.push({ type: "skip", id: prev.id, draft });
  }

  return actions;
}

export function describeIntake(grouped, { added = 0, updated = 0, duplicate = 0 } = {}) {
  if (!added && !updated && duplicate) {
    return duplicate === 1 ? "Already in the pool." : "Those are already in the pool.";
  }

  const parts = [];
  const paired = grouped.pairs.length;
  const photos = grouped.photoOnly.length;
  const notes = grouped.noteOnly.length;
  if (paired === 1) parts.push("1 photo with its note");
  else if (paired) parts.push(`${paired} photos with their notes`);
  if (photos === 1) parts.push("1 photo, note still unwritten");
  else if (photos) parts.push(`${photos} photos, notes still unwritten`);
  if (notes === 1) parts.push("1 note on paper");
  else if (notes) parts.push(`${notes} notes on paper`);

  if (!parts.length) {
    if (grouped.skipped.length) return "Those aren’t photos or notes this page can read.";
    return "Nothing there to keep.";
  }

  let line = `${parts.join(", ")}. In the pool.`;
  if (duplicate) line += duplicate === 1 ? " One was already here." : ` ${duplicate} were already here.`;
  if (updated) line += updated === 1 ? " A placeholder grew a note." : ` ${updated} placeholders grew notes.`;
  return line;
}
