/**
 * Chord charts for the Worship Team. Lyrics carry chords inline in square
 * brackets — "[G]Amazing [C]grace" — and are rendered with each chord above
 * the word it lands on. Charts transpose between keys by semitone shift.
 * Bracketed text that isn't a chord (e.g. "[Chorus]") is a section label.
 */

const SHARPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLATS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const FLAT_KEYS = new Set(["F", "Bb", "Eb", "Ab", "Db", "Gb", "Dm", "Gm", "Cm", "Fm", "Bbm", "Ebm"]);

/** Keys offered in the key pickers, indexed by semitone from C. */
export const KEYS = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
export const MINOR_KEYS = ["Cm", "C#m", "Dm", "Ebm", "Em", "Fm", "F#m", "Gm", "G#m", "Am", "Bbm", "Bm"];

// Root, accidental, quality (only real chord suffixes, so "[Chorus]" or
// "[Bridge]" aren't mistaken for C or B chords), optional slash bass.
const CHORD_RE =
  /^([A-G])([#b]?)((?:maj|min|dim|aug|sus|add|m|M|[0-9#b+\-()°ø])*)(?:\/([A-G])([#b]?))?$/;

function noteIndex(letter: string, accidental: string): number {
  const base = SHARPS.indexOf(letter);
  const shift = accidental === "#" ? 1 : accidental === "b" ? -1 : 0;
  return (base + shift + 12) % 12;
}

export function isChord(text: string): boolean {
  return CHORD_RE.test(text.trim());
}

/** Semitones from one key to another (0 when either is missing). */
export function semitonesBetween(from: string | null, to: string | null): number {
  if (!from || !to) return 0;
  const a = CHORD_RE.exec(from);
  const b = CHORD_RE.exec(to);
  if (!a || !b) return 0;
  return (noteIndex(b[1], b[2]) - noteIndex(a[1], a[2]) + 12) % 12;
}

/** Transposes one chord ("F#m7/C#") by `steps`, spelling for `targetKey`. */
export function transposeChord(chord: string, steps: number, targetKey: string | null): string {
  const m = CHORD_RE.exec(chord.trim());
  if (!m || steps % 12 === 0) return chord;
  const names = targetKey && FLAT_KEYS.has(targetKey) ? FLATS : SHARPS;
  const move = (letter: string, acc: string) =>
    names[(noteIndex(letter, acc) + steps + 120) % 12];
  const root = move(m[1], m[2]);
  const bass = m[4] ? `/${move(m[4], m[5] ?? "")}` : "";
  return `${root}${m[3]}${bass}`;
}

/** Transposes a key name, spelled as the key pickers spell it ("A#" → "Bb"). */
export function transposeKey(key: string | null, steps: number): string | null {
  if (!key) return key;
  const m = CHORD_RE.exec(key.trim());
  if (!m) return key;
  const index = (noteIndex(m[1], m[2]) + steps + 120) % 12;
  return (m[3] === "m" ? MINOR_KEYS : KEYS)[index];
}

/** Same key, picker spelling: canonicalKey("A#") === "Bb". */
export function canonicalKey(key: string | null): string | null {
  return transposeKey(key, 0);
}

export type ChartSegment = { chord: string | null; text: string };
export type ChartLine =
  | { kind: "label"; text: string }
  | { kind: "blank" }
  | { kind: "line"; segments: ChartSegment[]; hasChords: boolean };

/** Parses lyrics into renderable lines, transposing chords on the way. */
export function parseChart(lyrics: string, steps = 0, targetKey: string | null = null): ChartLine[] {
  return lyrics.split("\n").map((raw): ChartLine => {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) return { kind: "blank" };

    // A line that's only a non-chord bracket is a section label: "[Chorus]".
    const label = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (label && !isChord(label[1])) return { kind: "label", text: label[1].trim() };

    const segments: ChartSegment[] = [];
    let hasChords = false;
    let pendingChord: string | null = null;
    let text = "";
    const re = /\[([^\]]+)\]/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) {
      text += line.slice(last, m.index);
      last = m.index + m[0].length;
      if (!isChord(m[1])) {
        text += m[1];
        continue;
      }
      if (pendingChord !== null || text) segments.push({ chord: pendingChord, text });
      pendingChord = transposeChord(m[1], steps, targetKey);
      hasChords = true;
      text = "";
    }
    text += line.slice(last);
    if (pendingChord !== null || text) segments.push({ chord: pendingChord, text });
    return { kind: "line", segments, hasChords };
  });
}
