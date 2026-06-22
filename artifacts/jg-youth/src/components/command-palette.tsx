import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  Home,
  LayoutDashboard,
  User,
  Activity,
  Users,
  Calendar,
  Settings,
  BarChart3,
  type LucideIcon,
} from "lucide-react";
import {
  useListProfiles,
  getListProfilesQueryKey,
} from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { getLeaderSession } from "@/lib/auth";
import { useDebouncedValue } from "@/lib/useDebounce";

interface NavCommand {
  label: string;
  path: string;
  icon: LucideIcon;
  visible: boolean;
  keywords?: string[];
}

/**
 * Global command palette (⌘K / Ctrl+K). Available to leaders only — it lets them
 * jump to any dashboard page/section or search the member directory. User search
 * is debounced (300ms) so keystrokes don't spam the profiles API.
 */
export function CommandPalette() {
  const session = getLeaderSession();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [, setLocation] = useLocation();
  const debounced = useDebouncedValue(query, 300);

  // ⌘K / Ctrl+K toggles the palette (leaders only).
  useEffect(() => {
    if (!session) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [session]);

  const isSuperAdmin = session?.role === "super_admin";
  const canViewMembers = Boolean(session?.can_view_members) || isSuperAdmin;

  const userQuery = debounced.trim();
  const userSearchEnabled = open && canViewMembers && userQuery.length >= 2;
  const { data: users, isFetching } = useListProfiles(
    userSearchEnabled ? { search: userQuery } : undefined,
    {
      query: {
        enabled: userSearchEnabled,
        queryKey: getListProfilesQueryKey(
          userSearchEnabled ? { search: userQuery } : undefined,
        ),
      },
    },
  );

  if (!session) return null;

  const navItems: NavCommand[] = [
    { label: "Dashboard", path: "/dashboard?section=session", icon: LayoutDashboard, visible: true },
    { label: "Session", path: "/dashboard?section=session", icon: Activity, visible: true },
    { label: "Members", path: "/dashboard?section=members", icon: Users, visible: canViewMembers },
    { label: "Events", path: "/dashboard?section=events", icon: Calendar, visible: true },
    { label: "Manage", path: "/dashboard?section=manage", icon: Settings, visible: isSuperAdmin },
    { label: "Analytics", path: "/dashboard/analytics", icon: BarChart3, visible: true, keywords: ["posthog", "stats", "insights"] },
    { label: "My Profile", path: "/my", icon: User, visible: true },
    { label: "Home", path: "/", icon: Home, visible: true },
  ];

  // We disable cmdk's built-in filtering (it can't see async user results), so we
  // filter the static navigation list ourselves.
  const q = query.trim().toLowerCase();
  const filteredNav = navItems.filter((item) => {
    if (!item.visible) return false;
    if (!q) return true;
    return (
      item.label.toLowerCase().includes(q) ||
      item.keywords?.some((k) => k.includes(q))
    );
  });

  const go = (path: string) => {
    setOpen(false);
    setQuery("");
    setLocation(path);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="overflow-hidden p-0">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <Command
          shouldFilter={false}
          className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5"
        >
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search pages or members…"
          />
          <CommandList>
            <CommandEmpty>
              {userSearchEnabled && isFetching
                ? "Searching…"
                : "No results found."}
            </CommandEmpty>

            {filteredNav.length > 0 && (
              <CommandGroup heading="Navigate">
                {filteredNav.map((item) => (
                  <CommandItem
                    key={item.label}
                    value={`nav:${item.label}`}
                    onSelect={() => go(item.path)}
                  >
                    <item.icon className="text-muted-foreground" />
                    <span>{item.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {canViewMembers && userQuery.length >= 2 && (users?.length ?? 0) > 0 && (
              <CommandGroup heading="Members">
                {users!.slice(0, 8).map((u: any) => (
                  <CommandItem
                    key={u.id}
                    value={`user:${u.id}`}
                    onSelect={() => go("/dashboard?section=members")}
                  >
                    <User className="text-muted-foreground" />
                    <span className="flex-1 truncate">{u.full_name}</span>
                    {u.phone && (
                      <span className="text-xs text-muted-foreground">
                        {u.phone}
                      </span>
                    )}
                    <span className="ml-2 rounded-full border border-border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {String(u.role).replace("_", " ")}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
