import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeftRight,
  BellRing,
  CalendarDays,
  Check,
  ChevronLeft,
  Crown,
  Globe,
  ListMusic,
  Loader2,
  MonitorPlay,
  Music,
  Navigation,
  Send,
  SlidersHorizontal,
  Sparkles,
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

type StepId =
  | "news"
  | "welcome"
  | "profile"
  | "songs"
  | "keys"
  | "setlists"
  | "freeshow"
  | "notify"
  | "around"
  | "invite";
/** The full welcome, for someone's first time in. */
const FULL_STEPS: StepId[] = ["welcome", "profile", "songs", "keys", "setlists", "freeshow", "notify", "around", "invite"];
/** For people who did the welcome before these features: just what changed. */
const NEWS_STEPS: StepId[] = ["news", "songs", "setlists", "freeshow", "around"];
const ICONS: Record<StepId, typeof Music> = {
  news: Sparkles,
  welcome: Music,
  profile: User,
  songs: ListMusic,
  keys: SlidersHorizontal,
  setlists: CalendarDays,
  freeshow: MonitorPlay,
  notify: BellRing,
  around: Navigation,
  invite: Send,
};

/**
 * Bump when the welcome gains steps people who already did it should see.
 * Seen versions are kept per device and person, like the JG Youth tours.
 */
export const WELCOME_VERSION = 2;
/** People onboarded after this already saw version 2's steps. */
const VERSION_2_SINCE = "2026-11-05T00:00:00Z";
const seenKey = (accountId: string) => `jg_worship_welcome_seen_${accountId}`;

function markSeen(accountId: string) {
  try {
    localStorage.setItem(seenKey(accountId), String(WELCOME_VERSION));
  } catch {
    /* private mode: they may see "What's new" again, which is harmless */
  }
}

/** Which welcome to open by itself: the full one, "What's new", or none. */
export function welcomeToShow(account: WorshipAccount): "full" | "news" | null {
  if (!account.onboarded_at) return "full";
  if (account.onboarded_at >= VERSION_2_SINCE) return null;
  try {
    return Number(localStorage.getItem(seenKey(account.id)) ?? 0) >= WELCOME_VERSION ? null : "news";
  } catch {
    return null;
  }
}

function Points({ items }: { items: { icon?: typeof Music; text: ReactNode }[] }) {
  return (
    <ul className="space-y-2 text-left text-sm text-muted-foreground">
      {items.map(({ icon: I = Check, text }, i) => (
        <li key={i} className="flex gap-2">
          <I className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span>{text}</span>
        </li>
      ))}
    </ul>
  );
}

function roleIntro(role: WorshipAccount["role"]): { title: string; points: string[] } {
  if (role === "owner") {
    return {
      title: "You're the head leader",
      points: [
        "You accept or decline people who ask to join",
        "You choose who's a leader, and can remove people or reset a forgotten PIN",
        "You post Sunday setlists, import songs from FreeShow, and can fix or move any song",
      ],
    };
  }
  if (role === "leader") {
    return {
      title: "You're a worship leader",
      points: [
        "You see everything the team sees",
        "Your extra job: accept or decline people who ask to join (you'll get a notification)",
        "You can post Sunday setlists and import songs from FreeShow",
      ],
    };
  }
  return {
    title: "You're on the team",
    points: [
      "Keep your own song list, each song in your key",
      "See everyone's songs and the Sunday setlists, and share them",
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
  mode = "full",
}: {
  account: WorshipAccount;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  mode?: "full" | "news";
}) {
  const STEPS = mode === "news" ? NEWS_STEPS : FULL_STEPS;
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
    markSeen(account.id);
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

          {step === "news" && (
            <div className="space-y-4 text-center">
              <DialogTitle className="font-[family-name:var(--app-font-heading)] text-2xl">
                What's new, {first} ✨
              </DialogTitle>
              <DialogDescription>A few things have landed since you joined. Here's a 30-second look.</DialogDescription>
              <div className="rounded-xl border border-border bg-muted/40 p-4">
                <Points
                  items={[
                    { icon: Globe, text: <><b>Find it online</b>: type a song name or paste a link, and the lyrics and chords fill in</> },
                    { icon: ArrowLeftRight, text: <><b>One person per song</b>: pick unassigned songs, transfer or give them back</> },
                    {
                      icon: CalendarDays,
                      text: isLeader ? (
                        <>Search songs when building a setlist, and share it to WhatsApp</>
                      ) : (
                        <>Share any Sunday setlist to WhatsApp</>
                      ),
                    },
                    {
                      icon: MonitorPlay,
                      text: isLeader ? (
                        <><b>FreeShow</b>: bring your songs in, and send setlists out</>
                      ) : (
                        <><b>FreeShow</b>: download any setlist, ready to open in FreeShow</>
                      ),
                    },
                    { icon: Navigation, text: <>Back buttons everywhere, and Forgot PIN on the sign-in page</> },
                  ]}
                />
              </div>
            </div>
          )}

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
                Add the songs you lead or play, each in <b>your</b> key. The team gets a notification.
              </DialogDescription>
              <Points
                items={[
                  {
                    icon: Globe,
                    text: (
                      <>
                        <b>Find it online</b>: in New song, type the song name or paste a link (e.g. Ultimate Guitar).
                        Title, artist, key, lyrics and chords fill in for you.
                      </>
                    ),
                  },
                  {
                    icon: ListMusic,
                    text: (
                      <>
                        <b>One person per song.</b> Songs nobody has yet are <b>Unassigned</b> in the library. Tap
                        Pick and it's yours.
                      </>
                    ),
                  },
                  {
                    icon: ArrowLeftRight,
                    text: (
                      <>
                        Open your song to <b>Transfer</b> it to someone else, or <b>Give it back</b>.
                      </>
                    ),
                  },
                ]}
              />
              <div className="grid gap-2">
                <Button onClick={() => finish(() => setSongOpen(true))}>
                  <Music className="mr-2 h-4 w-4" /> Add a song
                </Button>
                <Button variant="outline" onClick={() => finish(() => setLocation("/worship/library"))}>
                  <ListMusic className="mr-2 h-4 w-4" /> Pick an unassigned song
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
                  ? "Post the songs for Sunday: search the library to add them, put them in order and choose who leads each one. Their key fills in."
                  : "Your leaders post the songs for Sunday here, in order, with who's leading and the key. You'll get a notification when one goes up."}
              </DialogDescription>
              <div className="space-y-1.5 rounded-xl border border-border bg-muted/40 p-3 text-left text-sm">
                <p className="font-semibold">🎶 Setlist · Sunday</p>
                <p>1. <b>Way Maker</b> · Key: <b>D</b> · Lead: Lerato</p>
                <p>2. <b>Goodness of God</b> · Key: <b>G</b> · Lead: Thabo</p>
              </div>
              <p className="text-sm text-muted-foreground">
                Open any setlist and tap <b>Share to WhatsApp</b> to send it to the group, with a link to the chords.
              </p>
              {isLeader && (
                <Button variant="outline" className="w-full" onClick={() => finish(() => setLocation("/worship/setlists"))}>
                  <CalendarDays className="mr-2 h-4 w-4" /> Go to setlists
                </Button>
              )}
            </div>
          )}

          {step === "freeshow" && (
            <div className="space-y-4 text-center">
              <DialogTitle className="font-[family-name:var(--app-font-heading)] text-xl">Using FreeShow?</DialogTitle>
              <DialogDescription>The app and FreeShow on the church laptop work together.</DialogDescription>
              <Points
                items={[
                  {
                    icon: MonitorPlay,
                    text: (
                      <>
                        <b>Download for FreeShow</b> on any setlist: every song in its Sunday key, chords and all. In
                        FreeShow, choose <b>Import → FreeShow project</b>.
                      </>
                    ),
                  },
                  ...(isLeader
                    ? [
                        {
                          icon: ListMusic,
                          text: (
                            <>
                              <b>Import from FreeShow</b>: on the Songs page, tap <b>FreeShow</b> and pick the Shows
                              folder (Documents → FreeShow → Shows). Every song lands in the library as unassigned, and
                              ones already there are skipped.
                            </>
                          ),
                        },
                      ]
                    : []),
                ]}
              />
              {isLeader && (
                <Button variant="outline" className="w-full" onClick={() => finish(() => setLocation("/worship/library"))}>
                  <ListMusic className="mr-2 h-4 w-4" /> Go to Songs
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
                  "Someone transfers a song to you",
                  "A Sunday setlist is posted",
                  ...(isLeader ? ["Someone asks to join (you can accept them)"] : []),
                  ...(account.role === "owner" ? ["Someone forgets their PIN (tap it to reset and send them a new one)"] : []),
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

          {step === "around" && (
            <div className="space-y-4 text-center">
              <DialogTitle className="font-[family-name:var(--app-font-heading)] text-xl">Getting around</DialogTitle>
              <Points
                items={[
                  {
                    icon: ChevronLeft,
                    text: (
                      <>
                        The <b>‹</b> at the top left goes back to the JG Youth home page. You stay signed in.
                      </>
                    ),
                  },
                  { icon: Navigation, text: <>Every page has a <b>Back</b> button to where you came from.</> },
                  {
                    icon: Check,
                    text: <>You stay signed in for 30 days, and the app reopens where you left off.</>,
                  },
                  {
                    icon: User,
                    text:
                      account.role === "owner" ? (
                        <>
                          If someone taps <b>Forgot PIN</b>, you'll get the request. Reset it from their name on the
                          team page and send them the new PIN on WhatsApp.
                        </>
                      ) : (
                        <>
                          Forgot your PIN? Tap <b>Forgot PIN</b> on the sign-in page. The head leader gets the request
                          and sends you a new one.
                        </>
                      ),
                  },
                ]}
              />
              {mode === "news" && <p className="text-sm font-medium">That's it, {first} 🙌</p>}
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
              {index === STEPS.length - 1
                ? mode === "news"
                  ? "Got it"
                  : "Let's go"
                : index === 0
                  ? mode === "news"
                    ? "Show me"
                    : "Get started"
                  : "Next"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} />
      <SongFormDialog open={songOpen} onOpenChange={setSongOpen} />
    </>
  );
}
