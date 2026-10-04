import { useState } from "react";
import { Link, useParams } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Crown, Library, Music2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { WorshipGate } from "@/components/worship/WorshipGate";
import { KeyBadge, SongFormDialog } from "@/components/worship/songs";
import {
  initials,
  instrumentLabel,
  worshipFetch,
  worshipKeys,
  worshipPost,
  type MemberSong,
  type WorshipAccount,
} from "@/lib/worship";

function MemberPage({ me, id }: { me: WorshipAccount; id: string }) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const isMe = me.id === id;
  const { data, isLoading, error } = useQuery({
    queryKey: worshipKeys.member(id),
    queryFn: () => worshipFetch<{ member: WorshipAccount; songs: MemberSong[] }>(`/members/${id}`),
  });
  const removeSong = useMutation({
    mutationFn: (songId: string) => worshipPost(`/me/songs/${songId}`, undefined, "DELETE"),
    onSuccess: () => {
      toast.success("Removed from your list");
      queryClient.invalidateQueries({ queryKey: ["worship"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) return <Skeleton className="h-64 rounded-2xl" />;
  if (error || !data) {
    return <p className="pt-12 text-center text-sm text-muted-foreground">{(error as Error)?.message ?? "Not found."}</p>;
  }
  const { member, songs } = data;

  return (
    <div className="space-y-6">
      <section className="flex items-start gap-4 rounded-2xl border border-border bg-card p-5">
        <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary/15 text-lg font-semibold text-primary">
          {initials(member.full_name)}
        </span>
        <div className="min-w-0 space-y-1">
          <h1 className="font-[family-name:var(--app-font-heading)] text-2xl font-semibold tracking-tight">
            {member.full_name}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {member.role === "leader" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 font-semibold text-primary">
                <Crown className="h-3 w-3" /> Leader
              </span>
            )}
            {member.instruments.map((i) => (
              <span key={i} className="rounded-full border border-border px-2 py-0.5">
                {instrumentLabel(i)}
              </span>
            ))}
            {member.vocal_range && <span>Range: {member.vocal_range}</span>}
          </div>
          {member.bio && <p className="pt-1 text-sm text-muted-foreground">{member.bio}</p>}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="font-[family-name:var(--app-font-heading)] text-xl font-semibold tracking-tight">
            {isMe ? "My songs" : `${member.full_name.split(" ")[0]}'s songs`}
          </h2>
          {isMe && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" asChild>
                <Link href="/worship/library">
                  <Library className="mr-1.5 h-4 w-4" /> From library
                </Link>
              </Button>
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus className="mr-1.5 h-4 w-4" /> New song
              </Button>
            </div>
          )}
        </div>

        {songs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center">
            <Music2 className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {isMe ? "No songs yet. Add a new one, or pick from the team's library." : "No songs yet."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {songs.map((s) => (
              <div key={s.song_id} className="flex items-center gap-3 p-3">
                <Link href={`/worship/songs/${s.song_id}`} className="flex min-w-0 flex-1 items-center gap-3">
                  <KeyBadge k={s.preferred_key ?? s.original_key} className="h-10 min-w-10 text-sm" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{s.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[s.artist, s.tempo_bpm ? `${s.tempo_bpm} BPM` : null, s.notes].filter(Boolean).join(" · ") ||
                        " "}
                    </p>
                  </div>
                </Link>
                {isMe && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground"
                    aria-label={`Remove ${s.title} from my list`}
                    onClick={() => removeSong.mutate(s.song_id)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
      {isMe && <SongFormDialog open={adding} onOpenChange={setAdding} />}
    </div>
  );
}

export default function WorshipMember() {
  const { id } = useParams<{ id: string }>();
  return <WorshipGate>{(me) => <MemberPage me={me} id={id} />}</WorshipGate>;
}
