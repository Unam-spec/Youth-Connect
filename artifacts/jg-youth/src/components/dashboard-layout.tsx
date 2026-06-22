import { type ReactNode } from "react";
import { Link, useLocation, useSearch } from "wouter";
import {
  Activity,
  Users,
  Calendar,
  Settings,
  BarChart3,
  type LucideIcon,
} from "lucide-react";
import { Layout } from "@/components/layout";
import { getLeaderSession } from "@/lib/auth";
import { cn } from "@/lib/utils";

// The four in-page dashboard sections (rendered as Tabs content on /dashboard)
// plus the standalone Analytics route. Sections are URL-addressable via
// `/dashboard?section=<key>` so the sidebar and command palette can deep-link
// into them.
export type DashboardSectionKey = "session" | "members" | "events" | "manage";
export type DashboardNavKey = DashboardSectionKey | "analytics";

const SECTION_KEYS: DashboardSectionKey[] = [
  "session",
  "members",
  "events",
  "manage",
];

/** Read/normalize the active dashboard section from the URL query string. */
export function useDashboardSection(): [
  DashboardSectionKey,
  (key: DashboardSectionKey) => void,
] {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const raw = new URLSearchParams(search).get("section");
  const section = (
    SECTION_KEYS.includes(raw as DashboardSectionKey) ? raw : "session"
  ) as DashboardSectionKey;
  const setSection = (key: DashboardSectionKey) =>
    setLocation(`/dashboard?section=${key}`);
  return [section, setSection];
}

interface NavItem {
  key: DashboardNavKey;
  label: string;
  icon: LucideIcon;
  href: string;
  visible: boolean;
}

function useNavItems(): NavItem[] {
  const session = getLeaderSession();
  const isSuperAdmin = session?.role === "super_admin";
  const canViewMembers = Boolean(session?.can_view_members) || isSuperAdmin;

  return [
    {
      key: "session",
      label: "Session",
      icon: Activity,
      href: "/dashboard?section=session",
      visible: true,
    },
    {
      key: "members",
      label: "Members",
      icon: Users,
      href: "/dashboard?section=members",
      visible: canViewMembers,
    },
    {
      key: "events",
      label: "Events",
      icon: Calendar,
      href: "/dashboard?section=events",
      visible: true,
    },
    {
      key: "manage",
      label: "Manage",
      icon: Settings,
      href: "/dashboard?section=manage",
      visible: isSuperAdmin,
    },
    {
      key: "analytics",
      label: "Analytics",
      icon: BarChart3,
      href: "/dashboard/analytics",
      visible: true,
    },
  ];
}

/**
 * Shared chrome for the leader dashboard: the page header is left to each page,
 * but the left navigation sidebar is owned here so /dashboard and
 * /dashboard/analytics stay visually consistent. Collapses to a horizontal,
 * scrollable pill bar on small screens.
 */
export function DashboardLayout({
  active,
  children,
}: {
  active: DashboardNavKey;
  children: ReactNode;
}) {
  const items = useNavItems().filter((item) => item.visible);

  return (
    <Layout>
      <div className="flex flex-col gap-5 md:flex-row md:gap-6">
        <aside className="md:w-56 md:shrink-0">
          <nav
            aria-label="Dashboard sections"
            className="flex gap-2 overflow-x-auto pb-1 md:sticky md:top-20 md:flex-col md:overflow-visible md:pb-0"
          >
            {items.map(({ key, label, icon: Icon, href }) => {
              const isActive = key === active;
              return (
                <Link
                  key={key}
                  href={href}
                  className={cn(
                    "flex shrink-0 items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm font-medium transition-colors md:shrink",
                    isActive
                      ? "border-primary/30 bg-primary/10 text-primary"
                      : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                  aria-current={isActive ? "page" : undefined}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </Link>
              );
            })}
          </nav>
        </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </Layout>
  );
}
