import { useEffect, useState } from "react";
import { Bell, BellOff, Share, PlusSquare, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/api";
import {
  getPushSetupState,
  subscribeToPush,
  unsubscribeFromPush,
  type PushSetupState,
} from "@/lib/pushClient";

const DISMISS_KEY = "jg_push_card_dismissed";
// The post-check-in prompt asks again each session day until they say yes;
// "Not now" only hides it for today.
const CHECKIN_DISMISS_KEY = "jg_push_checkin_prompt_dismissed_on";
const todayKey = () => new Date().toISOString().slice(0, 10);

/**
 * Platform-aware "enable notifications" card. Hides itself when push can
 * never work here (old iOS, unsupported browsers) or after dismissal.
 *
 * context="checkin": shown right after a successful check-in — the moment
 * people are most likely to say yes. Hidden once notifications are on.
 */
export function NotificationSetupCard({ context = "default" }: { context?: "default" | "checkin" } = {}) {
  const afterCheckin = context === "checkin";
  const { toast } = useToast();
  const [state, setState] = useState<PushSetupState | "loading">("loading");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return afterCheckin
        ? localStorage.getItem(CHECKIN_DISMISS_KEY) === todayKey()
        : localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    getPushSetupState().then(setState).catch(() => setState("unsupported"));
  }, []);

  if (dismissed || state === "loading" || state === "unsupported") return null;

  const dismiss = () => {
    try {
      if (afterCheckin) localStorage.setItem(CHECKIN_DISMISS_KEY, todayKey());
      else localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* storage unavailable — just hide for now */
    }
    setDismissed(true);
  };

  const handleEnable = async () => {
    setBusy(true);
    const result = await subscribeToPush();
    setBusy(false);
    if (result === "subscribed") {
      setState("subscribed");
      toast({
        title: "Notifications on 🎉",
        description: "We'll let you know when check-in opens and events drop.",
      });
    } else if (result === "denied") {
      setState("blocked");
    } else {
      toast({
        title: "Could not enable notifications",
        description:
          result === "signed-out"
            ? "Your login on this device has expired. Log out, log back in, then try again."
            : "Please try again in a moment.",
        variant: "destructive",
      });
    }
  };

  const handleDisable = async () => {
    setBusy(true);
    await unsubscribeFromPush();
    setBusy(false);
    setState("ready");
    toast({ title: "Notifications turned off" });
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const res = await apiFetch("/api/push/test", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.sent > 0) {
        toast({
          title: "Test sent 📬",
          description: "You should get a notification on this device in a few seconds.",
        });
      } else {
        toast({
          title: "Test could not be delivered",
          description: "Try turning notifications off and on again, then resend.",
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: "Test failed",
        description: "Network error — please try again.",
        variant: "destructive",
      });
    } finally {
      setTesting(false);
    }
  };

  if (state === "subscribed") {
    if (afterCheckin) return null;
    return (
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Bell className="h-4 w-4 text-primary" />
            Notifications are on for this device.
          </p>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={handleTest} disabled={testing || busy}>
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              <span className="ml-1">Send test</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={handleDisable} disabled={busy || testing}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellOff className="h-4 w-4" />}
              <span className="ml-1">Turn off</span>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (state === "blocked") {
    return (
      <Card className="border-border">
        <CardContent className="flex items-center justify-between gap-3 py-3">
          <p className="text-sm text-muted-foreground">
            Notifications are blocked for this site. Enable them in your
            browser settings to hear when check-in opens.
          </p>
          <Button variant="ghost" size="sm" onClick={dismiss}>
            Dismiss
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (state === "ios-needs-install") {
    return (
      <Card className="border-primary/30">
        <CardContent className="space-y-3 py-4">
          <p className="flex items-center gap-2 font-medium text-foreground">
            <Bell className="h-4 w-4 text-primary" />
            Get notified when check-in opens
          </p>
          <ol className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-center gap-2">
              <Share className="h-4 w-4 shrink-0 text-primary" />
              1. Tap the <strong>Share</strong> button in Safari
            </li>
            <li className="flex items-center gap-2">
              <PlusSquare className="h-4 w-4 shrink-0 text-primary" />
              2. Choose <strong>Add to Home Screen</strong>
            </li>
            <li className="flex items-center gap-2">
              <Bell className="h-4 w-4 shrink-0 text-primary" />
              3. Open <strong>JG Youth</strong> from your home screen and turn
              on notifications here
            </li>
          </ol>
          <p className="text-xs text-muted-foreground">Needs iOS 16.4 or newer.</p>
          <Button variant="ghost" size="sm" onClick={dismiss}>
            Not now
          </Button>
        </CardContent>
      </Card>
    );
  }

  // state === "ready"
  return (
    <Card className="border-primary/30">
      <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="flex items-center gap-2 font-medium text-foreground">
            <Bell className="h-4 w-4 text-primary" />
            {afterCheckin ? "Want a reminder next Friday?" : "Never miss check-in"}
          </p>
          <p className="text-sm text-muted-foreground">
            {afterCheckin
              ? "Turn on notifications and we'll tell you when youth is on and when check-in opens."
              : "Get a notification when check-in opens and when new events drop."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={handleEnable} disabled={busy}>
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Bell className="mr-1 h-4 w-4" />}
            Enable notifications
          </Button>
          <Button variant="ghost" size="sm" onClick={dismiss}>
            Not now
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
