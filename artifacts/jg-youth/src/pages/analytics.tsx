import { Redirect } from "wouter";
import { BarChart3, ExternalLink } from "lucide-react";
import { DashboardLayout } from "@/components/dashboard-layout";
import { getLeaderSession } from "@/lib/auth";

// PostHog shared-dashboard URL. Configured via env so nothing is hardcoded; when
// unset we show a friendly setup hint instead of a broken iframe.
const DASHBOARD_URL = import.meta.env.VITE_POSTHOG_DASHBOARD_URL as
  | string
  | undefined;

export default function Analytics() {
  const session = getLeaderSession();

  // Analytics is leaders-only and is only reachable from the dashboard sidebar.
  if (!session) {
    return <Redirect to="/leader-login" />;
  }

  return (
    <DashboardLayout active="analytics">
      <div className="space-y-5 pb-12">
        {/* ── Header ── */}
        <div className="rounded-2xl border border-border bg-card p-6">
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
            Product usage, attendance trends &amp; engagement — powered by PostHog.
          </p>
        </div>

        {/* ── Dashboard embed ── */}
        {DASHBOARD_URL ? (
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <iframe
              src={DASHBOARD_URL}
              title="PostHog analytics dashboard"
              className="h-[calc(100vh-18rem)] min-h-[600px] w-full border-0 bg-background"
              allow="fullscreen; clipboard-write"
              loading="lazy"
            />
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <BarChart3 className="h-6 w-6 text-primary" />
            </div>
            <h2 className="text-lg font-semibold text-foreground">
              Analytics dashboard not configured yet
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              Set{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">
                VITE_POSTHOG_DASHBOARD_URL
              </code>{" "}
              to a PostHog shared dashboard link to embed it here. Create one in
              PostHog under a dashboard&apos;s &ldquo;Share&rdquo; menu.
            </p>
            <a
              href="https://posthog.com/docs/products/dashboards/shared-dashboards"
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/90"
            >
              How to share a dashboard
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
