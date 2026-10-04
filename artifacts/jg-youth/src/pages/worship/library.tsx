import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Music2, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { WorshipGate } from "@/components/worship/WorshipGate";
import { KeyBadge, SongFormDialog } from "@/components/worship/songs";
import { useDebouncedValue } from "@/lib/useDebounce";
import { worshipFetch, worshipKeys, worshipPost, type LibrarySong } from "@/lib/worship";

function LibraryPage() {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const q = useDebouncedValue(search.trim(), 250);
  const { data, isLoading } = useQuery({
    queryKey: worshipKeys.songs(q),
    queryFn: () => worshipFetch<{ songs: LibrarySong[] }>(`/songs${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  });
  const addToMine = useMutation({
    mutationFn: (s: LibrarySong) => worshipPost(`/me/songs/${s.id}`, { preferred_key: s.original_key }, "PUT"),
    onSuccess: () => {
      toast.success("Added to your list. The team has been notified.");
      queryClient.invalidateQueries({ queryKey: ["worship"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-[family-name:var(--app-font-heading)] text-2xl font-semibold tracking-tight">Song library</h1>
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> New song
        </Button>
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search songs or artists" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 rounded-2xl" />
          ))}
        </div>
      ) : !data?.songs.length ? (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center">
          <Music2 className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {q ? "No songs match that search." : "The library is empty. Add the first song!"}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {data.songs.map((s) => (
            <div key={s.id} className="flex items-center gap-3 p-3">
              <Link href={`/worship/songs/${s.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                <KeyBadge k={s.original_key} className="h-10 min-w-10 bg-muted text-sm text-foreground" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{s.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[s.artist, `${s.member_count} on the team`].filter(Boolean).join(" · ")}
                  </p>
                </div>
              </Link>
              {s.in_my_list ? (
                <span className="flex shrink-0 items-center gap-1.5 text-xs text-primary">
                  <Check className="h-4 w-4" />
                  {s.my_key ? `Yours in ${s.my_key}` : "On your list"}
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  disabled={addToMine.isPending}
                  onClick={() => addToMine.mutate(s)}
                >
                  <Plus className="mr-1 h-4 w-4" /> Add
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
      <SongFormDialog open={adding} onOpenChange={setAdding} onSaved={(song) => setLocation(`/worship/songs/${song.id}`)} />
    </div>
  );
}

export default function WorshipLibrary() {
  return <WorshipGate>{() => <LibraryPage />}</WorshipGate>;
}
