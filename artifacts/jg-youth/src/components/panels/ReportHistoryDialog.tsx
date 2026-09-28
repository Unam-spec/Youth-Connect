import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { Download, FileSpreadsheet } from "lucide-react";
import { useApiFetch } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

interface ReportWeek {
  week_start: string;
  week_end: string;
  total_checkins: number;
  members: number;
  visitors: number;
  session_dates: string[];
  is_current: boolean;
}

/**
 * Weekly report history. One report per Mon–Sun week; every week with
 * attendance stays listed and downloadable, rebuilt from stored data on
 * demand so past reports never disappear.
 */
export function ReportHistoryDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const apiFetch = useApiFetch();
  const { toast } = useToast();
  const [weeks, setWeeks] = useState<ReportWeek[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadError(false);
    apiFetch("/api/dashboard/report-weeks")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load");
        return res.json() as Promise<{ weeks: ReportWeek[] }>;
      })
      .then((data) => { if (!cancelled) setWeeks(data.weeks); })
      .catch(() => { if (!cancelled) setLoadError(true); });
    return () => { cancelled = true; };
    // apiFetch is recreated each render; only refetch when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleDownload = async (week: ReportWeek) => {
    setDownloading(week.week_start);
    try {
      const res = await apiFetch(`/api/dashboard/export?week=${week.week_start}`);
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="?([^"]+)"?/i);
      a.download = match?.[1] ?? `JG-Youth-Report-Week-of-${week.week_start}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: "Report downloaded" });
    } catch {
      toast({
        title: "Export failed",
        description: "Could not generate the report. Please try again.",
        variant: "destructive",
      });
    } finally {
      setDownloading(null);
    }
  };

  const fmtDay = (d: string) => format(parseISO(d), "EEE d MMM");
  const fmtRange = (w: ReportWeek) =>
    `${format(parseISO(w.week_start), "d MMM")} – ${format(parseISO(w.week_end), "d MMM yyyy")}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            Weekly Reports
          </DialogTitle>
          <DialogDescription>
            One report per week (Mon–Sun). Past weeks stay here, so you can
            download any week's report at any time.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto -mx-1 px-1 space-y-2">
          {loadError ? (
            <p className="text-sm text-destructive py-6 text-center">
              Could not load report history. Please try again.
            </p>
          ) : weeks === null ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))
          ) : (
            weeks.map((w) => (
              <div
                key={w.week_start}
                className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm text-foreground">
                      {fmtRange(w)}
                    </span>
                    {w.is_current && (
                      <Badge variant="secondary" className="text-[10px]">
                        This week
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {w.total_checkins} check-ins · {w.members} members · {w.visitors} visitors
                  </p>
                  {w.session_dates.length > 0 && (
                    <p className="text-xs text-muted-foreground truncate">
                      Sessions: {w.session_dates.map(fmtDay).join(", ")}
                    </p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  disabled={downloading !== null}
                  onClick={() => handleDownload(w)}
                >
                  <Download
                    className={`h-4 w-4 sm:mr-2${downloading === w.week_start ? " animate-bounce" : ""}`}
                  />
                  <span className="hidden sm:inline">
                    {downloading === w.week_start ? "Exporting…" : "Download"}
                  </span>
                </Button>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
