import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Check, Maximize2, Minimize2, Minus, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { WorshipGate } from "@/components/worship/WorshipGate";
import { ChordChart, KeyBadge, KeySelect, SongFormDialog } from "@/components/worship/songs";
import { cn } from "@/lib/utils";
import { worshipFetch, worshipKeys, worshipPost, type WorshipAccount, type WorshipSong } from "@/lib/worship";
import { semitonesBetween, transposeKey } from "@/lib/worshipChords";

interface SongDetail {
  song: WorshipSong;
  members: { id: string; full_name: string; preferred_key: string | null; notes: string | null }[];
  my_entry: { preferred_key: string | null; notes: string | null } | null;
  can_edit: boolean;
}

function MyEntry({ data }: { data: SongDetail }) {
  const queryClient = useQueryClient();
  const { song, my_entry } = data;
  const [key, setKey] = useState<string | null>(my_entry?.preferred_key ?? song.original_key);
  const [notes, setNotes] = useState(my_entry?.notes ?? "");
  useEffect(() => {
    setKey(my_entry?.preferred_key ?? song.original_key);
    setNotes(my_entry?.notes ?? "");
  }, [my_entry, song.original_key]);

  const save = useMutation({
    mutationFn: () => worshipPost<{ added: boolean }>(`/me/songs/${song.id}`, { preferred_key: key, notes }, "PUT"),
    onSuccess: (r) => {
      toast.success(r.added ? "Added to your list. The team has been notified." : "Saved");
      queryClient.invalidateQueries({ queryKey: ["worship"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });
  const remove = useMutation({
    mutationFn: () => worshipPost(`/me/songs/${song.id}`, undefined, "DELETE"),
    onSuccess: () => {
      toast.success("Removed from your list");
      queryClient.invalidateQueries({ queryKey: ["worship"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <p className="text-sm font-semibold">{my_entry ? "On your list" : "Add to your list"}</p>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="my-key" className="text-xs text-muted-foreground">
          Your key
        </label>
        <KeySelect id="my-key" value={key} onChange={setKey} />
        <Input
          className="min-w-40 flex-1"
          placeholder="Notes (optional), e.g. capo 2"
          maxLength={300}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
          {my_entry ? <Check className="mr-1.5 h-4 w-4" /> : <Plus className="mr-1.5 h-4 w-4" />}
          {my_entry ? "Save" : "Add to my list"}
        </Button>
        {my_entry && (
          <Button size="sm" variant="ghost" onClick={() => remove.mutate()} disabled={remove.isPending}>
            Remove from my list
          </Button>
        )}
      </div>
    </div>
  );
}

function SongPage({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const { data, isLoading, error } = useQuery({
    queryKey: worshipKeys.song(id),
    queryFn: () => worshipFetch<SongDetail>(`/songs/${id}`),
  });
  const [viewKey, setViewKey] = useState<string | null>(null);
  const [stage, setStage] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Open in the viewer's own key when they have one, else the original.
  useEffect(() => {
    if (data) setViewKey(data.my_entry?.preferred_key ?? data.song.original_key);
  }, [data?.song.id, data?.my_entry?.preferred_key, data?.song.original_key]); // eslint-disable-line react-hooks/exhaustive-deps

  const del = useMutation({
    mutationFn: () => worshipPost(`/songs/${id}`, undefined, "DELETE"),
    onSuccess: () => {
      toast.success("Song deleted");
      queryClient.invalidateQueries({ queryKey: ["worship"] });
      setLocation("/worship/library");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) return <Skeleton className="h-96 rounded-2xl" />;
  if (error || !data) {
    return <p className="pt-12 text-center text-sm text-muted-foreground">{(error as Error)?.message ?? "Not found."}</p>;
  }
  const { song } = data;
  const steps = semitonesBetween(song.original_key, viewKey);
  const nudge = (n: number) => setViewKey((k) => transposeKey(k ?? song.original_key ?? "C", n));

  const chart = (
    <ChordChart lyrics={song.lyrics} steps={steps} targetKey={viewKey} large={stage} />
  );

  const keyControls = (
    <div className="flex items-center gap-1.5">
      <Button variant="outline" size="icon" className="h-9 w-9" aria-label="Key down" onClick={() => nudge(-1)} disabled={!song.original_key}>
        <Minus className="h-4 w-4" />
      </Button>
      <KeySelect value={viewKey} onChange={setViewKey} allowNone={false} className="h-9" />
      <Button variant="outline" size="icon" className="h-9 w-9" aria-label="Key up" onClick={() => nudge(1)} disabled={!song.original_key}>
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  );

  if (stage) {
    return (
      <div className="fixed inset-0 z-50 overflow-y-auto bg-background px-5 py-4">
        <div className="sticky top-0 -mx-5 mb-4 flex items-center justify-between gap-2 bg-background/95 px-5 py-2 backdrop-blur">
          <p className="truncate font-semibold">{song.title}</p>
          <div className="flex items-center gap-2">
            {song.original_key && keyControls}
            <Button variant="ghost" size="icon" aria-label="Exit stage mode" onClick={() => setStage(false)}>
              <Minimize2 className="h-5 w-5" />
            </Button>
          </div>
        </div>
        {chart}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Link href="/worship/library" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Songs
      </Link>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-[family-name:var(--app-font-heading)] text-3xl font-semibold tracking-tight">{song.title}</h1>
          <p className="text-sm text-muted-foreground">
            {[song.artist, song.original_key ? `Original key ${song.original_key}` : null, song.tempo_bpm ? `${song.tempo_bpm} BPM` : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        {data.can_edit && (
          <div className="flex shrink-0 gap-1">
            <Button variant="ghost" size="icon" aria-label="Edit song" onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Delete song" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      <MyEntry data={data} />

      {data.members.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="mb-2 text-sm font-semibold">Who plays this</p>
          <div className="flex flex-wrap gap-2">
            {data.members.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => m.preferred_key && setViewKey(m.preferred_key)}
                className={cn(
                  "flex items-center gap-2 rounded-full border border-border py-1 pl-3 pr-1 text-sm hover:border-primary/40",
                  m.preferred_key === viewKey && "border-primary/50",
                )}
                title={m.preferred_key ? `View in ${m.full_name}'s key` : undefined}
              >
                {m.full_name}
                <KeyBadge k={m.preferred_key} className="h-6 min-w-6" />
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          {song.original_key ? keyControls : <span className="text-xs text-muted-foreground">Add an original key to transpose.</span>}
          <Button variant="outline" size="sm" onClick={() => setStage(true)}>
            <Maximize2 className="mr-1.5 h-4 w-4" /> Stage mode
          </Button>
        </div>
        {chart}
      </div>

      <SongFormDialog open={editing} onOpenChange={setEditing} song={song} />
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{song.title}"?</AlertDialogTitle>
            <AlertDialogDescription>
              It will be removed from the library and from everyone's song list.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => del.mutate()}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function WorshipSongPage() {
  const { id } = useParams<{ id: string }>();
  return <WorshipGate>{(_me: WorshipAccount) => <SongPage id={id} />}</WorshipGate>;
}
