import { useEffect, useState, useCallback } from "react";
import { KeyRound, ArrowUpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { DashCard, SectionTitle, SkeletonRows, EmptyState } from "./shared";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

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

export function PinAccountsPanel() {
  const { toast } = useToast();
  const [accounts, setAccounts] = useState<PinAccount[]>([]);
  const [loading, setLoading] = useState(true);

  const [promoteFor, setPromoteFor] = useState<PinAccount | null>(null);
  const [parentName, setParentName] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);

  const [resetResult, setResetResult] = useState<{ name: string; pin: string } | null>(null);

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

  function openPromote(a: PinAccount) {
    setPromoteFor(a);
    setParentName(a.parent_name ?? "");
    setParentPhone(a.parent_phone ?? "");
    setConsent(false);
  }

  const needsConsent = promoteFor != null && (promoteFor.age == null || promoteFor.age < 13);
  const promoteDisabled =
    busy || (needsConsent && (!parentName.trim() || !parentPhone.trim() || !consent));

  async function confirmPromote() {
    if (!promoteFor) return;
    setBusy(true);
    try {
      const res = await apiFetch(`/api/pin-accounts/${promoteFor.id}/grant-membership`, {
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
        await load();
      } else {
        toast({ title: "Could not promote", description: data.error ?? "Please try again.", variant: "destructive" });
      }
    } finally {
      setBusy(false);
    }
  }

  async function resetPin(a: PinAccount) {
    const res = await apiFetch(`/api/pin-accounts/${a.id}/reset-pin`, { method: "POST", body: JSON.stringify({}) });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.pin) {
      setResetResult({ name: a.full_name, pin: data.pin });
      await load();
    } else {
      toast({ title: "Could not reset PIN", description: data.error ?? "Please try again.", variant: "destructive" });
    }
  }

  return (
    <DashCard>
      <SectionTitle title="PIN Accounts" icon={<KeyRound className="h-4 w-4 text-primary" />} />
      <p className="text-xs text-muted-foreground mb-4">
        Username + PIN accounts. Promote a visitor to member, or reset a forgotten PIN.
      </p>
      {loading ? (
        <SkeletonRows count={3} />
      ) : accounts.length > 0 ? (
        <div className="space-y-3">
          {accounts.map((a) => (
            <div key={a.id} className="flex items-center justify-between p-4 border border-border rounded-xl bg-card">
              <div>
                <p className="font-semibold text-sm">{a.full_name}</p>
                <p className="text-xs text-muted-foreground">
                  @{a.username} • PIN {a.pin_plain ?? "—"} • {a.role === "member" ? "Member" : "Visitor"}
                  {a.age != null ? ` • age ${a.age}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {a.role === "visitor" && (
                  <Button variant="outline" size="sm" className="h-8 text-xs px-3" onClick={() => openPromote(a)}>
                    <ArrowUpCircle className="w-3.5 h-3.5 mr-1" /> Promote
                  </Button>
                )}
                <Button variant="ghost" size="sm" className="h-8 text-xs px-3" onClick={() => resetPin(a)}>
                  Reset PIN
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState text="No PIN accounts yet." />
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
            <Button variant="outline" onClick={() => setPromoteFor(null)} disabled={busy}>Cancel</Button>
            <Button onClick={confirmPromote} disabled={promoteDisabled}>{busy ? "Promoting..." : "Promote"}</Button>
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
    </DashCard>
  );
}
