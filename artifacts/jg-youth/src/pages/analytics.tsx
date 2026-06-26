import { useState, useEffect, useCallback } from "react";
import { Redirect } from "wouter";
import { useAuth } from "@clerk/react";
import {
  BarChart3,
  Users,
  UserCheck,
  UserMinus,
  Calendar,
  TrendingUp,
  AlertTriangle,
  Trophy,
  MessageSquare,
  CheckCircle,
  RefreshCw,
  Flame,
  KeyRound,
} from "lucide-react";
import {
  BarChart,
  Bar,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { DashboardLayout } from "@/components/dashboard-layout";
import { getLeaderSession } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────────
interface AnalyticsData {
  summary: {
    total_members: number;
    active_members: number;
    dormant_members: number;
    upcoming_events: number;
    checkins_this_week: number;
    checkins_this_month: number;
    at_risk_count: number;
    feedback_total: number;
    feedback_this_week: number;
    no_email_accounts: number;
    no_email_visitors: number;
    no_email_members: number;
  };
  checkin_trends_weekly: { week: string; checkins: number }[];
  checkin_trends_monthly: { month: string; checkins: number }[];
  signup_trends: { week: string; signups: number }[];
  event_attendance: {
    event_id: string;
    title: string;
    date: string;
    attendance_count: number;
    rsvp_count: number;
    attendance_rate: number;
  }[];
  at_risk_members: {
    id: string;
    full_name: string;
    phone: string | null;
    last_checkin: string | null;
    weeks_absent: number;
  }[];
  streak_leaders: {
    profile_id: string;
    full_name: string;
    total_checkins: number;
    last_checkin: string;
  }[];
}

// ── Chart colors ───────────────────────────────────────────────────────────────
const CHART_COLORS = {
  primary: "hsl(262, 83%, 58%)",
  primaryMuted: "hsl(262, 83%, 58%, 0.15)",
  cyan: "hsl(187, 85%, 53%)",
  cyanMuted: "hsl(187, 85%, 53%, 0.15)",
  amber: "hsl(38, 92%, 50%)",
  amberMuted: "hsl(38, 92%, 50%, 0.15)",
  rose: "hsl(346, 87%, 60%)",
  roseMuted: "hsl(346, 87%, 60%, 0.15)",
  emerald: "hsl(152, 68%, 50%)",
  emeraldMuted: "hsl(152, 68%, 50%, 0.15)",
  blue: "hsl(217, 91%, 60%)",
  blueMuted: "hsl(217, 91%, 60%, 0.15)",
};

const PIE_COLORS = [CHART_COLORS.emerald, CHART_COLORS.rose];

// ── Custom tooltip ─────────────────────────────────────────────────────────────
function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: any[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-lg">
      <p className="text-xs font-medium text-muted-foreground mb-1">{label}</p>
      {payload.map((entry: any, i: number) => (
        <p key={i} className="text-sm font-semibold" style={{ color: entry.color }}>
          {entry.name}: {entry.value}
        </p>
      ))}
    </div>
  );
}

// ── Summary stat card ──────────────────────────────────────────────────────────
function StatCard({
  title,
  value,
  icon,
  accent,
  subtitle,
  loading,
}: {
  title: string;
  value: number | string;
  icon: React.ReactNode;
  accent: string;
  subtitle?: string;
  loading: boolean;
}) {
  return (
    <Card className="border border-border bg-card overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {title}
          </span>
          <div
            className="h-8 w-8 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: `${accent}20` }}
          >
            {icon}
          </div>
        </div>
        {loading ? (
          <Skeleton className="h-9 w-16" />
        ) : (
          <div className="text-3xl font-bold tabular-nums text-foreground">
            {value}
          </div>
        )}
        {subtitle && !loading && (
          <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Chart wrapper card ─────────────────────────────────────────────────────────
function ChartCard({
  title,
  icon,
  children,
  className,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("border border-border bg-card", className)}>
      <CardHeader className="pb-2 pt-4 px-5">
        <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-5">{children}</CardContent>
    </Card>
  );
}

// ── Risk color helper ──────────────────────────────────────────────────────────
function getRiskColor(weeks: number) {
  if (weeks >= 8) return { bg: "bg-red-500/15", text: "text-red-500", border: "border-red-500/30" };
  if (weeks >= 6) return { bg: "bg-orange-500/15", text: "text-orange-500", border: "border-orange-500/30" };
  if (weeks >= 4) return { bg: "bg-amber-500/15", text: "text-amber-600", border: "border-amber-500/30" };
  return { bg: "bg-yellow-500/15", text: "text-yellow-600", border: "border-yellow-500/30" };
}

// Format week label: "2026-06-16" → "Jun 16"
function formatWeekLabel(week: string) {
  try {
    const d = new Date(week + "T00:00:00");
    return d.toLocaleDateString("en-ZA", { month: "short", day: "numeric" });
  } catch {
    return week;
  }
}

// Format month label: "2026-06" → "Jun"
function formatMonthLabel(month: string) {
  try {
    const d = new Date(month + "-01T00:00:00");
    return d.toLocaleDateString("en-ZA", { month: "short" });
  } catch {
    return month;
  }
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function Analytics() {
  const session = getLeaderSession();
  const { getToken } = useAuth();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chartView, setChartView] = useState<"weekly" | "monthly">("weekly");

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      try {
        const token = await getToken();
        if (token) headers["Authorization"] = `Bearer ${token}`;
      } catch {}
      try {
        const sessionStr = localStorage.getItem("jg_leader_session");
        if (sessionStr) {
          const s = JSON.parse(sessionStr);
          if (Date.now() < s.expires_at) {
            headers["x-leader-session"] = sessionStr;
          }
        }
      } catch {}

      const apiBase = import.meta.env.VITE_API_URL || "";
      const res = await fetch(`${apiBase}/api/dashboard/analytics-data`, {
        headers,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError("Failed to load analytics data");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  if (!session) {
    return <Redirect to="/leader-login" />;
  }

  const s = data?.summary;

  return (
    <DashboardLayout active="analytics">
      <div className="space-y-5 pb-12">
        {/* ── Header ── */}
        <div className="rounded-2xl border border-border bg-card p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <BarChart3 className="h-4 w-4 text-primary" />
                <span className="text-xs font-semibold text-primary uppercase tracking-widest">
                  Insights
                </span>
              </div>
              <h1 className="font-[family-name:var(--app-font-heading)] text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                Analytics
              </h1>
              <p className="text-muted-foreground mt-1 text-sm">
                Member engagement, attendance trends &amp; growth — powered by
                your data.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={fetchAnalytics}
              disabled={loading}
              className="shrink-0"
            >
              <RefreshCw
                className={cn("h-4 w-4 mr-2", loading && "animate-spin")}
              />
              Refresh
            </Button>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* ── Summary Cards ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            title="Total Members"
            value={s?.total_members ?? 0}
            icon={<Users className="h-4 w-4" style={{ color: CHART_COLORS.primary }} />}
            accent={CHART_COLORS.primary}
            loading={loading}
          />
          <StatCard
            title="Active Members"
            value={s?.active_members ?? 0}
            icon={<UserCheck className="h-4 w-4" style={{ color: CHART_COLORS.emerald }} />}
            accent={CHART_COLORS.emerald}
            subtitle="Checked in within 2 weeks"
            loading={loading}
          />
          <StatCard
            title="At Risk"
            value={s?.at_risk_count ?? 0}
            icon={<AlertTriangle className="h-4 w-4" style={{ color: CHART_COLORS.amber }} />}
            accent={CHART_COLORS.amber}
            subtitle="No check-in for 2+ weeks"
            loading={loading}
          />
          <StatCard
            title="Dormant"
            value={s?.dormant_members ?? 0}
            icon={<UserMinus className="h-4 w-4" style={{ color: CHART_COLORS.rose }} />}
            accent={CHART_COLORS.rose}
            subtitle="Inactive members"
            loading={loading}
          />
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            title="Check-ins This Week"
            value={s?.checkins_this_week ?? 0}
            icon={<CheckCircle className="h-4 w-4" style={{ color: CHART_COLORS.cyan }} />}
            accent={CHART_COLORS.cyan}
            loading={loading}
          />
          <StatCard
            title="Check-ins This Month"
            value={s?.checkins_this_month ?? 0}
            icon={<TrendingUp className="h-4 w-4" style={{ color: CHART_COLORS.blue }} />}
            accent={CHART_COLORS.blue}
            loading={loading}
          />
          <StatCard
            title="Upcoming Events"
            value={s?.upcoming_events ?? 0}
            icon={<Calendar className="h-4 w-4" style={{ color: CHART_COLORS.primary }} />}
            accent={CHART_COLORS.primary}
            loading={loading}
          />
          <StatCard
            title="Feedback Received"
            value={s?.feedback_total ?? 0}
            icon={<MessageSquare className="h-4 w-4" style={{ color: CHART_COLORS.emerald }} />}
            accent={CHART_COLORS.emerald}
            subtitle={`${s?.feedback_this_week ?? 0} this week`}
            loading={loading}
          />
        </div>

        {/* ── No-Email (PIN) Accounts ── */}
        <Card className="border border-primary/20 bg-primary/5">
          <CardContent className="p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="h-11 w-11 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
                  <KeyRound className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    No-Email (PIN) Accounts
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Username + PIN sign-ups — no email needed
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-6 sm:gap-8 pl-14 sm:pl-0">
                <div>
                  {loading ? (
                    <Skeleton className="h-8 w-12" />
                  ) : (
                    <div className="text-3xl font-bold tabular-nums text-foreground">
                      {s?.no_email_accounts ?? 0}
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground mt-0.5">Total</p>
                </div>
                <div>
                  {loading ? (
                    <Skeleton className="h-7 w-10" />
                  ) : (
                    <div className="text-2xl font-semibold tabular-nums text-amber-500">
                      {s?.no_email_visitors ?? 0}
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground mt-0.5">Awaiting promotion</p>
                </div>
                <div>
                  {loading ? (
                    <Skeleton className="h-7 w-10" />
                  ) : (
                    <div className="text-2xl font-semibold tabular-nums text-emerald-500">
                      {s?.no_email_members ?? 0}
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground mt-0.5">Promoted to member</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Charts Row 1: Check-in Trends + Active vs Dormant ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <ChartCard
            title="Check-in Trends"
            icon={<TrendingUp className="h-4 w-4 text-primary" />}
            className="lg:col-span-2"
          >
            {/* Toggle */}
            <div className="flex gap-1 mb-4">
              <button
                onClick={() => setChartView("weekly")}
                className={cn(
                  "px-3 py-1 text-xs font-medium rounded-md transition-colors",
                  chartView === "weekly"
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted",
                )}
              >
                Weekly
              </button>
              <button
                onClick={() => setChartView("monthly")}
                className={cn(
                  "px-3 py-1 text-xs font-medium rounded-md transition-colors",
                  chartView === "monthly"
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted",
                )}
              >
                Monthly
              </button>
            </div>
            {loading ? (
              <Skeleton className="h-64 w-full rounded-lg" />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  data={
                    chartView === "weekly"
                      ? data?.checkin_trends_weekly ?? []
                      : data?.checkin_trends_monthly ?? []
                  }
                  margin={{ top: 5, right: 5, left: -20, bottom: 5 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="hsl(215, 20%, 20%)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey={chartView === "weekly" ? "week" : "month"}
                    tickFormatter={
                      chartView === "weekly"
                        ? formatWeekLabel
                        : formatMonthLabel
                    }
                    tick={{ fontSize: 11, fill: "hsl(215, 16%, 57%)" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "hsl(215, 16%, 57%)" }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar
                    dataKey="checkins"
                    name="Check-ins"
                    fill={CHART_COLORS.primary}
                    radius={[6, 6, 0, 0]}
                    maxBarSize={40}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard
            title="Active vs Dormant"
            icon={<Users className="h-4 w-4 text-emerald-500" />}
          >
            {loading ? (
              <Skeleton className="h-64 w-full rounded-lg" />
            ) : (
              <div className="flex flex-col items-center">
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={[
                        {
                          name: "Active",
                          value: s?.active_members ?? 0,
                        },
                        {
                          name: "Dormant",
                          value: s?.dormant_members ?? 0,
                        },
                      ]}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={80}
                      paddingAngle={4}
                      dataKey="value"
                      stroke="none"
                    >
                      {PIE_COLORS.map((color, i) => (
                        <Cell key={i} fill={color} />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex gap-4 mt-2">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: CHART_COLORS.emerald }}
                    />
                    <span className="text-xs text-muted-foreground">
                      Active ({s?.active_members ?? 0})
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: CHART_COLORS.rose }}
                    />
                    <span className="text-xs text-muted-foreground">
                      Dormant ({s?.dormant_members ?? 0})
                    </span>
                  </div>
                </div>
              </div>
            )}
          </ChartCard>
        </div>

        {/* ── Charts Row 2: Sign-ups + Event Attendance ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard
            title="New Sign-ups (12 Weeks)"
            icon={<TrendingUp className="h-4 w-4 text-cyan-500" />}
          >
            {loading ? (
              <Skeleton className="h-52 w-full rounded-lg" />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart
                  data={data?.signup_trends ?? []}
                  margin={{ top: 5, right: 5, left: -20, bottom: 5 }}
                >
                  <defs>
                    <linearGradient
                      id="signupGradient"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="5%"
                        stopColor={CHART_COLORS.cyan}
                        stopOpacity={0.3}
                      />
                      <stop
                        offset="95%"
                        stopColor={CHART_COLORS.cyan}
                        stopOpacity={0}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="hsl(215, 20%, 20%)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="week"
                    tickFormatter={formatWeekLabel}
                    tick={{ fontSize: 11, fill: "hsl(215, 16%, 57%)" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "hsl(215, 16%, 57%)" }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="signups"
                    name="Sign-ups"
                    stroke={CHART_COLORS.cyan}
                    strokeWidth={2}
                    fill="url(#signupGradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard
            title="Event Attendance"
            icon={<Calendar className="h-4 w-4 text-amber-500" />}
          >
            {loading ? (
              <Skeleton className="h-52 w-full rounded-lg" />
            ) : data?.event_attendance?.length ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={[...data.event_attendance].reverse()}
                  margin={{ top: 5, right: 5, left: -20, bottom: 5 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="hsl(215, 20%, 20%)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="title"
                    tick={{ fontSize: 10, fill: "hsl(215, 16%, 57%)" }}
                    axisLine={false}
                    tickLine={false}
                    interval={0}
                    angle={-20}
                    textAnchor="end"
                    height={50}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "hsl(215, 16%, 57%)" }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar
                    dataKey="attendance_count"
                    name="Attended"
                    fill={CHART_COLORS.amber}
                    radius={[6, 6, 0, 0]}
                    maxBarSize={35}
                  />
                  <Bar
                    dataKey="rsvp_count"
                    name="RSVPs"
                    fill={CHART_COLORS.blue}
                    radius={[6, 6, 0, 0]}
                    maxBarSize={35}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-52 flex items-center justify-center text-sm text-muted-foreground">
                No event data yet
              </div>
            )}
          </ChartCard>
        </div>

        {/* ── Row 3: Streak Leaderboard + At-Risk Members ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Streak Leaderboard */}
          <ChartCard
            title="Check-in Streak Leaderboard"
            icon={<Trophy className="h-4 w-4 text-amber-500" />}
          >
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-14 w-full rounded-xl" />
                ))}
              </div>
            ) : data?.streak_leaders?.length ? (
              <div className="space-y-2">
                {data.streak_leaders.map((leader, i) => (
                  <div
                    key={leader.profile_id}
                    className={cn(
                      "flex items-center gap-3 rounded-xl border p-3 transition-colors",
                      i === 0
                        ? "border-amber-500/30 bg-amber-500/5"
                        : "border-border bg-card hover:border-border/80",
                    )}
                  >
                    <div
                      className={cn(
                        "h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0",
                        i === 0
                          ? "bg-amber-500/20 text-amber-500"
                          : i === 1
                            ? "bg-slate-400/20 text-slate-400"
                            : i === 2
                              ? "bg-orange-700/20 text-orange-600"
                              : "bg-muted text-muted-foreground",
                      )}
                    >
                      {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">
                        {leader.full_name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Last: {leader.last_checkin ?? "N/A"}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Flame className="h-4 w-4 text-amber-500" />
                      <span className="text-sm font-bold text-foreground tabular-nums">
                        {leader.total_checkins}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-10 text-center text-sm text-muted-foreground">
                No check-in data yet
              </div>
            )}
          </ChartCard>

          {/* At-Risk Members */}
          <ChartCard
            title={`At-Risk Members (${data?.at_risk_members?.length ?? 0})`}
            icon={<AlertTriangle className="h-4 w-4 text-amber-500" />}
          >
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-14 w-full rounded-xl" />
                ))}
              </div>
            ) : data?.at_risk_members?.length ? (
              <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
                {data.at_risk_members.map((member) => {
                  const risk = getRiskColor(member.weeks_absent);
                  return (
                    <div
                      key={member.id}
                      className={cn(
                        "flex items-center gap-3 rounded-xl border p-3 transition-colors",
                        risk.border,
                        risk.bg,
                      )}
                    >
                      <div
                        className={cn(
                          "h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0",
                          risk.bg,
                          risk.text,
                        )}
                      >
                        {member.full_name?.charAt(0)?.toUpperCase() ?? "?"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">
                          {member.full_name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {member.last_checkin
                            ? `Last seen: ${member.last_checkin}`
                            : "Never checked in"}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-xs shrink-0",
                          risk.text,
                          risk.border,
                          risk.bg,
                        )}
                      >
                        {member.weeks_absent}w
                      </Badge>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-10 text-center text-sm text-muted-foreground">
                🎉 No at-risk members — everyone's engaged!
              </div>
            )}
          </ChartCard>
        </div>
      </div>
    </DashboardLayout>
  );
}
