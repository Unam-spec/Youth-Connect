import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileUp, FolderOpen, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { worshipPost } from "@/lib/worship";
import { parseFreeShowShow, type ImportableSong } from "@/lib/freeshow";

/**
 * Head leader / leaders: pick FreeShow's Shows folder (or some .show files)
 * on this computer and add every song to the library, on nobody's list.
 * Files are read here in the browser; only the songs are sent.
 */
export function FreeShowImport({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const queryClient = useQueryClient();
  const folderInput = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const [songs, setSongs] = useState<ImportableSong[] | null>(null);
  const [notSongs, setNotSongs] = useState(0);
  const [reading, setReading] = useState(false);

  const read = async (list: FileList | null) => {
    if (!list?.length) return;
    setReading(true);
    const files = Array.from(list).filter((f) => f.name.toLowerCase().endsWith(".show"));
    const found: ImportableSong[] = [];
    let skipped = 0;
    for (const f of files) {
      const song = parseFreeShowShow(await f.text(), f.name);
      if (song) found.push(song);
      else skipped++;
    }
    found.sort((a, b) => a.title.localeCompare(b.title));
    setSongs(found);
    setNotSongs(skipped);
    setReading(false);
    if (!files.length) toast.error("No FreeShow songs (.show files) in what you picked.");
  };

  const upload = useMutation({
    mutationFn: async () => {
      let added = 0;
      let skipped = 0;
      for (let i = 0; i < (songs?.length ?? 0); i += 500) {
        const r = await worshipPost<{ added: number; skipped: number; invalid: number }>("/songs/import", {
          songs: songs!.slice(i, i + 500),
        });
        added += r.added;
        skipped += r.skipped + r.invalid;
      }
      return { added, skipped };
    },
    onSuccess: ({ added, skipped }) => {
      queryClient.invalidateQueries({ queryKey: ["worship"] });
      toast.success(
        `Added ${added} song${added === 1 ? "" : "s"} to the library` +
          (skipped ? ` · ${skipped} already there or couldn't be read` : ""),
      );
      setSongs(null);
      onOpenChange(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setSongs(null);
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import songs from FreeShow</DialogTitle>
          <DialogDescription>
            Do this on the computer that runs FreeShow. The songs go into the library without being on anyone's list,
            so each person can add the ones they play in their own key.
          </DialogDescription>
        </DialogHeader>

        {!songs ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-border bg-muted/40 p-3 text-sm">
              <p className="font-medium">Where are FreeShow's songs?</p>
              <p className="mt-1 text-muted-foreground">
                Usually <b>Documents → FreeShow → Shows</b>. In FreeShow you can check under{" "}
                <b>Settings → Files → Data location</b>.
              </p>
            </div>
            <Button className="w-full" onClick={() => folderInput.current?.click()} disabled={reading}>
              {reading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FolderOpen className="mr-2 h-4 w-4" />}
              Choose the Shows folder
            </Button>
            <Button variant="outline" className="w-full" onClick={() => filesInput.current?.click()} disabled={reading}>
              <FileUp className="mr-2 h-4 w-4" /> Or pick .show files
            </Button>
            <input
              ref={folderInput}
              type="file"
              className="hidden"
              // Lets the person pick a whole folder (Chrome, Edge, Safari, Firefox).
              {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
              multiple
              onChange={(e) => read(e.target.files)}
            />
            <input
              ref={filesInput}
              type="file"
              className="hidden"
              accept=".show"
              multiple
              onChange={(e) => read(e.target.files)}
            />
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm">
              Found <b>{songs.length}</b> song{songs.length === 1 ? "" : "s"}
              {notSongs ? ` (skipped ${notSongs} that aren't songs, like Bible verses)` : ""}. Songs already in the
              library will be skipped.
            </p>
            <ul className="max-h-60 divide-y divide-border overflow-y-auto rounded-lg border border-border text-sm">
              {songs.map((s, i) => (
                <li key={`${s.title}-${i}`} className="flex justify-between gap-2 px-3 py-2">
                  <span className="truncate">{s.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {[s.artist, s.original_key].filter(Boolean).join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {songs && (
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setSongs(null)}>
              Pick again
            </Button>
            <Button onClick={() => upload.mutate()} disabled={upload.isPending || songs.length === 0}>
              {upload.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add {songs.length} song{songs.length === 1 ? "" : "s"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
