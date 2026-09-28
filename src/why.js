// The letter's "why this helps today" line.
// Composed in the browser from the job, the note, and which score won
// (words, job closeness, or the picture). No model, no upload.

import { draftNote } from "./ingest.js";

const NOT_NAMES = new Set(
  `i we you he she they it me my our your his her their the a an this that these those
  sunday monday tuesday wednesday thursday friday saturday
  january february march april may june july august september october november december
  halfway morning tonight yesterday today nobody someone something
  walked stayed shipped read just when before after then and but so if for on in at by
  not yes no ok sleep put putting ten answer let once here there now still even`
    .split(/\s+/),
);

const PUSH_RE =
  /\b(anyway|went|started|finished|shipped|mile|miles|heavy|heaviness|colder|cold|stroke|strokes|uphill|kept|ran|hike|hiking|practice|turn)\b/i;
const SOFT_RE =
  /\b(quiet|light|rain|sunday|ordinary|warm|slow|window|coffee|grass|read|reading|gentle|morning|kitchen|home|soft|walked|walk)\b/i;
const PEOPLE_RE =
  /\b(laugh|laughs|laughed|table|dinner|sister|brother|uncle|aunt|ask|asks|asked|friend|friends|name|names|porch|cafe|café|birthday|together)\b/i;

const LEAD_VERB = /^(is|was|were|will|prefers|likes|wants|asks|laughs)\b/i;

function curl(text) {
  return String(text ?? "").replace(/'/g, "’");
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function escapeReg(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sentencesOf(note) {
  const text = String(note ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return [];
  const parts = text
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length ? parts : [text];
}

function sameWords(a, b) {
  return curl(a).replace(/\s+/g, " ").trim() === curl(b).replace(/\s+/g, " ").trim();
}

function isDraft(note, placeholder) {
  if (placeholder) return true;
  const text = String(note ?? "").trim();
  if (!text) return true;
  return sameWords(text, draftNote());
}

function extractNames(note) {
  const text = curl(note);
  const found = [];
  const seen = new Set();

  function add(raw) {
    const clean = String(raw ?? "")
      .replace(/[’']s$/i, "")
      .trim();
    const key = clean.toLowerCase();
    if (!clean || seen.has(key) || NOT_NAMES.has(key)) return;
    if (!/^[A-Z]/.test(clean)) return;
    seen.add(key);
    found.push(clean);
  }

  const relations =
    /\b(Uncle|Aunt|Mom|Dad|Mother|Father|Sister|Brother|Grandma|Grandpa|Cousin)(?:\s+([A-Z][a-z]+))?\b/g;
  for (const match of text.matchAll(relations)) {
    add(match[2] ? `${match[1]} ${match[2]}` : match[1]);
  }
  for (const match of text.matchAll(/\b([A-Z][a-z]{1,20})[’']s\b/g)) add(match[1]);

  for (const sentence of sentencesOf(text)) {
    const tokens = sentence.match(/\b[A-Z][a-z]{1,20}\b/g) || [];
    tokens.forEach((token, index) => {
      if (index === 0) {
        const at = sentence.indexOf(token);
        const rest = sentence.slice(at + token.length).trim();
        if (!LEAD_VERB.test(rest)) return;
      }
      add(token);
    });
  }

  return found
    .filter(
      (name) =>
        !found.some(
          (other) => other !== name && other.includes(name) && other.length > name.length,
        ),
    )
    .slice(0, 2);
}

function isMeta(sentence) {
  return /^(you already know|that[’']s the whole|you do not need to feel)/i.test(sentence.trim());
}

function isIdent(sentence, name) {
  if (!name) return false;
  return new RegExp(`^${escapeReg(name)}\\s+is\\b`, "i").test(sentence.trim());
}

function scoreSentence(sentence, jobId, names) {
  if (isMeta(sentence)) return -8;
  let score = 1;
  const hasName = names.some((name) => sentence.includes(name));
  if (hasName) score += jobId === "people" ? 6 : 3;
  if (jobId === "push" && PUSH_RE.test(sentence)) score += 4;
  if (jobId === "push" && /\banyway\b/i.test(sentence)) score += 2;
  if (jobId === "soft" && SOFT_RE.test(sentence)) score += 4;
  if (jobId === "people" && PEOPLE_RE.test(sentence)) score += 3;
  if (/\bI\b/.test(sentence)) score += 1;
  if (sentence.length >= 18 && sentence.length <= 110) score += 1;
  if (sentence.length > 150) score -= 2;
  if (names[0] && isIdent(sentence, names[0])) score -= 3;
  return score;
}

function bestSentence(sentences, jobId, names) {
  let best = sentences[0] || "";
  let bestScore = -Infinity;
  for (const sentence of sentences) {
    const score = scoreSentence(sentence, jobId, names);
    if (score > bestScore) {
      best = sentence;
      bestScore = score;
    }
  }
  if (names[0] && isIdent(best, names[0])) {
    const index = sentences.indexOf(best);
    const next = sentences[index + 1];
    if (next && !isMeta(next)) return next;
  }
  return best;
}

function sparkOf(sentence) {
  let text = curl(sentence).replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "");
  if (!text) return "";
  const quoted = text.match(/^I\s+[a-z’]+(?:\s+[a-z’]+){0,3}:\s+(.+)$/i);
  if (quoted && quoted[1].length >= 16) text = quoted[1];
  const before = text.search(/\s+before\s+(anyone|the|you)\b/i);
  if (before >= 24) text = text.slice(0, before).replace(/[,:;–—-]+$/, "").trim();
  if (text.length <= 92) return text;
  const cut = text.slice(0, 92);
  const space = cut.lastIndexOf(" ");
  const base = (space > 40 ? cut.slice(0, space) : cut).replace(/[,:;–—-]+$/, "").trim();
  return `${base}…`;
}

function readNote(note, placeholder) {
  const draft = isDraft(note, placeholder);
  if (draft) {
    return { draft: true, names: [], sparks: { push: "", soft: "", people: "" } };
  }
  const names = extractNames(note);
  const sentences = sentencesOf(note).filter((sentence) => !sameWords(sentence, draftNote()));
  const sparks = {
    push: sparkOf(bestSentence(sentences, "push", names)),
    soft: sparkOf(bestSentence(sentences, "soft", names)),
    people: sparkOf(bestSentence(sentences, "people", names)),
  };
  return { draft: false, names, sparks };
}

function pickWinner({ text, jobScore, image, hasPhoto }) {
  const rows = [
    ["text", num(text)],
    ["job", num(jobScore)],
  ];
  if (hasPhoto && image != null && Number.isFinite(Number(image))) {
    rows.push(["image", Number(image)]);
  }
  const order = { text: 0, job: 1, image: 2 };
  rows.sort((a, b) => b[1] - a[1] || order[a[0]] - order[b[0]]);
  return rows[0][0];
}

function cap(text) {
  const value = String(text ?? "").trim();
  if (!value) return "";
  if (/^I\b/.test(value) || /^I’/.test(value)) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function aside(text, name) {
  const value = String(text ?? "").trim();
  if (!value || /^I\b/.test(value) || /^I’/.test(value)) return value;
  if (name && value.toLowerCase().startsWith(name.toLowerCase())) return value;
  if (/^[A-Z][a-z]+(?:\s+[A-Z])/.test(value)) return value;
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function sentence(text) {
  const value = curl(text).replace(/\s+/g, " ").trim();
  if (!value) return "";
  if (/[.!?…]$/.test(value)) return value;
  return `${value}.`;
}

function join(parts) {
  return parts
    .map((part) => sentence(cap(part)))
    .filter(Boolean)
    .slice(0, 2)
    .join(" ");
}

function lightPhrase(imageVec) {
  if (!imageVec || imageVec.length < 2) return "the light";
  const brightness = Number(imageVec[0]);
  const warmth = Number(imageVec[1]);
  if (!Number.isFinite(brightness) || !Number.isFinite(warmth)) return "the light";
  if (warmth >= 0.62 && brightness < 0.48) return "the warm, dim light";
  if (brightness >= 0.62 && warmth < 0.5) return "the brighter, cooler light";
  if (brightness >= 0.62) return "the brighter light";
  if (warmth >= 0.62) return "the warm light";
  if (brightness < 0.38) return "the dim light";
  return "the light";
}

function photoSubject(alt) {
  let text = String(alt ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || /^a photo you kept\.?$/i.test(text)) return "";
  const named = text.match(/^a photo you kept\s+[—–-]\s+(.+)$/i);
  if (named) text = named[1].trim();
  else text = text.replace(/^(a|an|the)\s+/i, "");
  text = text
    .replace(/\s+in\s+(early|late|soft|warm|quiet|afternoon|morning)\s+\w+$/i, "")
    .replace(/\s+under\s+.+$/i, "");
  if (text.length > 52) text = text.slice(0, 52).replace(/\s+\S*$/, "");
  if (!text || /^(img|dsc|photo|image)\b/i.test(text) || /\d{3,}/.test(text)) return "";
  return text;
}

function withArticle(subject) {
  if (!subject) return "";
  if (/^(a|an|the)\s/i.test(subject)) return subject;
  return /^[aeiou]/i.test(subject) ? `an ${subject}` : `a ${subject}`;
}

function pushTail(spark) {
  const text = spark.toLowerCase();
  if (/\b(anyway|went|ran|hike)\b/.test(text) || /walked the/.test(text)) {
    return "you can get out the door again";
  }
  if (/\b(shipped|finished|stroke|strokes)\b/.test(text)) return "the next small thing is the same move";
  if (/turn around|colder|didn.?t want|wanted to/.test(text)) return "you started before you felt ready";
  return "";
}

function softTail(spark) {
  const text = spark.toLowerCase();
  if (/didn.?t want|wanted to|anyway|colder|shipped/.test(text)) return "";
  if (/rain|window|quiet/.test(text)) return "the quiet still counts";
  if (/\b(light|morning|coffee|kitchen|sunday)\b/.test(text)) return "ordinary, and still yours";
  if (/\b(read|warm|nobody)\b/.test(text)) return "nothing was required of you";
  if (/walk|grass|home/.test(text)) return "a thread you can still hold";
  return "";
}

function withTail(spark, tail) {
  if (!spark) return tail || "";
  if (!tail || spark.length >= 38) return spark;
  const head = tail.slice(0, 14).toLowerCase();
  if (head && spark.toLowerCase().includes(head)) return spark;
  return `${spark} — ${tail}`;
}

function mentions(line, name) {
  return Boolean(name) && line.toLowerCase().includes(name.toLowerCase());
}

function ensureName(line, name) {
  if (!name || mentions(line, name)) return line;
  const match = line.match(/^(.+?\.)\s+([\s\S]+)$/);
  if (!match) return `${line.replace(/\.$/, "")} — ${name}.`;
  const second = match[2].replace(/[.!?]+$/, "");
  const lowered = /^I\b/.test(second) ? second : second.charAt(0).toLowerCase() + second.slice(1);
  return `${match[1]} ${name} — ${lowered}.`;
}

function whoClause(spark, name) {
  if (!spark || !name) return "";
  const lead = spark.replace(new RegExp(`^${escapeReg(name)}\\s+`, "i"), "");
  if (lead === spark || !/^[a-z]/.test(lead)) return "";
  return lead.replace(/[.!?]+$/, "");
}

function detailAfterName(spark, name) {
  if (!spark) return "one true thing, not the résumé";
  const possessive = new RegExp(`^${escapeReg(name)}[’']s\\s+`, "i");
  if (possessive.test(spark)) return `the ${spark.replace(possessive, "")}`;
  return spark;
}

function knownJob(job) {
  const id = typeof job === "string" ? job : job?.id;
  if (!id) return "";
  if (id === "push" || id === "soft" || id === "people") return id;
  return "soft";
}

function paperLine(jobId) {
  if (jobId === "push") {
    return "You asked for a push. The words aren’t here yet — you have already started once.";
  }
  if (jobId === "people") return "Before the room fills up — the name isn’t written yet.";
  return "Not a highlight. A blank page is still a day you kept.";
}

function photoOnlyLine(jobId, { image, imageMode, photoAlt, imageVec }) {
  const seen = image != null && Number.isFinite(Number(image));
  const semantic = seen && imageMode === "semantic";
  const feel = seen && !semantic;
  const subject = semantic ? photoSubject(photoAlt) : "";
  const light = lightPhrase(imageVec);
  const framed = subject ? cap(withArticle(subject)) : "";

  if (jobId === "push") {
    if (framed) return `You asked for a push. ${framed} — you were already in it.`;
    if (semantic) return "You asked for a push. The picture is enough to start from.";
    if (feel) return `You asked for a push. I kept the frame — ${light} is enough to start.`;
    return "You asked for a push. I kept this before the words — start from there.";
  }
  if (jobId === "people") {
    if (framed) return `Before you walk in: ${framed}. One true thing is in the frame.`;
    if (semantic) return "Before you walk in, the picture already holds one true thing.";
    if (feel) return `Before the room fills up — I kept the frame, ${light} and all.`;
    return "Before the room fills up — a face I kept, the name still unwritten.";
  }
  if (framed) return `Not a highlight. ${framed} — texture, not a milestone.`;
  if (semantic) return "Not a highlight. The picture is the texture, and you were there.";
  if (feel) return `Not a highlight. I kept the frame — ${light} is the whole mood.`;
  return "Not a highlight. A frame I kept, still waiting on its sentence.";
}

function writtenLine(jobId, signals, { winner, imageMode, imageVec }) {
  const name = signals.names[0] || "";
  const spark = signals.sparks[jobId] || signals.sparks.push || signals.sparks.soft || "";
  const semantic = winner === "image" && imageMode === "semantic";
  const feel = winner === "image" && !semantic;
  const light = lightPhrase(imageVec);

  if (jobId === "people") {
    const who = whoClause(spark, name);
    const detail = cap(detailAfterName(spark, name));
    if (name && who) {
      if (semantic) return join([`You’re about to see ${name}`, `The picture holds it — ${name} ${who}`]);
      if (feel) return sentence(`You’re about to see ${name}, who ${who} — ${light} keeps the room`);
      if (winner === "job") return sentence(`Before you walk in: ${name}, who ${who}`);
      return sentence(`You’re about to see ${name}, who ${who}`);
    }
    if (name) {
      if (semantic) {
        return join([`You’re about to see ${name}`, `The picture holds it — ${aside(detail, name)}`]);
      }
      if (feel) return join([`You’re about to see ${name}`, `${detail} — ${light} keeps the room`]);
      if (winner === "job") return join([`Before you walk in: ${name}`, detail]);
      return join([`You’re about to see ${name}`, detail]);
    }
    const bit = spark || "one true thing from your own life";
    if (semantic) return join(["Before the room fills up", `The picture holds it — ${aside(bit)}`]);
    if (feel) return join(["Before the room fills up", `${cap(bit)} — ${light} is the room`]);
    if (winner === "job") return join(["One true thing before you walk in", bit]);
    return join(["Before the room fills up", bit]);
  }

  if (jobId === "push") {
    const bit = withTail(spark, pushTail(spark)) || "you have already started once";
    if (semantic) {
      return ensureName(
        join(["You asked for a push", `The picture holds it — ${aside(spark || bit)}`]),
        name,
      );
    }
    if (feel) {
      return ensureName(
        sentence(`You asked for a push. ${cap(spark || bit)} — ${light} is enough to start`),
        name,
      );
    }
    if (winner === "job") return ensureName(join(["The day is heavy", bit]), name);
    return ensureName(join(["You asked for a push", bit]), name);
  }

  const bit = withTail(spark, softTail(spark)) || "a day that was yours";
  if (semantic) {
    return ensureName(join(["Not a highlight", `The frame keeps it — ${aside(spark || bit)}`]), name);
  }
  if (feel) {
    return ensureName(sentence(`Not a highlight. ${cap(spark || bit)} — ${light} is the mood`), name);
  }
  if (winner === "job") {
    return ensureName(join(["A quiet thread, still yours", spark || "a day that was yours"]), name);
  }
  return ensureName(join(["Not a highlight", bit]), name);
}

export function composeWhy({
  job,
  note = "",
  placeholder = false,
  hasPhoto = false,
  photoAlt = "",
  text,
  jobScore,
  image = null,
  imageMode = null,
  imageVec = null,
} = {}) {
  const jobId = knownJob(job);
  if (!jobId) return "";

  const signals = readNote(note, placeholder);
  if (signals.draft) {
    if (!hasPhoto && (image == null || !Number.isFinite(Number(image)))) return paperLine(jobId);
    return photoOnlyLine(jobId, { image, imageMode, photoAlt, imageVec });
  }

  const winner = pickWinner({ text, jobScore, image, hasPhoto });
  const line = writtenLine(jobId, signals, { winner, imageMode, imageVec });
  return line.trim();
}
