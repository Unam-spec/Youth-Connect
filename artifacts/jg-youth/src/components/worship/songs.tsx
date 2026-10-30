import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Globe, Link2, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { worshipFetch, worshipPost, type WorshipSong } from "@/lib/worship";
import { canonicalKey, KEYS, MINOR_KEYS, parseChart } from "@/lib/worshipChords";

/** Native select keeps this simple and mobile-friendly. */
export function KeySelect({
  value,
  onChange,
  id,
  allowNone = true,
  noneLabel = "No key",
  className,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  id?: string;
  allowNone?: boolean;
  noneLabel?: string;
  className?: string;
}) {
  return (
    <select
      id={id}
      value={canonicalKey(value) ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      className={cn(
        "h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {allowNone && <option value="">{noneLabel}</option>}
      <optgroup label="Major">
        {KEYS.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </optgroup>
      <optgroup label="Minor">
        {MINOR_KEYS.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </optgroup>
    </select>
  );
}

export function KeyBadge({ k, className }: { k: string | null; className?: string }) {
  if (!k) return null;
  return (
    <span
      className={cn(
        "inline-flex h-7 min-w-7 items-center justify-center rounded-lg bg-primary/15 px-2 text-xs font-bold text-primary",
        className,
      )}
    >
      {k}
    </span>
  );
}

/** Lyrics with chords above the words; `steps` transposes. */
export function ChordChart({
  lyrics,
  steps,
  targetKey,
  large,
}: {
  lyrics: string;
  steps: number;
  targetKey: string | null;
  large?: boolean;
}) {
  const lines = parseChart(lyrics, steps, targetKey);
  if (!lyrics.trim()) {
    return <p className="text-sm text-muted-foreground">No lyrics added yet.</p>;
  }
  return (
    <div className={cn("space-y-1 font-[family-name:var(--app-font-sans)]", large ? "text-2xl" : "text-base")}>
      {lines.map((line, i) => {
        if (line.kind === "blank") return <div key={i} className="h-4" />;
        if (line.kind === "label") {
          return (
            <p key={i} className="pt-3 text-xs font-semibold uppercase tracking-wider text-primary">
              {line.text}
            </p>
          );
        }
        return (
          <div key={i} className="flex flex-wrap items-end">
            {line.segments.map((seg, j) => (
              <span key={j} className="inline-flex flex-col whitespace-pre">
                {line.hasChords && (
                  <span className={cn("font-bold text-primary", large ? "text-xl" : "text-sm")}>
                    {seg.chord ? `${seg.chord} ` : " "}
                  </span>
                )}
                <span>{seg.text || (seg.chord ? " " : "")}</span>
              </span>
            ))}
          </div>
        );
      })}
    </div>
  );
}

const LYRICS_PLACEHOLDER = `[Verse 1]
[E]You are here, moving in our [B]midst
I [C#m]worship You, I [A]worship You

[Chorus]
Way [E]maker, miracle [B]worker`;

type OnlineResult = { title: string; artist: string; url: string; rating: number | null; votes: number };
type FoundSong = {
  title: string;
  artist: string | null;
  original_key: string | null;
  tempo_bpm: number | null;
  lyrics: string;
};

/**
 * "Find it online": search a song name (Ultimate Guitar) or paste a link to
 * any chord sheet, and the form fills itself in for checking.
 */
function FindOnline({ onFound }: { onFound: (song: FoundSong) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<OnlineResult[] | null>(null);
  const isLink = /^https?:\/\//i.test(query.trim());

  const fromUrl = useMutation({
    mutationFn: (url: string) => worshipPost<{ song: FoundSong; found_lyrics: boolean }>("/songs/from-url", { url }),
    onSuccess: (r) => {
      onFound(r.song);
      setResults(null);
      if (r.found_lyrics) toast.success("Filled in. Check the words and chords before saving.");
      else toast.message("Got the title, but no lyrics on that page. Paste them in below.");
    },
    onError: (err: Error) => toast.error(err.message),
  });
  const search = useMutation({
    mutationFn: () =>
      worshipFetch<{ results: OnlineResult[] }>(`/songs/search-online?q=${encodeURIComponent(query.trim())}`),
    onSuccess: (r) => {
      setResults(r.results);
      if (!r.results.length) toast.message("No chord sheets found. Try another spelling, or paste a link.");
    },
    onError: (err: Error) => toast.error(err.message),
  });
  const go = () => (isLink ? fromUrl.mutate(query.trim()) : search.mutate());
  const busy = fromUrl.isPending || search.isPending;

  return (
    <div className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
      <Label htmlFor="ws-find" className="flex items-center gap-1.5">
        <Globe className="h-4 w-4 text-primary" /> Find it online
      </Label>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (query.trim().length >= 2) go();
        }}
      >
        <Input
          id="ws-find"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Song name, or paste a link"
        />
        <Button type="submit" variant="outline" disabled={busy || query.trim().length < 2} className="shrink-0">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : isLink ? <Link2 className="h-4 w-4" /> : <Search className="h-4 w-4" />}
          <span className="ml-1.5">{isLink ? "Fill in" : "Search"}</span>
        </Button>
      </form>
      {results && results.length > 0 && (
        <ul className="max-h-56 divide-y divide-border overflow-y-auto rounded-lg border border-border bg-background">
          {results.map((r) => (
            <li key={r.url}>
              <button
                type="button"
                disabled={fromUrl.isPending}
                onClick={() => fromUrl.mutate(r.url)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{r.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">{r.artist}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {r.rating ? `★ ${r.rating} · ` : ""}
                  {r.votes} votes
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        Searches Ultimate Guitar. Links from other chord sites work too if they show the chords as text.
      </p>
    </div>
  );
}

/** Add a new song to the library (optionally to my list), or edit one. */
export function SongFormDialog({
  open,
  onOpenChange,
  song,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  song?: WorshipSong;
  onSaved?: (song: WorshipSong) => void;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [originalKey, setOriginalKey] = useState<string | null>(null);
  const [tempo, setTempo] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [myKey, setMyKey] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(song?.title ?? "");
    setArtist(song?.artist ?? "");
    setOriginalKey(song?.original_key ?? null);
    setTempo(song?.tempo_bpm ? String(song.tempo_bpm) : "");
    setLyrics(song?.lyrics ?? "");
    setMyKey(null);
  }, [open, song]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        title,
        artist,
        original_key: originalKey,
        tempo_bpm: tempo ? Number(tempo) : null,
        lyrics,
      };
      if (song) {
        return (await worshipPost<{ song: WorshipSong }>(`/songs/${song.id}`, payload, "PATCH")).song;
      }
      return (
        await worshipPost<{ song: WorshipSong }>("/songs", {
          ...payload,
          add_to_my_list: true,
          my_key: myKey ?? originalKey,
        })
      ).song;
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ["worship"] });
      toast.success(song ? "Song updated" : "Song added to your list. The team has been notified.");
      onOpenChange(false);
      onSaved?.(saved);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{song ? "Edit song" : "Add a song"}</DialogTitle>
          <DialogDescription>
            {song
              ? "Changes show for everyone who has this song."
              : "It goes into the team's song library and onto your list."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {!song && (
            <FindOnline
              onFound={(found) => {
                setTitle(found.title);
                setArtist(found.artist ?? "");
                setOriginalKey(found.original_key);
                setTempo(found.tempo_bpm ? String(found.tempo_bpm) : "");
                setLyrics(found.lyrics);
              }}
            />
          )}
          <div className="space-y-1.5">
            <Label htmlFor="ws-title">Title</Label>
            <Input id="ws-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Way Maker" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ws-artist">Artist (optional)</Label>
            <Input id="ws-artist" value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Sinach" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ws-key">Original key</Label>
              <KeySelect id="ws-key" value={originalKey} onChange={setOriginalKey} className="w-full" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ws-tempo">Tempo (BPM)</Label>
              <Input
                id="ws-tempo"
                inputMode="numeric"
                value={tempo}
                onChange={(e) => setTempo(e.target.value.replace(/\D/g, "").slice(0, 3))}
                placeholder="68"
              />
            </div>
          </div>
          {!song && (
            <div className="space-y-1.5">
              <Label htmlFor="ws-mykey">Your key</Label>
              <KeySelect
                id="ws-mykey"
                value={myKey ?? originalKey}
                onChange={setMyKey}
                className="w-full"
              />
              <p className="text-xs text-muted-foreground">The key you sing or play it in.</p>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="ws-lyrics">Lyrics & chords</Label>
            <Textarea
              id="ws-lyrics"
              rows={10}
              value={lyrics}
              onChange={(e) => setLyrics(e.target.value)}
              placeholder={LYRICS_PLACEHOLDER}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Put chords in square brackets right before the word, like <code>[G]Amazing [C]grace</code>.
              Section names like <code>[Chorus]</code> show as headings.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !title.trim()}>
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {song ? "Save changes" : "Add song"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
