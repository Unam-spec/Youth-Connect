import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { Bell, BellRing, ListMusic, LogOut, Music, Settings, User, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  clearWorshipSession,
  initials,
  worshipFetch,
  worshipKeys,
  worshipPost,
  type WorshipAccount,
  type WorshipNotification,
} from "@/lib/worship";
import { enableWorshipPush } from "@/lib/worshipPush";
import { ProfileDialog } from "./ProfileDialog";

/** Applies the worship colour theme to <html> while mounted (dialogs portal to body). */
export function useWorshipTheme() {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("worship-theme");
    return () => root.classList.remove("worship-theme");
  }, []);
}

export function signOutOfWorship(queryClient: ReturnType<typeof useQueryClient>) {
  worshipPost("/auth/logout").catch(() => {});
  clearWorshipSession();
  queryClient.removeQueries({ queryKey: ["worship"] });
}

/** Bare worship chrome: brand + back-to-JG link. Used when signed out. */
export function WorshipFrame({ children, right }: { children: ReactNode; right?: ReactNode }) {
  useWorshipTheme();
  return (
    <div className="min-h-[100dvh] bg-background text-foreground selection:bg-primary selection:text-primary-foreground">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-72 bg-gradient-to-b from-primary/20 to-transparent" />
      <div className="relative mx-auto max-w-3xl px-4 pb-16">
        <header className="flex h-16 items-center justify-between gap-3">
          <Link href="/worship" className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/20">
              <Music className="h-5 w-5 text-primary" />
            </span>
            <span className="font-[family-name:var(--app-font-heading)] text-lg font-semibold tracking-tight">
              Worship Team
            </span>
          </Link>
          {right}
        </header>
        {children}
      </div>
    </div>
  );
}

function NotificationsBell() {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  const { data } = useQuery({
    queryKey: worshipKeys.notifications,
    queryFn: () =>
      worshipFetch<{ notifications: WorshipNotification[]; unread: number }>("/notifications"),
    refetchInterval: 60_000,
  });
  const markRead = useMutation({
    mutationFn: () => worshipPost("/notifications/read"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: worshipKeys.notifications }),
  });
  const unread = data?.unread ?? 0;

  const turnOnPush = async () => {
    const r = await enableWorshipPush();
    if (r === "subscribed") toast.success("Notifications are on for this device.");
    else if (r === "denied") toast.error("Notifications are blocked. Allow them in your browser settings.");
    else if (r === "ios-needs-install")
      toast.message("On iPhone, add this site to your Home Screen first, then turn notifications on.");
    else toast.error("Couldn't turn on notifications on this device.");
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o && unread > 0) markRead.mutate();
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="text-sm font-semibold">Notifications</p>
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={turnOnPush}>
            <BellRing className="h-3.5 w-3.5" />
            Push on this device
          </Button>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {!data?.notifications.length ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nothing yet.</p>
          ) : (
            data.notifications.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => {
                  setOpen(false);
                  setLocation(n.url);
                }}
                className={cn(
                  "block w-full border-b border-border/60 px-4 py-3 text-left last:border-0 hover:bg-muted",
                  !n.read_at && "bg-primary/5",
                )}
              >
                <p className="text-sm">{n.message}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                </p>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Signed-in worship chrome: nav, bell, account menu. */
export function WorshipShell({
  account,
  children,
}: {
  account: WorshipAccount;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const [location, setLocation] = useLocation();
  const [profileOpen, setProfileOpen] = useState(false);

  const nav = [
    { href: "/worship", label: "Team", icon: Users, active: location === "/worship" },
    {
      href: "/worship/library",
      label: "Songs",
      icon: ListMusic,
      active: location.startsWith("/worship/library") || location.startsWith("/worship/songs"),
    },
    {
      href: `/worship/members/${account.id}`,
      label: "My songs",
      icon: User,
      active: location === `/worship/members/${account.id}`,
    },
  ];

  return (
    <WorshipFrame
      right={
        <div className="flex items-center gap-1">
          <NotificationsBell />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full" aria-label="Account">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/20 text-xs font-semibold text-primary">
                  {initials(account.full_name)}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel className="font-normal">
                <p className="text-sm font-semibold">{account.full_name}</p>
                <p className="text-xs text-muted-foreground">
                  {account.role === "leader" ? "Worship leader" : "Worship team"}
                </p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setProfileOpen(true)}>
                <Settings className="mr-2 h-4 w-4" /> Edit profile
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  signOutOfWorship(queryClient);
                  setLocation("/worship");
                }}
              >
                <LogOut className="mr-2 h-4 w-4" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      }
    >
      <nav className="mb-6 flex gap-2 overflow-x-auto pb-1" aria-label="Worship sections">
        {nav.map(({ href, label, icon: Icon, active }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors",
              active
                ? "border-primary/40 bg-primary/15 text-primary"
                : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        ))}
      </nav>
      {children}
      <ProfileDialog account={account} open={profileOpen} onOpenChange={setProfileOpen} />
    </WorshipFrame>
  );
}
