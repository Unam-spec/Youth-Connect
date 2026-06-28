import { useQuery } from "@tanstack/react-query";
import { Cake } from "lucide-react";
import { useApiFetch } from "@/lib/api";
import { DashCard, SectionTitle, EmptyState } from "./shared";

interface BirthdayEntry {
  id: string;
  full_name: string;
  avatar_url: string | null;
  date_of_birth: string;
  age_turning: number | null;
}
interface BirthdayData {
  today: BirthdayEntry[];
  this_week: BirthdayEntry[];
}

function Avatar({ entry }: { entry: BirthdayEntry }) {
  const url = entry.avatar_url;
  const initials =
    entry.full_name?.split(" ").map((n) => n[0]).join("").substring(0, 2).toUpperCase() || "?";
  return (
    <div className="h-10 w-10 rounded-full overflow-hidden flex items-center justify-center shrink-0 text-sm font-bold border bg-muted text-foreground border-border">
      {url ? (
        url.startsWith("gradient:") ? (
          <div className="h-full w-full" style={{ background: url.replace("gradient:", "") }} />
        ) : (
          <img src={url} alt={entry.full_name} className="h-full w-full object-cover" />
        )
      ) : (
        initials
      )}
    </div>
  );
}

function Row({ entry }: { entry: BirthdayEntry }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5">
      <Avatar entry={entry} />
      <div className="min-w-0">
        <p className="font-semibold text-sm leading-tight truncate">{entry.full_name}</p>
        {entry.age_turning !== null && (
          <p className="text-xs text-muted-foreground">turning {entry.age_turning}</p>
        )}
      </div>
    </div>
  );
}

export function BirthdaysPanel() {
  const apiFetch = useApiFetch();
  const { data, isLoading, isError } = useQuery<BirthdayData>({
    queryKey: ["birthdays"],
    queryFn: async () => {
      const res = await apiFetch("/api/birthdays");
      if (!res.ok) throw new Error("Failed to load birthdays");
      return (await res.json()) as BirthdayData;
    },
  });

  const today = data?.today ?? [];
  const thisWeek = data?.this_week ?? [];

  return (
    <DashCard>
      <SectionTitle title="Birthdays" icon={<Cake className="h-4 w-4 text-primary" />} />
      {isLoading ? (
        <p className="text-sm text-muted-foreground py-2">Loading…</p>
      ) : isError ? (
        <p className="text-sm text-destructive py-2">Could not load birthdays.</p>
      ) : today.length === 0 && thisWeek.length === 0 ? (
        <EmptyState text="No birthdays this week." />
      ) : (
        <div className="space-y-5">
          {today.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-primary mb-2">🎂 Today</p>
              <div className="space-y-2">
                {today.map((e) => <Row key={e.id} entry={e} />)}
              </div>
            </div>
          )}
          {thisWeek.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">This week</p>
              <div className="space-y-2">
                {thisWeek.map((e) => <Row key={e.id} entry={e} />)}
              </div>
            </div>
          )}
        </div>
      )}
    </DashCard>
  );
}
