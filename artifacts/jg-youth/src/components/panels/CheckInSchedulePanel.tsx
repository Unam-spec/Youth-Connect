import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { useApiFetch } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { DashCard, SectionTitle } from "./shared";

interface ScheduleWindow {
  day_of_week: number;
  start_time: string;
  end_time: string;
  enabled: boolean;
}

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function CheckInSchedulePanel() {
  const apiFetch = useApiFetch();
  const { toast } = useToast();
  const [restrict, setRestrict] = useState(true);
  const [windows, setWindows] = useState<ScheduleWindow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/checkin/schedule");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setRestrict(data.restrict_to_schedule !== false);
          setWindows(
            (data.windows ?? []).map((w: ScheduleWindow) => ({
              ...w,
              start_time: w.start_time || "18:30",
              end_time: w.end_time || "22:00",
            })),
          );
        }
      } catch {
        if (!cancelled) {
          toast({
            title: "Couldn't load schedule",
            description: "Please refresh to try again.",
            variant: "destructive",
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function updateDay(day: number, patch: Partial<ScheduleWindow>) {
    setWindows((prev) => prev.map((w) => (w.day_of_week === day ? { ...w, ...patch } : w)));
  }

  async function handleSave() {
    for (const w of windows) {
      if (w.enabled && w.start_time >= w.end_time) {
        toast({
          title: "Invalid times",
          description: `${DAY_LABELS[w.day_of_week]}: start must be before end.`,
          variant: "destructive",
        });
        return;
      }
    }
    setSaving(true);
    try {
      const res = await apiFetch("/api/checkin/schedule", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restrict_to_schedule: restrict, windows }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast({ title: "Save failed", description: data.error ?? "Please try again.", variant: "destructive" });
        return;
      }
      toast({ title: "Schedule saved", description: "Check-in times updated." });
    } catch {
      toast({ title: "Save failed", description: "Network error.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <DashCard>
      <SectionTitle title="Check-In Schedule" icon={<Clock className="h-4 w-4 text-primary" />} />
      {loading ? (
        <p className="text-sm text-muted-foreground py-4">Loading…</p>
      ) : (
        <div className="space-y-4">
          <label className="flex items-center gap-3 text-sm font-medium">
            <input
              type="checkbox"
              checked={restrict}
              onChange={(e) => setRestrict(e.target.checked)}
              className="h-4 w-4"
            />
            Restrict check-in to scheduled times
            <span className="text-xs text-muted-foreground">(off = always open)</span>
          </label>

          <div className={`space-y-2 ${restrict ? "" : "opacity-50 pointer-events-none"}`}>
            {windows.map((w) => (
              <div key={w.day_of_week} className="flex items-center gap-3 text-sm">
                <label className="flex items-center gap-2 w-32">
                  <input
                    type="checkbox"
                    checked={w.enabled}
                    onChange={(e) => updateDay(w.day_of_week, { enabled: e.target.checked })}
                    className="h-4 w-4"
                  />
                  {DAY_LABELS[w.day_of_week]}
                </label>
                <input
                  type="time"
                  value={w.start_time}
                  disabled={!w.enabled}
                  onChange={(e) => updateDay(w.day_of_week, { start_time: e.target.value })}
                  className="h-9 rounded-md border border-input bg-background px-2 disabled:opacity-50"
                />
                <span className="text-muted-foreground">to</span>
                <input
                  type="time"
                  value={w.end_time}
                  disabled={!w.enabled}
                  onChange={(e) => updateDay(w.day_of_week, { end_time: e.target.value })}
                  className="h-9 rounded-md border border-input bg-background px-2 disabled:opacity-50"
                />
              </div>
            ))}
          </div>

          <Button onClick={handleSave} disabled={saving} className="rounded-xl">
            {saving ? "Saving…" : "Save Schedule"}
          </Button>
        </div>
      )}
    </DashCard>
  );
}
