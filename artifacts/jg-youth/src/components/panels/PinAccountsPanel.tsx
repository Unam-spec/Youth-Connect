import { useEffect, useMemo, useState, useCallback, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getListProfilesQueryKey } from "@workspace/api-client-react";
import { KeyRound, ArrowUpCircle, Eye, EyeOff, Search, RotateCcw, MoreVertical, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DashCard, SkeletonRows, EmptyState } from "./shared";
import { apiFetch } from "@/lib/api";
import { getLeaderSession } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface PinAccount {
  id: string;
  full_name: string;
  username: string | null;
  pin_plain: string | null;
  age: number | null;
  role: string;
  parent_phone: string | null;
  parent_name: string | null;
}

type RoleFilter = "all" | "visitor" | "member";

// Rows shown before the "Show all" expander — keeps the panel short once
// kiosk registrations pile up.
const COLLAPSED_ROWS = 8;

export function PinAccountsPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [accounts, setAccounts] = useState<PinAccount[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);

  const [promoteFor, setPromoteFor] = useState<PinAccount | null>(null);
  const [parentName, setParentName] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [consent, setConsent] = useState(false);
  // useTransition keeps the dialog responsive while the promote request is in
  // flight; resettingId gives each Reset-PIN button its own pending state.
  const [isPending, startTransition] = useTransition();
  const [resettingId, setResettingId] = useState<string | null>(null);

  const [resetResult, setResetResult] = useState<{ name: string; pin: string } | null>(null);

  const [deleteFor, setDeleteFor] = useState<PinAccount | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  // Deleting a profile is super-admin-only on the backend; only show the action
  // to super admins so the menu item matches what the API will allow.
  const isSuperAdmin = getLeaderSession()?.role === "super_admin";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/api/pin-accounts");
      setAccounts(res.ok ? await res.json() : []);
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => { void load(); }, [load]);

  const isMember = (a: PinAccount) => a.role === "member";
  const memberCount = accounts.filter(isMember).length;
  const visitorCount = accounts.length - memberCount;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return accounts
      .filter((a) => {
        if (roleFilter === "member" && !isMember(a)) return false;
        if (roleFilter === "visitor" && isMember(a)) return false;
        if (!q) return true;
        return (
          a.full_name.toLowerCase().includes(q) ||
          (a.username ?? "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.full_name.localeCompare(b.full_name));
  }, [accounts, search, roleFilter]);

  const visible = showAll ? filtered : filtered.slice(0, COLLAPSED_ROWS);
  const hiddenCount = filtered.length - visible.length;

  function toggleReveal(id: string) {
    setRevealedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openPromote(a: PinAccount) {
    setPromoteFor(a);
    setParentName(a.parent_name ?? "");
    setParentPhone(a.parent_phone ?? "");
    setConsent(false);
  }

  const needsConsent = promoteFor != null && (promoteFor.age == null || promoteFor.age < 13);
  const promoteDisabled =
    isPending || (needsConsent && (!parentName.trim() || !parentPhone.trim() || !consent));

  function confirmPromote() {
    if (!promoteFor) return;
    const target = promoteFor;
    startTransition(async () => {
      try {
        const res = await apiFetch(`/api/pin-accounts/${target.id}/grant-membership`, {
          method: "POST",
          body: JSON.stringify({
            parental_consent: needsConsent ? consent : true,
            parent_name: parentName.trim() || undefined,
            parent_phone: parentPhone.trim() || undefined,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          toast({ title: "Promoted to member" });
          setPromoteFor(null);
          // Update the row from the response the server already returned, instead
          // of re-fetching the whole list (saves a full network round-trip).
          if (data.profile) {
            setAccounts((prev) =>
              prev.map((p) =>
                p.id === target.id
                  ? {
                      ...p,
                      role: data.profile.role,
                      parent_name: data.profile.parent_name,
                      parent_phone: data.profile.parent_phone,
                    }
                  : p,
              ),
            );
          }
          // The promoted account is now a full member (role: "member"), so it
          // belongs in the Member Directory alongside normal members. That list
          // is a separate query — invalidate it so the new member shows up there
          // immediately instead of only after a full page reload.
          queryClient.invalidateQueries({ queryKey: getListProfilesQueryKey() });
        } else {
          toast({ title: "Could not promote", description: data.error ?? "Please try again.", variant: "destructive" });
        }
      } catch {
        toast({ title: "Could not promote", description: "Please try again.", variant: "destructive" });
      }
    });
  }

  function resetPin(a: PinAccount) {
    setResettingId(a.id);
    startTransition(async () => {
      try {
        const res = await apiFetch(`/api/pin-accounts/${a.id}/reset-pin`, { method: "POST", body: JSON.stringify({}) });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.pin) {
          setResetResult({ name: a.full_name, pin: data.pin });
          // Reflect the new PIN locally instead of re-fetching the whole list.
          setAccounts((prev) => prev.map((p) => (p.id === a.id ? { ...p, pin_plain: data.pin } : p)));
        } else {
          toast({ title: "Could not reset PIN", description: data.error ?? "Please try again.", variant: "destructive" });
        }
      } catch {
        toast({ title: "Could not reset PIN", description: "Please try again.", variant: "destructive" });
      } finally {
        setResettingId(null);
      }
    });
  }

  async function confirmDelete() {
    if (!deleteFor) return;
    const target = deleteFor;
    setIsDeleting(true);
    try {
      const res = await apiFetch(`/api/profiles/${target.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setAccounts((prev) => prev.filter((p) => p.id !== target.id));
        setDeleteFor(null);
        // The account is gone from the shared profiles table too — refresh the
        // Member Directory so it disappears there as well.
        queryClient.invalidateQueries({ queryKey: getListProfilesQueryKey() });
        toast({ title: "Account deleted" });
      } else {
        toast({ title: "Could not delete", description: data.error ?? "Please try again.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Could not delete", description: "Please try again.", variant: "destructive" });
    } finally {
      setIsDeleting(false);
    }
  }

  const filterChips: { key: RoleFilter; label: string; count: number }[] = [
    { key: "all", label: "All", count: accounts.length },
    { key: "visitor", label: "Visitors", count: visitorCount },
    { key: "member", label: "Members", count: memberCount },
  ];

  return (
    <DashCard>
      <div className="flex items-center gap-2 mb-4">
        <KeyRound className="h-4 w-4 text-primary" />
        <h3 className="font-[family-name:var(--app-font-heading)] text-base font-semibold tracking-tight text-foreground">
          PIN Accounts
        </h3>
        {!loading && accounts.length > 0 && (
          <span className="text-xs font-medium tabular-nums rounded-full bg-primary/10 text-primary px-2 py-0.5">
            {filtered.length === accounts.length ? accounts.length : `${filtered.length} of ${accounts.length}`}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Kiosk and self-service username + PIN accounts. PINs stay hidden until you reveal them.
      </p>

      {loading ? (
        <SkeletonRows count={3} />
      ) : accounts.length > 0 ? (
        <>
          <div className="flex flex-col sm:flex-row gap-2 mb-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or username"
                className="h-9 pl-9 text-sm"
              />
            </div>
            <div className="flex gap-1.5">
              {filterChips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  onClick={() => setRoleFilter(chip.key)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    roleFilter === chip.key
                      ? "border-primary/30 bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {chip.label} {chip.count}
                </button>
              ))}
            </div>
          </div>

          {filtered.length > 0 ? (
            <div className="rounded-xl border border-border/60 divide-y divide-border/40 overflow-hidden">
              {visible.map((a) => {
                const revealed = revealedIds.has(a.id);
                return (
                  <div key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 hover:bg-muted/20 transition-colors">
                    <div className="h-8 w-8 shrink-0 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">
                      {a.full_name?.charAt(0)?.toUpperCase() ?? "?"}
                    </div>
                    <div className="min-w-[8rem] flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-sm leading-tight">{a.full_name}</p>
                        <span
                          className={cn(
                            "rounded-full border px-2 py-px text-[11px]",
                            isMember(a)
                              ? "border-primary/25 bg-primary/10 text-primary"
                              : "border-border bg-muted/40 text-muted-foreground",
                          )}
                        >
                          {isMember(a) ? "Member" : "Visitor"}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        @{a.username ?? "—"}
                        {a.age != null ? ` · age ${a.age}` : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleReveal(a.id)}
                      aria-label={revealed ? `Hide PIN for ${a.full_name}` : `Reveal PIN for ${a.full_name}`}
                      className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 font-mono text-xs tracking-[0.2em] tabular-nums text-foreground hover:border-primary/40 transition-colors"
                    >
                      {revealed ? (a.pin_plain ?? "—") : "•".repeat(Math.max(a.pin_plain?.length ?? 4, 4))}
                      {revealed ? <EyeOff className="h-3.5 w-3.5 shrink-0" /> : <Eye className="h-3.5 w-3.5 shrink-0" />}
                    </button>
                    {!isMember(a) && (
                      <Button variant="outline" size="sm" className="h-7 text-xs px-2.5" onClick={() => openPromote(a)}>
                        <ArrowUpCircle className="w-3.5 h-3.5 mr-1" /> Promote
                      </Button>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                          aria-label={`Actions for ${a.full_name}`}
                        >
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem onClick={() => resetPin(a)} disabled={resettingId === a.id}>
                          <RotateCcw className={cn("mr-2 h-3.5 w-3.5", resettingId === a.id && "animate-spin")} />
                          Reset PIN
                        </DropdownMenuItem>
                        {isSuperAdmin && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-red-600 focus:text-red-600 focus:bg-red-50 dark:focus:bg-red-950/50"
                              onClick={() => setDeleteFor(a)}
                            >
                              <Trash2 className="mr-2 h-3.5 w-3.5" />
                              Delete account
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState text={`No accounts match "${search.trim()}".`} />
          )}

          {hiddenCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 w-full h-8 text-xs text-muted-foreground"
              onClick={() => setShowAll(true)}
            >
              Show all {filtered.length}
            </Button>
          )}
          {showAll && filtered.length > COLLAPSED_ROWS && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 w-full h-8 text-xs text-muted-foreground"
              onClick={() => setShowAll(false)}
            >
              Show fewer
            </Button>
          )}
        </>
      ) : (
        <EmptyState text="No PIN accounts yet. Kiosk registrations will show up here." />
      )}

      {/* Promote dialog */}
      <Dialog open={promoteFor != null} onOpenChange={(o) => !o && setPromoteFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Promote {promoteFor?.full_name} to member</DialogTitle>
            <DialogDescription>
              {needsConsent
                ? "This person is under 13. Parental consent and parent contact details are required."
                : "Confirm promotion to full member."}
            </DialogDescription>
          </DialogHeader>
          {needsConsent && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="pa-parent-name">Parent / guardian name</Label>
                <Input id="pa-parent-name" value={parentName} onChange={(e) => setParentName(e.target.value)} placeholder="Parent name" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pa-parent-phone">Parent / guardian phone</Label>
                <Input id="pa-parent-phone" value={parentPhone} onChange={(e) => setParentPhone(e.target.value)} placeholder="082 123 4567" />
              </div>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox checked={consent} onCheckedChange={(v) => setConsent(v === true)} />
                <span>I confirm parental consent has been given.</span>
              </label>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPromoteFor(null)} disabled={isPending}>Cancel</Button>
            <Button onClick={confirmPromote} disabled={promoteDisabled}>{isPending ? "Promoting..." : "Promote"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset-PIN result dialog */}
      <Dialog open={resetResult != null} onOpenChange={(o) => !o && setResetResult(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New PIN for {resetResult?.name}</DialogTitle>
            <DialogDescription>Share this PIN with them. It won't be shown again like this.</DialogDescription>
          </DialogHeader>
          <div className="py-4 text-center text-3xl font-mono font-bold tracking-[0.4em] text-primary">
            {resetResult?.pin}
          </div>
          <DialogFooter>
            <Button onClick={() => setResetResult(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete-account confirmation (super admins only) */}
      <AlertDialog open={deleteFor != null} onOpenChange={(o) => !o && setDeleteFor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteFor?.full_name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the account and all its check-ins, RSVPs and
              requests. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white border-0"
              onClick={(e) => { e.preventDefault(); confirmDelete(); }}
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashCard>
  );
}
