/**
 * Turns chord sheets from the web into the Worship Team's lyrics format:
 * chords inline in square brackets ("[G]Amazing [C]grace") and section
 * labels on their own line ("[Chorus]").
 *
 * Handles Ultimate Guitar's markup ([ch]G[/ch], [tab]…[/tab]), plain
 * "chords above the lyrics" sheets, and ChordPro. Pure — no network.
 */

const CHORD = /^[A-G][#b]?(?:maj|min|dim|aug|sus|add|m|M|[0-9#b+\-()°ø])*(?:\/[A-G][#b]?)?$/;
const SECTION = /^\s*\[([^\]]+)\]\s*$/;

export function isChordToken(token: string): boolean {
  return CHORD.test(token);
}

type PlacedChord = { col: number; chord: string };

/** Chords on a line and their columns, if the line holds only chords. */
function chordLine(line: string): PlacedChord[] | null {
  const chords: PlacedChord[] = [];
  // Ultimate Guitar markup: column = rendered position, chord text counts.
  if (line.includes("[ch]")) {
    let col = 0;
    let rest = "";
    const re = /\[ch\](.*?)\[\/ch\]/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) {
      const before = line.slice(last, m.index);
      rest += before;
      col += before.length;
      chords.push({ col, chord: m[1].trim() });
      col += m[1].length;
      last = m.index + m[0].length;
    }
    rest += line.slice(last);
    // Only chords (plus spacing and bar lines) → a chord line.
    return /^[\s|\-/.x\d()]*$/i.test(rest) ? chords : null;
  }
  // Plain text: every token must be a chord.
  const tokens = [...line.matchAll(/\S+/g)];
  if (tokens.length === 0) return null;
  for (const t of tokens) {
    const word = t[0];
    if (word === "|" || word === "-" || /^x\d$/i.test(word)) continue;
    if (!isChordToken(word)) return null;
    chords.push({ col: t.index ?? 0, chord: word });
  }
  return chords.length ? chords : null;
}

/** Puts chords into the lyric line at their columns: "[G]Amazing [C]grace". */
function mergeChords(lyric: string, chords: PlacedChord[]): string {
  let out = lyric;
  for (const { col, chord } of [...chords].sort((a, b) => b.col - a.col)) {
    if (col > out.length) out = out.padEnd(col, " ");
    out = `${out.slice(0, col)}[${chord}]${out.slice(col)}`;
  }
  return out.trimEnd();
}

/**
 * Converts "chords above the lyrics" text (optionally with Ultimate Guitar
 * markup) into inline-chord lyrics. Text before the first section label is
 * dropped when there is one (it's usually tuning/capo notes).
 */
export function chordSheetToLyrics(sheet: string): string {
  let lines = sheet
    .replace(/\r\n?/g, "\n")
    .replace(/\[\/?tab\]/g, "")
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""));

  const firstSection = lines.findIndex((l) => SECTION.test(l) && !isChordToken(SECTION.exec(l)![1].trim()));
  if (firstSection > 0) lines = lines.slice(firstSection);

  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const section = SECTION.exec(line);
    if (section && !line.includes("[ch]") && !isChordToken(section[1].trim())) {
      out.push(`[${section[1].trim()}]`);
      continue;
    }
    const chords = chordLine(line);
    if (!chords) {
      out.push(line.replace(/\[\/?ch\]/g, ""));
      continue;
    }
    const next = lines[i + 1];
    const nextIsLyric =
      next !== undefined && next.trim() !== "" && !chordLine(next) && !SECTION.test(next);
    if (nextIsLyric) {
      out.push(mergeChords(next.replace(/\[\/?ch\]/g, ""), chords));
      i++;
    } else {
      // Chords with no words under them (intros, turnarounds).
      out.push(chords.map((c) => `[${c.chord}]`).join(" "));
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export type ImportedSong = {
  title: string;
  artist: string | null;
  original_key: string | null;
  tempo_bpm: number | null;
  lyrics: string;
};

/** ChordPro → our format, reading title/artist/key/tempo directives. */
export function chordProToSong(text: string): ImportedSong {
  const meta: Record<string, string> = {};
  const out: string[] = [];
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const directive = /^\s*\{\s*([a-z_]+)\s*(?::\s*(.*?))?\s*\}\s*$/i.exec(line);
    if (directive) {
      const key = directive[1].toLowerCase();
      const value = (directive[2] ?? "").trim();
      if (["t", "title"].includes(key)) meta.title = value;
      else if (["st", "subtitle", "artist"].includes(key)) meta.artist ??= value;
      else if (["k", "key"].includes(key)) meta.key = value;
      else if (key === "tempo") meta.tempo = value;
      else if (["soc", "start_of_chorus"].includes(key)) out.push(value ? `[${value}]` : "[Chorus]");
      else if (["sov", "start_of_verse"].includes(key)) out.push(value ? `[${value}]` : "[Verse]");
      else if (["sob", "start_of_bridge"].includes(key)) out.push(value ? `[${value}]` : "[Bridge]");
      else if (["c", "comment", "ci", "comment_italic"].includes(key) && value) out.push(`[${value}]`);
      continue;
    }
    if (line.startsWith("#")) continue;
    out.push(line);
  }
  const tempo = Number(meta.tempo);
  return {
    title: meta.title ?? "",
    artist: meta.artist || null,
    original_key: meta.key || null,
    tempo_bpm: Number.isInteger(tempo) && tempo >= 30 && tempo <= 300 ? tempo : null,
    lyrics: out.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
  };
}

export function looksLikeChordPro(text: string): boolean {
  return /\{\s*(t|title|soc|start_of_chorus|sov|start_of_verse)\s*[:}]/i.test(text);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}

/** The data blob Ultimate Guitar embeds in every page. */
export function ultimateGuitarStore(html: string): any | null {
  const m = /class="js-store"\s+data-content="([^"]*)"/.exec(html);
  if (!m) return null;
  try {
    return JSON.parse(decodeEntities(m[1]));
  } catch {
    return null;
  }
}

/** An Ultimate Guitar chords page → a song. */
export function ultimateGuitarSong(html: string): ImportedSong | null {
  const data = ultimateGuitarStore(html)?.store?.page?.data;
  const content: unknown = data?.tab_view?.wiki_tab?.content;
  if (typeof content !== "string" || !content.trim()) return null;
  const key = data?.tab?.tonality_name || data?.tab_view?.meta?.tonality || null;
  return {
    title: String(data?.tab?.song_name ?? "").trim(),
    artist: data?.tab?.artist_name ? String(data.tab.artist_name).trim() : null,
    original_key: typeof key === "string" && isChordToken(key) ? key : null,
    tempo_bpm: null,
    lyrics: chordSheetToLyrics(content),
  };
}

export type OnlineResult = { title: string; artist: string; url: string; rating: number | null; votes: number };

/** Ultimate Guitar search page → chord-sheet results, most-voted first. */
export function ultimateGuitarSearchResults(html: string): OnlineResult[] {
  const results: any[] = ultimateGuitarStore(html)?.store?.page?.data?.results ?? [];
  return results
    .filter((r) => r?.type === "Chords" && typeof r?.tab_url === "string")
    .map((r) => ({
      title: String(r.song_name ?? ""),
      artist: String(r.artist_name ?? ""),
      url: String(r.tab_url),
      rating: typeof r.rating === "number" ? Math.round(r.rating * 10) / 10 : null,
      votes: Number(r.votes) || 0,
    }))
    .sort((a, b) => b.votes - a.votes)
    .slice(0, 12);
}

/** Any other page: its title, plus the biggest <pre> block as a chord sheet. */
export function genericPageSong(html: string): ImportedSong {
  const og = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i.exec(html);
  const titleTag = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
  const title = decodeEntities((og?.[1] ?? titleTag?.[1] ?? "").trim())
    .replace(/\s*[|–—-]\s*[^|–—-]*$/, "")
    .trim();
  const pres = [...html.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/gi)].map((m) =>
    decodeEntities(m[1].replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")),
  );
  const sheet = pres.sort((a, b) => b.length - a.length)[0] ?? "";
  if (looksLikeChordPro(sheet)) {
    const song = chordProToSong(sheet);
    return { ...song, title: song.title || title };
  }
  return { title, artist: null, original_key: null, tempo_bpm: null, lyrics: sheet ? chordSheetToLyrics(sheet) : "" };
}
