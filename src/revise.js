// Rewrite the note on a letter you brought in.
// Sample letters stay as written. An empty save returns to the placeholder
// draft, so a shard never loses its words. The vibe is read again from the
// note, and a changed note must not reuse the MiniLM vector for those words.

import { textFingerprint } from "./embed-cache.js";
import { draftNote, noteBody, vibeFromNote } from "./ingest.js";
import { shardDocument } from "./ranker.js";

export function canReviseNote(shard) {
  return Boolean(shard && shard.imported && shard.id);
}

// What the letter shows in the editor. A placeholder opens blank, with the
// draft as the hint, so the first real sentence replaces it cleanly.
export function editorSeed(shard) {
  const placeholder = draftNote();
  const showingDraft = Boolean(shard?.placeholder) && shard?.note === placeholder;
  return {
    value: showingDraft ? "" : String(shard?.note ?? ""),
    placeholder,
  };
}

// null when this letter cannot be edited, or the cleaned text is already stored.
// wordsChanged is false when only the placeholder flag moves (the same draft
// typed out on purpose). The fingerprint is the one the note cache uses.
export function reviseOwnNote(shard, text) {
  if (!canReviseNote(shard)) return null;

  const written = noteBody(text);
  const note = written || draftNote();
  const placeholder = !written;
  const sameNote = note === String(shard.note ?? "");
  const sameFlag = Boolean(shard.placeholder) === placeholder;
  if (sameNote && sameFlag) return null;

  const vibe = vibeFromNote(note);
  return {
    id: shard.id,
    note,
    vibe,
    placeholder,
    wordsChanged: !sameNote,
    fingerprint: textFingerprint(shardDocument({ ...shard, note })),
  };
}
