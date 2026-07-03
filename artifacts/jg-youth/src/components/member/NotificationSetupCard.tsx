import { useEffect, useState } from "react";
import { Bell, BellOff, Share, PlusSquare, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  getPushSetupState,
  subscribeToPush,
  unsubscribeFromPush,
  type PushSetupState,
} from "@/lib/pushClient";

const DISMISS_KEY = "jg_push_card_dismissed";

/**
 * Platform-aware "enable notifications" card. Hides itself when push can
 * never work here (old iOS, unsupported browsers) or after dismissal.
 */
export function NotificationSetupCard() {
  const { toast } = useToast();
  const [state, setState] = useState<PushSetupState | "loading">("loading");
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISS_KEY) === "1",
  );

  useEffect(() => {
    getPushSetupState().then(setState).catch(() => setState("unsupported"));
  }, []);

  if (dismissed || state === "loading" || state === "unsupported") return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
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
        description: "Please try again in a moment.",
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

  if (state === "subscribed") {
    return (
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="flex items-center justify-between gap-3 py-3">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Bell className="h-4 w-4 text-primary" />
            Notifications are on for this device.
          </p>
          <Button variant="ghost" size="sm" onClick={handleDisable} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellOff className="h-4 w-4" />}
            <span className="ml-1">Turn off</span>
          </Button>
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
            Never miss check-in
          </p>
          <p className="text-sm text-muted-foreground">
            Get a notification when check-in opens and when new events drop.
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
