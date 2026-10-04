import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Loader2, X } from "lucide-react";
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
        <div className="space-y-4">
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
            <select
              aria-label="Add a song"
              className={cn(selectClass, "w-full")}
              value=""
              onChange={(e) => {
                const song = available.find((s) => s.id === e.target.value);
                if (song) setRows((r) => [...r, { song_id: song.id, title: song.title, lead_id: null, song_key: null }]);
              }}
            >
              <option value="">{library.isLoading ? "Loading songs…" : "＋ Add a song from the library"}</option>
              {available.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                  {s.artist ? ` · ${s.artist}` : ""}
                </option>
              ))}
            </select>
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
