import { useState } from "react";
import { Redirect } from "wouter";
import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import {
  UserMinus,
  Send,
  Check,
  Loader2,
  Phone,
  CalendarOff,
  X,
  RefreshCw,
  Settings2,
  Zap,
  Clock,
  ToggleLeft,
  ToggleRight,
  MessageSquare,
  AlertTriangle,
  CheckCircle,
  RotateCcw,
} from "lucide-react";
import { DashboardLayout } from "@/components/dashboard-layout";
import { getLeaderSession } from "@/lib/auth";
import { useApiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────────
interface QueueEntry {
  id: string;
  profile_id: string;
  full_name: string | null;
  phone: string | null;
  stage_weeks: number;
  weeks_absent: number;
  message_preview: string;
  status: "pending" | "approved" | "rejected" | "sent" | "failed";
  created_at: string;
  sent_at: string | null;
  error_message: string | null;
}

interface AutomationSettings {
  id?: string;
  enabled: boolean;
  day_of_week: number;
  time: string;
  include_never_attended: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────────
const QUEUE_KEY = ["follow-up-queue"];
const SETTINGS_KEY = ["automation-settings"];

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const STAGE_COLORS: Record<number, string> = {
  2: "#FACC15",
  4: "#FB923C",
  6: "#F87171",
  8: "#EF4444",
};

function formatDate(d: string | null): string {
  if (!d) return "never";
  try {
    return new Date(`${d}T00:00:00`).toLocaleDateString("en-ZA", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return d;
  }
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function FollowUpHub() {
  const session = getLeaderSession();
  const apiFetch = useApiFetch();
  const queryClient = useQueryClient();
  const leaderId = session?.profile_id;
  const [showSettings, setShowSettings] = useState(false);

  // ── Queue data ─────────────────────────────────────────────────────────────
  const { data: queueEntries, isLoading: queueLoading } = useQuery<QueueEntry[]>({
    queryKey: QUEUE_KEY,
    queryFn: async () => {
      const res = await apiFetch("/api/whatsapp/queue?status=pending,sent,failed");
      if (!res.ok) throw new Error("Failed to load queue");
      return res.json();
    },
    enabled: !!session,
  });

  // ── Automation settings ────────────────────────────────────────────────────
  const { data: settings, isLoading: settingsLoading } = useQuery<AutomationSettings>({
    queryKey: SETTINGS_KEY,
    queryFn: async () => {
      const res = await apiFetch("/api/whatsapp/automation-settings");
      if (!res.ok) throw new Error("Failed to load settings");
      return res.json();
    },
    enabled: !!session,
  });

  // ── Generate queue (manual trigger) ────────────────────────────────────────
  const generateQueue = useMutation({
    mutationFn: async () => {
      const res = await apiFetch("/api/whatsapp/queue/generate", { method: "POST" });
      if (!res.ok) throw new Error("Failed to generate queue");
      return res.json();
    },
    onSuccess: (data) => {
      toast.success(`${data.generated} follow-up(s) queued for review`);
      queryClient.invalidateQueries({ queryKey: QUEUE_KEY });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to generate queue");
    },
  });

  // ── Mark as Sent (after wa.me redirect) ────────────────────────────────────
  const markAsSent = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiFetch("/api/whatsapp/queue/mark-sent", {
        method: "POST",
        body: JSON.stringify({ ids: [id] }),
      });
      if (!res.ok) throw new Error("Failed to mark sent");
      return res.json();
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: QUEUE_KEY });
      const prev = queryClient.getQueryData<QueueEntry[]>(QUEUE_KEY);
      queryClient.setQueryData<QueueEntry[]>(QUEUE_KEY, (old) =>
        (old ?? []).map((e) => (e.id === id ? { ...e, status: "sent" } : e)),
      );
      return { prev };
    },
    onError: (err, _id, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(QUEUE_KEY, ctx.prev);
      toast.error(err instanceof Error ? err.message : "Failed to update status");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: QUEUE_KEY });
    },
  });

  // ── Reject ─────────────────────────────────────────────────────────────────
  const rejectEntries = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await apiFetch("/api/whatsapp/queue/reject", {
        method: "POST",
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error("Failed to reject");
      return res.json();
    },
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: QUEUE_KEY });
      const prev = queryClient.getQueryData<QueueEntry[]>(QUEUE_KEY);
      queryClient.setQueryData<QueueEntry[]>(QUEUE_KEY, (old) =>
        (old ?? []).filter((e) => !ids.includes(e.id)),
      );
      return { prev };
    },
    onError: (err, _ids, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(QUEUE_KEY, ctx.prev);
      toast.error(err instanceof Error ? err.message : "Reject failed");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: QUEUE_KEY });
    },
  });

  // ── Update settings ────────────────────────────────────────────────────────
  const updateSettings = useMutation({
    mutationFn: async (patch: Partial<AutomationSettings>) => {
      const res = await apiFetch("/api/whatsapp/automation-settings", {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error("Failed to update settings");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Automation settings updated");
      queryClient.invalidateQueries({ queryKey: SETTINGS_KEY });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Settings update failed");
    },
  });

  // ── Retry ──────────────────────────────────────────────────────────────────
  const retryEntries = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await apiFetch("/api/whatsapp/queue/retry", {
        method: "POST",
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error("Failed to retry");
      return res.json();
    },
    onSuccess: (data) => {
      toast.success(`${data.retried} entry(s) moved back to pending queue`);
      queryClient.invalidateQueries({ queryKey: QUEUE_KEY });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Retry failed");
    },
  });

  if (!session) return <Redirect to="/leader-login" />;

  const leaderName = session.full_name || "JG Youth Team";

  const pendingEntries = (queueEntries ?? []).filter((e) => e.status === "pending");
  const sentEntries = (queueEntries ?? []).filter((e) => e.status === "sent");

  // Format phone number for wa.me link
  const getWaMeLink = (phone: string, text: string) => {
    let cleanPhone = phone.replace(/[^0-9+]/g, "");
    if (cleanPhone.startsWith("0")) {
      cleanPhone = "27" + cleanPhone.slice(1);
    } else if (cleanPhone.startsWith("+")) {
      cleanPhone = cleanPhone.slice(1);
    }
    return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`;
  };

  return (
    <DashboardLayout active="follow-ups">
      <div className="space-y-6 pb-12">
        {/* Header */}
        <div className="rounded-2xl border border-border bg-card p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-2 flex items-center gap-2">
                <UserMinus className="h-4 w-4 text-primary" />
                <span className="text-xs font-semibold uppercase tracking-widest text-primary">
                  Re-engagement
                </span>
              </div>
              <h1 className="font-[family-name:var(--app-font-heading)] text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                Follow-up Hub
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Review queued follow-up messages before they're sent. Approve, reject, or generate new ones.
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowSettings(!showSettings)}
                className="gap-1.5"
              >
                <Settings2 className="h-4 w-4" />
                Schedule
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => generateQueue.mutate()}
                disabled={generateQueue.isPending}
                className="gap-1.5"
              >
                {generateQueue.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Zap className="h-4 w-4" />
                )}
                Generate Now
              </Button>
            </div>
          </div>
        </div>

        {/* ── Automation Settings Panel ───────────────────────────────────────── */}
        {showSettings && (
          <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" />
                <h2 className="font-semibold text-sm text-foreground">Automation Schedule</h2>
              </div>
              <button
                onClick={() => setShowSettings(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {settingsLoading ? (
              <Skeleton className="h-24 w-full rounded-xl" />
            ) : settings ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {/* Enabled toggle */}
                <div className="rounded-xl border border-border bg-card p-4">
                  <p className="text-xs text-muted-foreground mb-2 uppercase tracking-wide">Automation</p>
                  <button
                    onClick={() => updateSettings.mutate({ enabled: !settings.enabled })}
                    className="flex items-center gap-2 text-sm font-medium"
                    disabled={updateSettings.isPending}
                  >
                    {settings.enabled ? (
                      <>
                        <ToggleRight className="h-5 w-5 text-emerald-500" />
                        <span className="text-emerald-500">Enabled</span>
                      </>
                    ) : (
                      <>
                        <ToggleLeft className="h-5 w-5 text-muted-foreground" />
                        <span className="text-muted-foreground">Disabled</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Day picker */}
                <div className="rounded-xl border border-border bg-card p-4">
                  <p className="text-xs text-muted-foreground mb-2 uppercase tracking-wide">Day</p>
                  <select
                    value={settings.day_of_week}
                    onChange={(e) =>
                      updateSettings.mutate({ day_of_week: parseInt(e.target.value) })
                    }
                    className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground"
                  >
                    {DAY_NAMES.map((name, i) => (
                      <option key={i} value={i}>{name}</option>
                    ))}
                  </select>
                </div>

                {/* Time picker */}
                <div className="rounded-xl border border-border bg-card p-4">
                  <p className="text-xs text-muted-foreground mb-2 uppercase tracking-wide">Time (SAST)</p>
                  <input
                    type="time"
                    value={settings.time}
                    onChange={(e) => updateSettings.mutate({ time: e.target.value })}
                    className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground"
                  />
                </div>

                {/* Include never attended */}
                <div className="rounded-xl border border-border bg-card p-4">
                  <p className="text-xs text-muted-foreground mb-2 uppercase tracking-wide">Never Attended</p>
                  <button
                    onClick={() =>
                      updateSettings.mutate({
                        include_never_attended: !settings.include_never_attended,
                      })
                    }
                    className="flex items-center gap-2 text-sm font-medium"
                    disabled={updateSettings.isPending}
                  >
                    {settings.include_never_attended ? (
                      <>
                        <ToggleRight className="h-5 w-5 text-emerald-500" />
                        <span className="text-emerald-500">Included</span>
                      </>
                    ) : (
                      <>
                        <ToggleLeft className="h-5 w-5 text-muted-foreground" />
                        <span className="text-muted-foreground">Excluded</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            ) : null}

            <p className="text-xs text-muted-foreground">
              The automation will generate pending messages at the set time. You'll still need to
              review and approve them from this page before they're sent.
            </p>
          </div>
        )}

        {/* ── Pending Queue ──────────────────────────────────────────────────── */}
        <div className="space-y-3">
          {pendingEntries.length > 0 && (
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-primary" />
              <h2 className="font-semibold text-sm">
                Pending Action ({pendingEntries.length})
              </h2>
            </div>
          )}

          {queueLoading ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-44 w-full rounded-2xl" />
              ))}
            </div>
          ) : pendingEntries.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
                <Check className="h-6 w-6 text-emerald-600" />
              </div>
              <h2 className="text-lg font-semibold text-foreground">All caught up! 🎉</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                No pending follow-ups in the queue. Use "Generate Now" to check for overdue members.
              </p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {pendingEntries.map((entry) => {
                const color = STAGE_COLORS[entry.stage_weeks] ?? "#EF4444";
                return (
                  <div
                    key={entry.id}
                    className="flex flex-col gap-3 rounded-2xl border p-4 transition-all border-border bg-card"
                  >
                    {/* Stage badge + absence */}
                      <div className="flex items-center gap-2">
                        <span
                          className="h-3 w-3 shrink-0 rounded-full ring-2 ring-background"
                          style={{ backgroundColor: color }}
                        />
                        <span
                          className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                          style={{ backgroundColor: `${color}22`, color }}
                        >
                          {entry.weeks_absent}w absent
                        </span>
                      </div>

                    {/* Person info */}
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-foreground">
                        {entry.full_name ?? "Unknown"}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Phone className="h-3 w-3" />
                        {entry.phone || "no phone"}
                      </p>
                    </div>

                    {/* Message preview */}
                    <div className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2">
                      <p className="text-xs text-muted-foreground line-clamp-3">
                        {entry.message_preview.replace(" — JG Youth Team", "")}
                      </p>
                    </div>

                    {/* Actions */}
                    <div className="mt-auto flex gap-2 pt-1">
                      <Button
                        size="sm"
                        className="flex-1 rounded-xl text-xs h-7"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!entry.phone) {
                            toast.error("No phone number for this member");
                            return;
                          }
                          const cleanMsg = entry.message_preview.replace(" — JG Youth Team", "");
                          window.open(getWaMeLink(entry.phone, cleanMsg), "_blank");
                          markAsSent.mutate(entry.id);
                        }}
                        disabled={markAsSent.isPending}
                      >
                        <Send className="mr-1 h-3 w-3" />
                        Send via WhatsApp
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 rounded-xl text-xs h-7"
                        onClick={(e) => {
                          e.stopPropagation();
                          rejectEntries.mutate([entry.id]);
                        }}
                        disabled={rejectEntries.isPending}
                      >
                        <X className="mr-1 h-3 w-3" />
                        Reject
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Recently Sent ──────────────────────────────────────────────────── */}
        {sentEntries.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-emerald-500" />
              <h2 className="font-semibold text-sm">
                Recently Sent ({sentEntries.length})
              </h2>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {sentEntries.slice(0, 6).map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3"
                >
                  <div className="h-8 w-8 rounded-full bg-emerald-500/15 flex items-center justify-center shrink-0">
                    <Check className="h-4 w-4 text-emerald-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">
                      {entry.full_name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Sent • {entry.stage_weeks}w stage
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </DashboardLayout>
  );
}
