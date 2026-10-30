import { useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Loader2, MessageCircle, MonitorPlay, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { PageBack } from "@/components/worship/PageBack";
import { setlistToFreeShowProject } from "@/lib/freeshow";
import { semitonesBetween, transposeLyrics } from "@/lib/worshipChords";
import type { WorshipSong } from "@/lib/worship";
import { KeyBadge } from "@/components/worship/songs";
import { SetlistEditor, type Setlist, type SetlistSong } from "@/components/worship/SetlistEditor";
import { worshipFetch, worshipPost } from "@/lib/worship";
import { buildSetlistMessage, formatServiceDate, shareOnWhatsApp } from "@/lib/worshipShare";

interface SetlistDetail {
  setlist: Setlist;
  songs: SetlistSong[];
  can_edit: boolean;
}

function SetlistPage({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ["worship", "setlist", id],
    queryFn: () => worshipFetch<SetlistDetail>(`/setlists/${id}`),
  });
  const del = useMutation({
    mutationFn: () => worshipPost(`/setlists/${id}`, undefined, "DELETE"),
    onSuccess: () => {
      toast.success("Setlist deleted");
      queryClient.invalidateQueries({ queryKey: ["worship"] });
      setLocation("/worship/setlists");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // A FreeShow project with every song in its setlist key (chords moved too).
  const toFreeShow = useMutation({
    mutationFn: async () => {
      if (!data) return;
      const full = await Promise.all(
        data.songs.map(async (s) => {
          const { song } = await worshipFetch<{ song: WorshipSong }>(`/songs/${s.song_id}`);
          const key = s.song_key ?? song.original_key;
          return {
            title: song.title,
            artist: song.artist,
            key,
            lyrics: transposeLyrics(song.lyrics, semitonesBetween(song.original_key, key), key),
          };
        }),
      );
      const name = `Setlist ${formatServiceDate(data.setlist.service_date)}${data.setlist.title ? ` · ${data.setlist.title}` : ""}`;
      const blob = new Blob([setlistToFreeShowProject(name, full)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${name.replace(/[\\/:*?"<>|]/g, "-")}.project`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    },
    onSuccess: () => toast.success("Downloaded. Open FreeShow → Import → FreeShow project."),
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) return <Skeleton className="h-80 rounded-2xl" />;
  if (error || !data) {
    return <p className="pt-12 text-center text-sm text-muted-foreground">{(error as Error)?.message ?? "Not found."}</p>;
  }
  const { setlist, songs } = data;
  const message = buildSetlistMessage(setlist, songs, `${window.location.origin}/worship/setlists/${setlist.id}`);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      toast.success("Setlist copied. Paste it anywhere.");
    } catch {
      toast.error("Couldn't copy on this device.");
    }
  };

  return (
    <div className="space-y-5">
      <PageBack fallback="/worship/setlists" />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-[family-name:var(--app-font-heading)] text-3xl font-semibold tracking-tight">
            {formatServiceDate(setlist.service_date)}
          </h1>
          {setlist.title && <p className="text-sm text-muted-foreground">{setlist.title}</p>}
        </div>
        {data.can_edit && (
          <div className="flex shrink-0 gap-1">
            <Button variant="ghost" size="icon" aria-label="Edit setlist" onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Delete setlist" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button className="flex-1" onClick={() => shareOnWhatsApp(message)}>
          <MessageCircle className="mr-2 h-4 w-4" /> Share to WhatsApp
        </Button>
        <Button className="flex-1" variant="outline" onClick={copy}>
          <Copy className="mr-2 h-4 w-4" /> Copy
        </Button>
      </div>
      <Button className="w-full" variant="outline" onClick={() => toFreeShow.mutate()} disabled={toFreeShow.isPending}>
        {toFreeShow.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MonitorPlay className="mr-2 h-4 w-4" />}
        Download for FreeShow
      </Button>
      <p className="-mt-3 text-xs text-muted-foreground">
        Every song in its setlist key, with chords. In FreeShow: <b>Import → FreeShow project</b>, then pick the
        downloaded file.
      </p>

      <ol className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
        {songs.map((s, i) => (
          <li key={s.song_id}>
            <Link href={`/worship/songs/${s.song_id}`} className="flex items-center gap-3 p-4 hover:bg-muted/50">
              <span className="w-5 shrink-0 text-center text-sm font-bold text-muted-foreground">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{s.title}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {[s.lead_name ? `Lead: ${s.lead_name}` : "No lead yet", s.artist, s.tempo_bpm ? `${s.tempo_bpm} BPM` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <KeyBadge k={s.song_key} className="h-10 min-w-10 text-sm" />
            </Link>
          </li>
        ))}
      </ol>

      {setlist.notes && (
        <div className="rounded-2xl border border-border bg-card p-4 text-sm">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Notes</p>
          <p className="whitespace-pre-wrap">{setlist.notes}</p>
        </div>
      )}

      {data.can_edit && (
        <SetlistEditor open={editing} onOpenChange={setEditing} existing={{ setlist, songs }} />
      )}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this setlist?</AlertDialogTitle>
            <AlertDialogDescription>The songs stay in the library; only this setlist is removed.</AlertDialogDescription>
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

export default function WorshipSetlist() {
  const { id } = useParams<{ id: string }>();
  return <WorshipGate>{() => <SetlistPage id={id} />}</WorshipGate>;
}
