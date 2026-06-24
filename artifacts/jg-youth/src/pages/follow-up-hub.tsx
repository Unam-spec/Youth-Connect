import { Redirect } from "wouter";
import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { UserMinus, Send, Check, Loader2, Phone, CalendarOff } from "lucide-react";
import { DashboardLayout } from "@/components/dashboard-layout";
import { getLeaderSession } from "@/lib/auth";
import { useApiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface FollowUpUser {
  id: string;
  full_name: string;
  phone: string | null;
  whatsapp_opt_in: boolean;
  last_checkin: string | null;
  weeks_absent: number;
  stage_weeks: number;
  sent?: boolean; // optimistic UI flag
}

interface FollowUpResponse {
  total: number;
  groups: Record<string, Omit<FollowUpUser, "sent">[]>;
}

const FOLLOWUPS_KEY = ["follow-ups"];

// Fallback stage colours (overridden by each follow_up template's color_hex).
const FALLBACK_STAGE_COLOR: Record<number, string> = {
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

export default function FollowUpHub() {
  const session = getLeaderSession();
  const apiFetch = useApiFetch();
  const queryClient = useQueryClient();
  const leaderId = session?.profile_id;

  // Flatten the grouped response into one most-overdue-first list.
  const { data: users, isLoading } = useQuery<FollowUpUser[]>({
    queryKey: FOLLOWUPS_KEY,
    queryFn: async () => {
      const res = await apiFetch("/api/whatsapp/follow-ups");
      if (!res.ok) throw new Error("Failed to load follow-ups");
      const json: FollowUpResponse = await res.json();
      return Object.values(json.groups)
        .flat()
        .sort((a, b) => b.weeks_absent - a.weeks_absent);
    },
    enabled: !!session,
  });

  // Stage → colour map from the follow_up templates.
  const { data: stageColors } = useQuery<Record<number, string>>({
    queryKey: ["whatsapp-templates", "stage-colors"],
    queryFn: async () => {
      const res = await apiFetch("/api/whatsapp-templates?template_type=follow_up");
      if (!res.ok) return FALLBACK_STAGE_COLOR;
      const rows: { stage_weeks: number | null; color_hex: string }[] = await res.json();
      const map: Record<number, string> = { ...FALLBACK_STAGE_COLOR };
      for (const r of rows) if (r.stage_weeks != null) map[r.stage_weeks] = r.color_hex;
      return map;
    },
    enabled: !!session,
  });

  // ── Send WhatsApp (optimistic: flag the card as sent) ──────────────────────
  const sendWhatsApp = useMutation({
    mutationFn: async (user: FollowUpUser) => {
      const res = await apiFetch("/api/whatsapp/send", {
        method: "POST",
        body: JSON.stringify({ user_id: user.id, leader_id: leaderId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to send WhatsApp");
      }
      return res.json();
    },
    onMutate: async (user) => {
      await queryClient.cancelQueries({ queryKey: FOLLOWUPS_KEY });
      const prev = queryClient.getQueryData<FollowUpUser[]>(FOLLOWUPS_KEY);
      queryClient.setQueryData<FollowUpUser[]>(FOLLOWUPS_KEY, (old) =>
        (old ?? []).map((u) => (u.id === user.id ? { ...u, sent: true } : u)),
      );
      return { prev };
    },
    onError: (err, _user, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(FOLLOWUPS_KEY, ctx.prev);
      toast.error(err instanceof Error ? err.message : "Failed to send WhatsApp");
    },
    onSuccess: (_data, user) => {
      toast.success(`WhatsApp sent to ${user.full_name.split(" ")[0]}`);
    },
    // No invalidate — keep the optimistic "Sent" state for this session.
  });

  // ── Mark checked in (optimistic: remove the card) ──────────────────────────
  const markCheckedIn = useMutation({
    mutationFn: async (user: FollowUpUser) => {
      const res = await apiFetch("/api/attendance", {
        method: "POST",
        body: JSON.stringify({ profile_id: user.id, check_in_method: "manual" }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to mark check-in");
      }
      return res.json();
    },
    onMutate: async (user) => {
      await queryClient.cancelQueries({ queryKey: FOLLOWUPS_KEY });
      const prev = queryClient.getQueryData<FollowUpUser[]>(FOLLOWUPS_KEY);
      queryClient.setQueryData<FollowUpUser[]>(FOLLOWUPS_KEY, (old) =>
        (old ?? []).filter((u) => u.id !== user.id),
      );
      return { prev };
    },
    onError: (err, _user, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(FOLLOWUPS_KEY, ctx.prev);
      toast.error(err instanceof Error ? err.message : "Failed to mark check-in");
    },
    onSuccess: (_data, user) => {
      toast.success(`${user.full_name.split(" ")[0]} marked checked in`);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: FOLLOWUPS_KEY });
    },
  });

  if (!session) return <Redirect to="/leader-login" />;

  const colorFor = (stage: number) =>
    stageColors?.[stage] ?? FALLBACK_STAGE_COLOR[stage] ?? "#EF4444";

  return (
    <DashboardLayout active="follow-ups">
      <div className="space-y-6 pb-12">
        {/* Header */}
        <div className="rounded-2xl border border-border bg-card p-6">
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
            Members overdue for a check-in, grouped by how long they've been away.
            Send a WhatsApp nudge or mark them in.
          </p>
        </div>

        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-40 w-full rounded-2xl" />
            ))}
          </div>
        ) : !users || users.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
              <Check className="h-6 w-6 text-emerald-600" />
            </div>
            <h2 className="text-lg font-semibold text-foreground">All caught up! 🎉</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              No members are overdue for a check-in right now.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {users.map((user) => {
              const color = colorFor(user.stage_weeks);
              const sending = sendWhatsApp.isPending && sendWhatsApp.variables?.id === user.id;
              const marking = markCheckedIn.isPending && markCheckedIn.variables?.id === user.id;
              return (
                <div
                  key={user.id}
                  className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-3 w-3 shrink-0 rounded-full ring-2 ring-background"
                        style={{ backgroundColor: color }}
                        aria-hidden
                      />
                      <span
                        className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                        style={{ backgroundColor: `${color}22`, color }}
                      >
                        {user.weeks_absent}w absent
                      </span>
                    </div>
                  </div>

                  <div className="min-w-0">
                    <p className="truncate font-semibold text-foreground">{user.full_name}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Phone className="h-3 w-3" />
                      {user.phone || "no phone"}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <CalendarOff className="h-3 w-3" />
                      Last in: {formatDate(user.last_checkin)}
                    </p>
                  </div>

                  <div className="mt-auto flex gap-2 pt-1">
                    <Button
                      size="sm"
                      className="flex-1 rounded-xl"
                      disabled={!user.phone || user.sent || sending}
                      onClick={() => sendWhatsApp.mutate(user)}
                      title={!user.phone ? "No phone number on file" : undefined}
                    >
                      {sending ? (
                        <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Sending…</>
                      ) : user.sent ? (
                        <><Check className="mr-1.5 h-3.5 w-3.5" />Sent</>
                      ) : (
                        <><Send className="mr-1.5 h-3.5 w-3.5" />WhatsApp</>
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 rounded-xl"
                      disabled={marking}
                      onClick={() => markCheckedIn.mutate(user)}
                    >
                      {marking ? (
                        <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />…</>
                      ) : (
                        <><Check className="mr-1.5 h-3.5 w-3.5" />Mark in</>
                      )}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
