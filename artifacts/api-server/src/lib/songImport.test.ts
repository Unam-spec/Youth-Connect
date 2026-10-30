import { describe, it, expect } from "vitest";
import {
  chordSheetToLyrics,
  chordProToSong,
  ultimateGuitarSong,
  ultimateGuitarSearchResults,
  genericPageSong,
} from "./songImport";

// Made-up lyrics so no real song text lives in the repo.
describe("chordSheetToLyrics", () => {
  it("merges Ultimate Guitar chord lines into the lyric below", () => {
    const ug = [
      "Capo 2, half step down",
      "",
      "[Verse 1]",
      "[tab]     [ch]G[/ch]          [ch]D[/ch]",
      "Morning light is rising[/tab]",
      "[tab][ch]Em[/ch]       [ch]C[/ch]",
      "Every heart awake[/tab]",
      "",
      "[Chorus]",
      "| [ch]G[/ch] | [ch]D/F#[/ch] |",
    ].join("\n");
    expect(chordSheetToLyrics(ug)).toBe(
      ["[Verse 1]", "Morni[G]ng light is[D] rising", "[Em]Every hea[C]rt awake", "", "[Chorus]", "[G] [D/F#]"].join("\n"),
    );
  });

  it("handles plain chords-above-lyrics text", () => {
    const plain = ["G        C", "Sing a new song", "Am   D"].join("\n");
    expect(chordSheetToLyrics(plain)).toBe(["[G]Sing a ne[C]w song", "[Am] [D]"].join("\n"));
  });

  it("leaves normal lyric lines alone", () => {
    expect(chordSheetToLyrics("A song for you\nAnd me")).toBe("A song for you\nAnd me");
  });
});

describe("chordProToSong", () => {
  it("reads directives and section markers", () => {
    const song = chordProToSong(
      ["{title: Test Song}", "{artist: The Band}", "{key: G}", "{tempo: 72}", "{soc}", "[G]Hello [C]there", "{eoc}"].join("\n"),
    );
    expect(song).toEqual({
      title: "Test Song",
      artist: "The Band",
      original_key: "G",
      tempo_bpm: 72,
      lyrics: "[Chorus]\n[G]Hello [C]there",
    });
  });
});

function ugPage(data: unknown): string {
  const json = JSON.stringify({ store: { page: { data } } }).replace(/"/g, "&quot;");
  return `<html><div class="js-store" data-content="${json}"></div></html>`;
}

describe("Ultimate Guitar pages", () => {
  it("reads a chords page", () => {
    const html = ugPage({
      tab: { song_name: "Test Song", artist_name: "The Band", tonality_name: "C" },
      tab_view: { wiki_tab: { content: "[Verse]\n[tab][ch]C[/ch]\nHello[/tab]" } },
    });
    expect(ultimateGuitarSong(html)).toEqual({
      title: "Test Song",
      artist: "The Band",
      original_key: "C",
      tempo_bpm: null,
      lyrics: "[Verse]\n[C]Hello",
    });
  });

  it("lists chord results, most voted first", () => {
    const html = ugPage({
      results: [
        { type: "Tabs", song_name: "X", artist_name: "Y", tab_url: "https://u/1", votes: 999 },
        { type: "Chords", song_name: "A", artist_name: "B", tab_url: "https://u/2", votes: 5, rating: 4.567 },
        { type: "Chords", song_name: "A", artist_name: "C", tab_url: "https://u/3", votes: 50 },
      ],
    });
    expect(ultimateGuitarSearchResults(html).map((r) => r.url)).toEqual(["https://u/3", "https://u/2"]);
    expect(ultimateGuitarSearchResults(html)[1].rating).toBe(4.6);
  });
});

describe("genericPageSong", () => {
  it("uses the page title and the biggest <pre> chord sheet", () => {
    const html = `<title>Test Song | Chords Site</title><pre>G     C\nHello world</pre>`;
    expect(genericPageSong(html)).toMatchObject({ title: "Test Song", lyrics: "[G]Hello [C]world" });
  });
});
