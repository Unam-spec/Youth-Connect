import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  BellRing,
  CalendarDays,
  Check,
  ChevronLeft,
  Crown,
  ListMusic,
  Loader2,
  Music,
  Send,
  SlidersHorizontal,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { worshipKeys, worshipPost, type WorshipAccount } from "@/lib/worship";
import { enableWorshipPush } from "@/lib/worshipPush";
import { InstrumentPicker } from "./ProfileDialog";
import { ChordChart } from "./songs";
import { InviteDialog } from "./InviteDialog";
import { SongFormDialog } from "./songs";

const SAMPLE = "Way [E]maker, miracle [B]worker";

type StepId = "welcome" | "profile" | "songs" | "keys" | "setlists" | "notify" | "invite";
const STEPS: StepId[] = ["welcome", "profile", "songs", "keys", "setlists", "notify", "invite"];
const ICONS: Record<StepId, typeof Music> = {
  welcome: Music,
  profile: User,
  songs: ListMusic,
  keys: SlidersHorizontal,
  setlists: CalendarDays,
  notify: BellRing,
  invite: Send,
};

function roleIntro(role: WorshipAccount["role"]): { title: string; points: string[] } {
  if (role === "owner") {
    return {
      title: "You're the head leader",
      points: [
        "You accept or decline people who ask to join",
        "You choose who's a leader, and can remove people or reset a forgotten PIN",
        "You post Sunday setlists and can fix any song in the library",
      ],
    };
  }
  if (role === "leader") {
    return {
      title: "You're a worship leader",
      points: [
        "You see everything the team sees",
        "Your extra job: accept or decline people who ask to join (you'll get a notification)",
        "You can post Sunday setlists",
      ],
    };
  }
  return {
    title: "You're on the team",
    points: [
      "Keep your own song list with your keys",
      "See everyone's songs and the Sunday setlists",
      "Get notified when the team adds songs",
    ],
  };
}

/**
 * The welcome sequence a worship member sees once, the first time they're in
 * (and any time from "Replay welcome"). Each step is actionable: set up your
 * profile, add a song, turn on notifications, invite someone.
 */
export function WorshipOnboarding({
  account,
  open,
  onOpenChange,
}: {
  account: WorshipAccount;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [index, setIndex] = useState(0);
  const [instruments, setInstruments] = useState(account.instruments);
  const [range, setRange] = useState(account.vocal_range ?? "");
  const [pushOn, setPushOn] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [songOpen, setSongOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setIndex(0);
    setInstruments(account.instruments);
    setRange(account.vocal_range ?? "");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const step = STEPS[index];
  const isLeader = account.role === "owner" || account.role === "leader";
  const intro = roleIntro(account.role);
  const first = account.full_name.split(" ")[0];

  const markDone = useMutation({
    mutationFn: () => worshipPost<{ account: WorshipAccount }>("/me/onboarded"),
    onSuccess: (r) => queryClient.setQueryData(worshipKeys.me, r.account),
  });
  const saveProfile = useMutation({
    mutationFn: () => worshipPost("/me", { instruments, vocal_range: range }, "PATCH"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["worship"] }),
    onError: (err: Error) => toast.error(err.message),
  });

  const finish = (then?: () => void) => {
    if (!account.onboarded_at) {
      // Mark it done locally first, so the next page doesn't reopen it while
      // the save is still on its way.
      queryClient.setQueryData(worshipKeys.me, { ...account, onboarded_at: new Date().toISOString() });
      markDone.mutate();
    }
    onOpenChange(false);
    then?.();
  };
  const next = async () => {
    if (step === "profile") {
      const changed =
        instruments.join() !== account.instruments.join() || range.trim() !== (account.vocal_range ?? "");
      if (changed) await saveProfile.mutateAsync().catch(() => undefined);
    }
    if (index === STEPS.length - 1) finish();
    else setIndex(index + 1);
  };

  const turnOnPush = async () => {
    const r = await enableWorshipPush();
    if (r === "subscribed") {
      setPushOn(true);
      toast.success("Notifications are on for this device.");
    } else if (r === "denied") toast.error("Notifications are blocked. Allow them in your browser settings.");
    else if (r === "ios-needs-install")
      toast.message("On iPhone: tap Share → Add to Home Screen, open the app from there, then turn these on.");
    else toast.error("Couldn't turn on notifications on this device.");
  };

  const Icon = ICONS[step];

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : finish())}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
          {/* Progress */}
          <div className="flex items-center justify-center gap-1.5 pt-1" aria-label={`Step ${index + 1} of ${STEPS.length}`}>
            {STEPS.map((s, i) => (
              <span
                key={s}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i === index ? "w-6 bg-primary" : i < index ? "w-1.5 bg-primary/60" : "w-1.5 bg-muted",
                )}
              />
            ))}
          </div>

          <div className="flex justify-center pt-2">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/15">
              <Icon className="h-7 w-7 text-primary" />
            </span>
          </div>

          {step === "welcome" && (
            <div className="space-y-4 text-center">
              <DialogTitle className="font-[family-name:var(--app-font-heading)] text-2xl">
                Welcome to the team, {first}! 🎶
              </DialogTitle>
              <DialogDescription>A quick 1-minute setup so the app works for you.</DialogDescription>
              <div className="space-y-2 rounded-xl border border-border bg-muted/40 p-4 text-left">
                <p className="flex items-center gap-1.5 text-sm font-semibold">
                  {isLeader && <Crown className="h-4 w-4 text-primary" />}
                  {intro.title}
                </p>
                <ul className="space-y-1.5">
                  {intro.points.map((p) => (
                    <li key={p} className="flex gap-2 text-sm text-muted-foreground">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {step === "profile" && (
            <div className="space-y-4">
              <div className="space-y-1 text-center">
                <DialogTitle className="font-[family-name:var(--app-font-heading)] text-xl">Set up your profile</DialogTitle>
                <DialogDescription>The team sees this when they open your profile.</DialogDescription>
              </div>
              <div className="space-y-1.5">
                <Label>What do you do on the team?</Label>
                <InstrumentPicker value={instruments} onChange={setInstruments} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ob-range">Vocal range (optional)</Label>
                <Input id="ob-range" placeholder="e.g. Alto, Tenor" value={range} onChange={(e) => setRange(e.target.value)} />
              </div>
            </div>
          )}

          {step === "songs" && (
            <div className="space-y-4 text-center">
              <DialogTitle className="font-[family-name:var(--app-font-heading)] text-xl">Your song list</DialogTitle>
              <DialogDescription>
                Add the songs you lead or play, each in <b>your</b> key. Adding a song lets the rest of the team know.
              </DialogDescription>
              <div className="grid gap-2">
                <Button onClick={() => finish(() => setSongOpen(true))}>
                  <Music className="mr-2 h-4 w-4" /> Add my first song
                </Button>
                <Button variant="outline" onClick={() => finish(() => setLocation("/worship/library"))}>
                  <ListMusic className="mr-2 h-4 w-4" /> Pick from the team's library
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Or tap Next to keep going. You can do this later.</p>
            </div>
          )}

          {step === "keys" && (
            <div className="space-y-4">
              <div className="space-y-1 text-center">
                <DialogTitle className="font-[family-name:var(--app-font-heading)] text-xl">Lyrics &amp; chords in any key</DialogTitle>
                <DialogDescription>
                  Every song opens in your key. Tap + or − to move it, or tap someone's name to see it in their key.
                </DialogDescription>
              </div>
              <div className="grid gap-2">
                <div className="rounded-xl border border-border p-3">
                  <p className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">Original · E</p>
                  <div className="text-[13px]">
                    <ChordChart lyrics={SAMPLE} steps={0} targetKey="E" />
                  </div>
                </div>
                <div className="rounded-xl border border-primary/40 bg-primary/5 p-3">
                  <p className="mb-1 text-[11px] font-semibold uppercase text-primary">Your key · G</p>
                  <div className="text-[13px]">
                    <ChordChart lyrics={SAMPLE} steps={3} targetKey="G" />
                  </div>
                </div>
              </div>
              <p className="text-center text-xs text-muted-foreground">
                Playing live? Tap <b>Stage mode</b> for big text.
              </p>
            </div>
          )}

          {step === "setlists" && (
            <div className="space-y-4 text-center">
              <DialogTitle className="font-[family-name:var(--app-font-heading)] text-xl">Sunday setlists</DialogTitle>
              <DialogDescription>
                {isLeader
                  ? "Post the songs for Sunday in order, choose who leads each one, and their key fills in. Then tap Share to WhatsApp for the group."
                  : "Your leaders post the songs for Sunday here, in order, with who's leading and the key. You'll get a notification when one goes up."}
              </DialogDescription>
              <div className="space-y-1.5 rounded-xl border border-border bg-muted/40 p-3 text-left text-sm">
                <p className="font-semibold">🎶 Setlist · Sunday</p>
                <p>1. <b>Way Maker</b> · Key: <b>D</b> · Lead: Lerato</p>
                <p>2. <b>Goodness of God</b> · Key: <b>G</b> · Lead: Thabo</p>
              </div>
              {isLeader && (
                <Button variant="outline" className="w-full" onClick={() => finish(() => setLocation("/worship/setlists"))}>
                  <CalendarDays className="mr-2 h-4 w-4" /> Go to setlists
                </Button>
              )}
            </div>
          )}

          {step === "notify" && (
            <div className="space-y-4 text-center">
              <DialogTitle className="font-[family-name:var(--app-font-heading)] text-xl">Turn on notifications</DialogTitle>
              <DialogDescription>So you know when:</DialogDescription>
              <ul className="space-y-1.5 text-left text-sm text-muted-foreground">
                {[
                  "Someone adds a song",
                  "A Sunday setlist is posted",
                  ...(isLeader ? ["Someone asks to join (you can accept them)"] : []),
                ].map((p) => (
                  <li key={p} className="flex gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    {p}
                  </li>
                ))}
              </ul>
              <Button className="w-full" onClick={turnOnPush} disabled={pushOn}>
                {pushOn ? <Check className="mr-2 h-4 w-4" /> : <BellRing className="mr-2 h-4 w-4" />}
                {pushOn ? "Notifications are on" : "Turn on notifications"}
              </Button>
              <p className="text-xs text-muted-foreground">On iPhone, add the app to your Home Screen first.</p>
            </div>
          )}

          {step === "invite" && (
            <div className="space-y-4 text-center">
              <DialogTitle className="font-[family-name:var(--app-font-heading)] text-xl">Bring the team in</DialogTitle>
              <DialogDescription>
                Know someone on the worship team? Send them the join link on WhatsApp. You can always find it under
                the ➕👤 button at the top.
              </DialogDescription>
              <Button variant="outline" className="w-full" onClick={() => setInviteOpen(true)}>
                <Send className="mr-2 h-4 w-4" /> Invite someone
              </Button>
              <p className="text-sm font-medium">You're all set, {first} 🙌</p>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-2">
            {index > 0 ? (
              <Button variant="ghost" size="sm" onClick={() => setIndex(index - 1)}>
                <ChevronLeft className="mr-1 h-4 w-4" /> Back
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => finish()}>
                Skip
              </Button>
            )}
            <Button onClick={next} disabled={saveProfile.isPending}>
              {saveProfile.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {index === STEPS.length - 1 ? "Let's go" : index === 0 ? "Get started" : "Next"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} />
      <SongFormDialog open={songOpen} onOpenChange={setSongOpen} />
    </>
  );
}
