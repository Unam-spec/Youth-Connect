import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Loader2, Plus, Search, X } from "lucide-react";
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
import { worshipFetch, worshipKeys, worshipPost, type LibrarySong, type WorshipAccount } from "@/lib/worship";
import { nextSunday } from "@/lib/worshipShare";
import { KeySelect } from "./songs";

export interface SetlistSong {
  song_id: string;
  title: string;
  artist: string | null;
  original_key: string | null;
  tempo_bpm: number | null;
  song_key: string | null;
  lead_id: string | null;
  lead_name: string | null;
}

export interface Setlist {
  id: string;
  service_date: string;
  title: string | null;
  notes: string | null;
}

type Row = { song_id: string; title: string; lead_id: string | null; song_key: string | null };

const selectClass =
  "h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Lowercase, no accents or punctuation, so "se my" finds "Sê my hoe" and "hadnt" finds "hadn't". */
function searchable(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’`]/g, "")
    .toLowerCase();
}

/** Search the library and tap songs to add them. Stays open to add several in a row. */
function AddSongPicker({
  songs,
  loading,
  onAdd,
}: {
  songs: LibrarySong[];
  loading: boolean;
  onAdd: (song: LibrarySong) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [search, setSearch] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const words = searchable(search).split(/\s+/).filter(Boolean);
  const matches = songs.filter((s) => {
    const text = searchable(`${s.title} ${s.artist ?? ""}`);
    return words.every((w) => text.includes(w));
  });
  const add = (song: LibrarySong) => {
    onAdd(song);
    setSearch("");
    input.current?.focus();
  };

  if (!picking) {
    return (
      <Button variant="outline" className="w-full" disabled={loading} onClick={() => setPicking(true)}>
        {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
        {loading ? "Loading songs…" : "Add a song"}
      </Button>
    );
  }
  return (
    <div className="space-y-2 rounded-xl border border-border bg-card p-3">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={input}
            autoFocus
            aria-label="Search songs"
            className="pl-9"
            placeholder="Search songs or artists"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && search.trim() && matches[0]) {
                e.preventDefault();
                add(matches[0]);
              }
            }}
          />
        </div>
        <Button variant="ghost" size="sm" className="shrink-0" onClick={() => setPicking(false)}>
          Done
        </Button>
      </div>
      {matches.length === 0 ? (
        <p className="py-3 text-center text-sm text-muted-foreground">
          {search.trim() ? "No songs match that search." : "Every song is already on this setlist."}
        </p>
      ) : (
        <div className="max-h-56 divide-y divide-border overflow-y-auto rounded-lg border border-border">
          {matches.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => add(s)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-muted/50"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{s.title}</span>
                {s.artist && <span className="block truncate text-xs text-muted-foreground">{s.artist}</span>}
              </span>
              {s.original_key && <span className="shrink-0 text-xs text-muted-foreground">{s.original_key}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Create or edit a Sunday setlist (head leader + leaders). */
export function SetlistEditor({
  open,
  onOpenChange,
  existing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  existing?: { setlist: Setlist; songs: SetlistSong[] };
  onSaved?: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [date, setDate] = useState(nextSunday());
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<Row[]>([]);

  const library = useQuery({
    queryKey: worshipKeys.songs(""),
    queryFn: () => worshipFetch<{ songs: LibrarySong[] }>("/songs"),
    enabled: open,
  });
  const members = useQuery({
    queryKey: worshipKeys.members,
    queryFn: () => worshipFetch<{ members: WorshipAccount[] }>("/members"),
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    setDate(existing?.setlist.service_date ?? nextSunday());
    setTitle(existing?.setlist.title ?? "");
    setNotes(existing?.setlist.notes ?? "");
    setRows(
      existing?.songs.map((s) => ({
        song_id: s.song_id,
        title: s.title,
        lead_id: s.lead_id,
        song_key: s.song_key,
      })) ?? [],
    );
  }, [open, existing]);

  const update = (i: number, patch: Partial<Row>) =>
    setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  const move = (i: number, by: number) =>
    setRows((r) => {
      const next = [...r];
      const [row] = next.splice(i, 1);
      next.splice(i + by, 0, row);
      return next;
    });

  const available = (library.data?.songs ?? []).filter((s) => !rows.some((r) => r.song_id === s.id));

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        service_date: date,
        title,
        notes,
        songs: rows.map((r) => ({ song_id: r.song_id, lead_id: r.lead_id, song_key: r.song_key })),
      };
      if (existing) {
        return (
          await worshipPost<{ setlist: Setlist }>(`/setlists/${existing.setlist.id}`, payload, "PUT")
        ).setlist;
      }
      return (await worshipPost<{ setlist: Setlist }>("/setlists", payload)).setlist;
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ["worship"] });
      toast.success(existing ? "Setlist updated" : "Setlist posted. The team has been notified.");
      onOpenChange(false);
      onSaved?.(saved.id);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit setlist" : "New setlist"}</DialogTitle>
          <DialogDescription>
            Leave a key on "Lead's key" to use the key that person sings it in.
          </DialogDescription>
        </DialogHeader>
        <div className="min-w-0 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="sl-date">Date</Label>
              <Input id="sl-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sl-title">Title (optional)</Label>
              <Input id="sl-title" placeholder="Youth Sunday" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Songs</Label>
            {rows.length === 0 && (
              <p className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                Add songs below, in the order you'll play them.
              </p>
            )}
            {rows.map((row, i) => (
              <div key={row.song_id} className="space-y-2 rounded-xl border border-border bg-card p-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
                    {i + 1}
                  </span>
                  <p className="min-w-0 flex-1 truncate text-sm font-semibold">{row.title}</p>
                  <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Move down" disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Remove ${row.title}`} onClick={() => setRows((r) => r.filter((_, j) => j !== i))}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    aria-label={`Who leads ${row.title}`}
                    className={selectClass}
                    value={row.lead_id ?? ""}
                    onChange={(e) => update(i, { lead_id: e.target.value || null })}
                  >
                    <option value="">No lead yet</option>
                    {members.data?.members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.full_name}
                      </option>
                    ))}
                  </select>
                  <KeySelect
                    value={row.song_key}
                    onChange={(k) => update(i, { song_key: k })}
                    noneLabel="Lead's key"
                    className="w-full"
                  />
                </div>
              </div>
            ))}
            <AddSongPicker
              songs={available}
              loading={library.isLoading}
              onAdd={(song) =>
                setRows((r) => [...r, { song_id: song.id, title: song.title, lead_id: null, song_key: null }])
              }
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sl-notes">Notes (optional)</Label>
            <Textarea
              id="sl-notes"
              rows={2}
              maxLength={500}
              placeholder="e.g. Sound check 8:30, wear black"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => save.mutate()} disabled={save.isPending || rows.length === 0 || !date}>
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {existing ? "Save changes" : "Post setlist"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
