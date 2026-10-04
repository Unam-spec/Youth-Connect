import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { WorshipGate } from "@/components/worship/WorshipGate";
import { SetlistEditor } from "@/components/worship/SetlistEditor";
import { canApprove, worshipFetch, type WorshipAccount } from "@/lib/worship";
import { formatServiceDate } from "@/lib/worshipShare";
import { cn } from "@/lib/utils";

interface SetlistSummary {
  id: string;
  service_date: string;
  title: string | null;
  song_count: number;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function SetlistsPage({ me }: { me: WorshipAccount }) {
  const [, setLocation] = useLocation();
  const [creating, setCreating] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["worship", "setlists"],
    queryFn: () => worshipFetch<{ setlists: SetlistSummary[] }>("/setlists"),
  });
  const today = todayIso();
  const upcoming = (data?.setlists ?? []).filter((s) => s.service_date >= today).reverse();
  const past = (data?.setlists ?? []).filter((s) => s.service_date < today);

  const list = (items: SetlistSummary[], muted = false) => (
    <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
      {items.map((s) => (
        <Link key={s.id} href={`/worship/setlists/${s.id}`} className="flex items-center gap-3 p-4 hover:bg-muted/50">
          <span
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
              muted ? "bg-muted text-muted-foreground" : "bg-primary/15 text-primary",
            )}
          >
            <CalendarDays className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{formatServiceDate(s.service_date)}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {[s.title, `${s.song_count} song${s.song_count === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
            </span>
          </span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Link>
      ))}
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-[family-name:var(--app-font-heading)] text-2xl font-semibold tracking-tight">Setlists</h1>
        {canApprove(me) && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> New setlist
          </Button>
        )}
      </div>

      {isLoading ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : !data?.setlists.length ? (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center">
          <CalendarDays className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {canApprove(me) ? "No setlists yet. Post this Sunday's!" : "No setlists yet. Your leaders will post them here."}
          </p>
        </div>
      ) : (
        <>
          {upcoming.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Coming up</h2>
              {list(upcoming)}
            </section>
          )}
          {past.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Past</h2>
              {list(past, true)}
            </section>
          )}
        </>
      )}
      <SetlistEditor open={creating} onOpenChange={setCreating} onSaved={(id) => setLocation(`/worship/setlists/${id}`)} />
    </div>
  );
}

export default function WorshipSetlists() {
  return <WorshipGate>{(me) => <SetlistsPage me={me} />}</WorshipGate>;
}
