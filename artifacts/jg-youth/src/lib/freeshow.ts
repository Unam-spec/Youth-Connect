/**
 * FreeShow (freeshow.app) files, both ways:
 *  - Read FreeShow songs (.show files from its Shows folder) into the
 *    Worship Team's lyrics format, for importing the library.
 *  - Write a setlist as a FreeShow project (.project) to import in FreeShow,
 *    each song in the setlist's key with chords kept.
 *
 * Format (from FreeShow's source): a .show file is JSON `[id, show]`; slide
 * text lives in items[].lines[].text[].value and chords are
 * { id, pos, key } where pos is the character index in the line. A .project
 * file is JSON { project, shows: { [id]: show } }.
 */
import { isChord } from "./worshipChords";

export interface ImportableSong {
  title: string;
  artist: string | null;
  original_key: string | null;
  lyrics: string;
}

type FsLine = { align?: string; text?: { value?: string; style?: string }[]; chords?: { id?: string; pos: number; key: string }[] };
type FsSlide = {
  group?: string | null;
  globalGroup?: string;
  children?: string[];
  items?: { lines?: FsLine[] }[];
};
type FsShow = {
  name?: string;
  category?: string | null;
  reference?: unknown;
  meta?: Record<string, string | undefined>;
  settings?: { activeLayout?: string };
  slides?: Record<string, FsSlide>;
  layouts?: Record<string, { slides?: { id: string }[] }>;
};

// FreeShow's own categories for shows that aren't songs (announcements, notes…).
const NOT_SONG_CATEGORIES = new Set(["presentation", "scripture", "converted"]);

function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** First chord-looking word of a key field ("G major" → "G"). */
function readKey(value: string | undefined): string | null {
  const first = value?.trim().split(/\s+/)[0] ?? "";
  return first && isChord(first) ? first : null;
}

/** Puts { pos, key } chords back into the text: "[G]Amazing [C]grace". */
function lineWithChords(line: FsLine): string {
  let text = (line.text ?? []).map((t) => t.value ?? "").join("").replace(/<br\s*\/?>/gi, " ");
  const chords = [...(line.chords ?? [])].filter((c) => c?.key).sort((a, b) => b.pos - a.pos);
  for (const c of chords) {
    const pos = Math.max(0, Math.min(c.pos, text.length));
    text = `${text.slice(0, pos)}[${c.key.trim()}]${text.slice(pos)}`;
  }
  return text.trimEnd();
}

/** One FreeShow .show file → a song, or null if it isn't a song (scripture, media…). */
export function parseFreeShowShow(content: string, fileName = ""): ImportableSong | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  const show = (Array.isArray(parsed) ? parsed[1] : parsed) as FsShow | undefined;
  if (!show || typeof show !== "object" || show.reference || !show.slides) return null;
  if (show.category && NOT_SONG_CATEGORIES.has(show.category)) return null;

  // Slide order: the active layout (parents, then their child slides).
  const layout = show.layouts?.[show.settings?.activeLayout ?? ""] ?? Object.values(show.layouts ?? {})[0];
  const order = layout?.slides?.map((s) => s.id) ?? Object.keys(show.slides);
  const seen = new Set<string>();
  const blocks: string[] = [];
  for (const id of order) {
    if (seen.has(id)) continue; // repeated chorus etc. — keep the lyrics once
    seen.add(id);
    const parent = show.slides[id];
    if (!parent) continue;
    for (const slideId of [id, ...(parent.children ?? [])]) {
      const slide = show.slides[slideId];
      if (!slide) continue;
      const lines = (slide.items ?? []).flatMap((item) => item.lines ?? []).map(lineWithChords).filter((l) => l.trim());
      if (!lines.length) continue;
      const label = slideId === id ? slide.group || (slide.globalGroup ? titleCase(slide.globalGroup) : "") : "";
      blocks.push([label ? `[${label}]` : null, ...lines].filter(Boolean).join("\n"));
    }
  }
  const lyrics = blocks.join("\n\n").trim();
  const title = (show.meta?.title || show.name || fileName.replace(/\.show$/i, "")).trim();
  if (!title || !lyrics) return null;
  return {
    title: title.slice(0, 120),
    artist: (show.meta?.artist || show.meta?.author || "").trim().slice(0, 120) || null,
    original_key: readKey(show.meta?.key),
    lyrics,
  };
}

// ── Setlist → FreeShow project ────────────────────────────────────────────────

const ITEM_STYLE = "top:88px;left:50px;height:904px;width:1820px;"; // FreeShow's default text box
const TEXT_STYLE = "font-size:100px;text-transform:uppercase;"; // how the team's own slides look
const MAX_LINES_PER_SLIDE = 8; // the most that fits at that size; longer sections carry on on a new slide
const GLOBAL_GROUPS: Record<string, string> = {
  verse: "verse",
  chorus: "chorus",
  "pre chorus": "pre_chorus",
  "pre-chorus": "pre_chorus",
  prechorus: "pre_chorus",
  bridge: "bridge",
  intro: "intro",
  outro: "outro",
  ending: "outro",
  tag: "tag",
  break: "break",
  interlude: "break",
};

function uid(length = 11): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

/**
 * The same song always gets the same id, so importing it again updates that
 * copy. FreeShow gives a random id a new copy every time ("Song 2", "Song 3").
 */
function stableShowId(title: string): string {
  let a = 0x811c9dc5;
  let b = 5381;
  for (const ch of title.trim().toLowerCase()) {
    const c = ch.codePointAt(0) ?? 0;
    a = Math.imul(a ^ c, 16777619) >>> 0;
    b = (Math.imul(b, 33) + c) >>> 0;
  }
  return `wt${a.toString(36)}${b.toString(36)}`.slice(0, 11).padEnd(11, "0");
}

/** "[G]Amazing [C]grace" → FreeShow line { text, chords:[{pos,key}] }. */
function toFreeShowLine(line: string) {
  let text = "";
  const chords: { id: string; pos: number; key: string }[] = [];
  const re = /\[([^\]]+)\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    text += line.slice(last, m.index);
    last = m.index + m[0].length;
    if (isChord(m[1])) chords.push({ id: uid(5), pos: text.length, key: m[1] });
    else text += m[0];
  }
  text += line.slice(last);
  return { align: "", text: [{ value: text.trimEnd(), style: TEXT_STYLE }], chords };
}

/** Our lyrics → a FreeShow show (one slide per section / blank-line block). */
export function songToFreeShowShow(song: { title: string; artist: string | null; key: string | null; lyrics: string }) {
  type Block = { group: string; lines: string[] };
  const blocks: Block[] = [];
  let group = "";
  let current: Block | null = null;
  for (const raw of song.lyrics.split("\n")) {
    const line = raw.trimEnd();
    const label = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (label && !isChord(label[1].trim())) {
      group = label[1].trim();
      current = null;
      continue;
    }
    if (!line.trim()) {
      current = null;
      continue;
    }
    const lyric = toFreeShowLine(line);
    if (!lyric.text[0].value.trim()) continue; // chord-only lines (intros) aren't projected
    if (!current || current.lines.length >= MAX_LINES_PER_SLIDE) {
      current = { group, lines: [] };
      blocks.push(current);
    }
    current.lines.push(line);
  }

  const slides: Record<string, unknown> = {};
  const layoutSlides: { id: string }[] = [];
  for (const b of blocks) {
    const id = uid();
    const global = GLOBAL_GROUPS[b.group.replace(/\d+/g, "").trim().toLowerCase()];
    slides[id] = {
      group: b.group || null,
      color: null,
      ...(global ? { globalGroup: global } : {}),
      settings: {},
      notes: "",
      items: [{ type: "text", style: ITEM_STYLE, auto: true, lines: b.lines.map(toFreeShowLine) }],
    };
    layoutSlides.push({ id });
  }
  const layoutId = uid();
  return {
    // Not the bare title: that's the team's own FreeShow copy of the song, and
    // FreeShow would answer the clash by renaming this one "Song 2".
    name: `${song.title} (${song.key ?? "setlist"})`,
    category: null,
    settings: { activeLayout: layoutId, template: null },
    timestamps: { created: Date.now(), modified: null, used: null },
    quickAccess: {},
    meta: { title: song.title, artist: song.artist ?? "", key: song.key ?? "" },
    slides,
    layouts: { [layoutId]: { name: "Default", notes: "", slides: layoutSlides } },
    media: {},
  };
}

/** A whole setlist as a FreeShow project file's contents. */
export function setlistToFreeShowProject(
  name: string,
  songs: { title: string; artist: string | null; key: string | null; lyrics: string }[],
): string {
  const shows: Record<string, unknown> = {};
  const refs: { id: string }[] = [];
  for (const song of songs) {
    const id = stableShowId(song.title);
    shows[id] = songToFreeShowShow(song);
    refs.push({ id });
  }
  return JSON.stringify({
    project: { name, created: Date.now(), parent: "/", shows: refs },
    shows,
  });
}
