import { useEffect, useRef, useState } from "react";
import { Bell, CheckCircle2, Loader2, MessageCircle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMyProfileQueryKey } from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/api";
import {
  getPushSetupState,
  subscribeToPush,
  lastPushError,
  type PushSetupState,
} from "@/lib/pushClient";

const NUDGE_KEY = "jg_prefs_nudge_last";
const NUDGE_INTERVAL_MS = 14 * 24 * 60 * 60 * 1000; // bi-weekly
const OPEN_DELAY_MS = 2500; // let the page settle before nudging

function nudgeDue(): boolean {
  try {
    const last = Number(localStorage.getItem(NUDGE_KEY) ?? "0");
    return !Number.isFinite(last) || Date.now() - last >= NUDGE_INTERVAL_MS;
  } catch {
    return false;
  }
}

/**
 * Bi-weekly "stay in the loop" nudge. At most once every 14 days per device
 * it asks the signed-in user to turn on push notifications and to review
 * their WhatsApp preference. Self-contained: it resolves the account via
 * /api/auth/me (Clerk, leader-PIN and username+PIN sessions alike, via
 * apiFetch) and saves the WhatsApp opt-in through PATCH /api/profiles/me,
 * so it can mount on any signed-in page.
 */
export function PrefsNudgeDialog() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [pushState, setPushState] = useState<PushSetupState>("unsupported");
  const [optIn, setOptIn] = useState(false);
  const [savingOptIn, setSavingOptIn] = useState(false);
  const [enablingPush, setEnablingPush] = useState(false);
  const checked = useRef(false);

  useEffect(() => {
    if (checked.current || !nudgeDue()) return;
    checked.current = true;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      try {
        const [meRes, push] = await Promise.all([
          apiFetch("/api/auth/me"),
          getPushSetupState().catch(() => "unsupported" as const),
        ]);
        if (cancelled || !meRes.ok) return; // not signed in — never nudge
        const me = (await meRes.json()) as { whatsapp_opt_in?: boolean };
        setOptIn(!!me.whatsapp_opt_in);
        setPushState(push);
        timer = setTimeout(() => {
          // Re-check in case another tab/page showed the nudge meanwhile.
          if (cancelled || !nudgeDue()) return;
          localStorage.setItem(NUDGE_KEY, String(Date.now()));
          setOpen(true);
        }, OPEN_DELAY_MS);
      } catch {
        /* network hiccup — try again next visit */
      }
    })();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  async function handleEnablePush() {
    setEnablingPush(true);
    const result = await subscribeToPush();
    setEnablingPush(false);
    if (result === "subscribed") {
      setPushState("subscribed");
      toast({
        title: "Notifications on 🎉",
        description: "We'll let you know when check-in opens and events drop.",
      });
    } else if (result === "denied") {
      setPushState("blocked");
    } else {
      toast({
        title: "Could not enable notifications",
        description:
          result === "signed-out"
            ? "Your login on this device has expired. Log out, log back in, then try again."
            : `Please try again in a moment.${lastPushError ? ` (Details: ${lastPushError})` : ""}`,
        variant: "destructive",
      });
    }
  }

  // Optimistic toggle, same behaviour as PreferencesModal but through
  // apiFetch so username+PIN accounts (no generated-client auth) work too.
  async function handleOptInToggle(next: boolean) {
    const previous = optIn;
    setOptIn(next);
    setSavingOptIn(true);
    try {
      const res = await apiFetch("/api/profiles/me", {
        method: "PATCH",
        body: JSON.stringify({ whatsapp_opt_in: next }),
      });
      if (!res.ok) throw new Error();
      queryClient.invalidateQueries({ queryKey: getGetMyProfileQueryKey() });
      toast({ title: next ? "WhatsApp notifications on" : "WhatsApp notifications off" });
    } catch {
      setOptIn(previous);
      toast({ title: "Couldn't update preference", variant: "destructive" });
    } finally {
      setSavingOptIn(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md rounded-2xl border-border bg-popover">
        <DialogHeader>
          <DialogTitle className="font-[family-name:var(--app-font-heading)] text-xl font-semibold tracking-tight">
            Stay in the loop 🔔
          </DialogTitle>
          <DialogDescription>
            Your every-two-weeks check: make sure you hear about check-in and
            events the moment they happen.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 space-y-3">
          {pushState !== "unsupported" && (
            <div className="flex items-start justify-between gap-4 rounded-xl border border-border bg-card p-4">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <Bell className="h-4 w-4 text-primary" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    Push notifications
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {pushState === "subscribed" &&
                      "On for this device — you're all set."}
                    {pushState === "ready" &&
                      "Know when check-in opens and new events drop."}
                    {pushState === "blocked" &&
                      "Blocked in your browser settings — allow notifications for this site to turn them on."}
                    {pushState === "ios-needs-install" &&
                      "On iPhone: tap Share → Add to Home Screen, then turn notifications on from the installed app."}
                  </p>
                </div>
              </div>
              <div className="pt-0.5">
                {pushState === "subscribed" ? (
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                ) : pushState === "ready" ? (
                  <Button size="sm" onClick={handleEnablePush} disabled={enablingPush}>
                    {enablingPush ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Turn on"
                    )}
                  </Button>
                ) : null}
              </div>
            </div>
          )}

          <div className="flex items-start justify-between gap-4 rounded-xl border border-border bg-card p-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <MessageCircle className="h-4 w-4 text-primary" />
              </span>
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Event WhatsApp notifications
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Get session details, event announcements & reminders on WhatsApp.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 pt-0.5">
              {savingOptIn && (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              )}
              <Switch
                checked={optIn}
                onCheckedChange={handleOptInToggle}
                disabled={savingOptIn}
                aria-label="Toggle event WhatsApp notifications"
              />
            </div>
          </div>
        </div>

        <Button className="mt-2 w-full" onClick={() => setOpen(false)}>
          Done
        </Button>
      </DialogContent>
    </Dialog>
  );
}
