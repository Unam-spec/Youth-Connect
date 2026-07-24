import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PinInput } from "@/components/ui/pin-input";
import { Badge } from "@/components/ui/badge";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { getPinSession, clearPinSession } from "@/lib/pinSession";
import { apiFetch } from "@/lib/api";
import { computeAge, todaySAST } from "@/lib/age";
import { CheckCircle, Clock, LogOut, Loader2, Cake, CalendarDays, MapPin, GraduationCap } from "lucide-react";
import { useLocation } from "wouter";
import { PhoneInput } from "@/components/ui/phone-input";
import { NotificationSetupCard } from "@/components/member/NotificationSetupCard";
import { PrefsNudgeDialog } from "@/components/member/PrefsNudgeDialog";
import { StreakWidget } from "@/components/member/StreakWidget";

interface Me { id: string; full_name: string; username: string | null; role: string; age: number | null; date_of_birth: string | null; school?: string | null; phone?: string | null; avatar_url?: string | null; }
interface EventRow { id: string; title: string; date: string; time: string | null; location: string | null; }
interface ScheduleWindow { day_of_week: number; start_time: string; end_time: string; enabled: boolean; }
interface Schedule { restrict_to_schedule: boolean; windows: ScheduleWindow[]; }
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const pinSchema = z
  .object({
    pin: z.string().regex(/^\d{4,6}$/, "PIN must be 4-6 digits"),
    confirm_pin: z.string(),
  })
  .refine((d) => d.pin === d.confirm_pin, { message: "PINs do not match", path: ["confirm_pin"] });
type PinForm = z.infer<typeof pinSchema>;

export default function AccountHome() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkingIn, setCheckingIn] = useState(false);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  // Member-only extras (visitors never load these).
  const [sessionDates, setSessionDates] = useState<string[]>([]);
  const [myRsvps, setMyRsvps] = useState<Record<string, string>>({});
  const [savingRsvp, setSavingRsvp] = useState<string | null>(null);
  const [detailsDraft, setDetailsDraft] = useState<{ school: string; phone: string }>({ school: "", phone: "" });
  const [savingDetails, setSavingDetails] = useState(false);

  useEffect(() => {
    const session = getPinSession();
    if (!session) {
      setLocation("/pin-login", { replace: true });
      return;
    }
    (async () => {
      try {
        const res = await apiFetch("/api/auth/me");
        if (res.ok) {
          setMe(await res.json());
        } else if (res.status === 401) {
          clearPinSession();
          setLocation("/pin-login", { replace: true });
        }
      } finally {
        setLoading(false);
      }
    })();
    // Check-in schedule is a public read.
    fetch("/api/checkin/schedule")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data) setSchedule(data); })
      .catch(() => {});
    // Upcoming public events (public read).
    fetch("/api/events?public_only=true&upcoming=true")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: EventRow[]) => setEvents(Array.isArray(rows) ? rows.slice(0, 4) : []))
      .catch(() => {});
  }, [setLocation]);

  // Once we know the caller is a member, load the richer member data that the
  // basic visitor view never needs: attendance (for the streak) and RSVPs.
  useEffect(() => {
    if (me?.role !== "member") return;
    setDetailsDraft({ school: me.school ?? "", phone: me.phone ?? "" });
    apiFetch("/api/attendance/my")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: { session_date: string }[]) =>
        setSessionDates(Array.isArray(rows) ? rows.map((r) => r.session_date).filter(Boolean) : []),
      )
      .catch(() => {});
    apiFetch("/api/rsvps/my")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: { event_id: string; status: string }[]) => {
        const map: Record<string, string> = {};
        if (Array.isArray(rows)) for (const r of rows) map[r.event_id] = r.status;
        setMyRsvps(map);
      })
      .catch(() => {});
  }, [me?.role, me?.id]);

  async function handleRsvp(eventId: string, status: "going" | "not_going") {
    setSavingRsvp(eventId);
    try {
      const res = await apiFetch(`/api/rsvps/${eventId}`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        setMyRsvps((m) => ({ ...m, [eventId]: status }));
        toast({ title: status === "going" ? "You're going 🎉" : "RSVP updated" });
      } else {
        toast({ title: "Could not RSVP", description: "Please try again.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Network error", description: "Please try again.", variant: "destructive" });
    } finally {
      setSavingRsvp(null);
    }
  }

  async function saveDetails() {
    setSavingDetails(true);
    try {
      const res = await apiFetch("/api/profiles/me", {
        method: "PATCH",
        body: JSON.stringify({ school: detailsDraft.school, phone: detailsDraft.phone }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setMe((m) => (m ? { ...m, school: detailsDraft.school, phone: detailsDraft.phone } : m));
        toast({ title: "Details saved" });
      } else {
        toast({ title: "Could not save details", description: data.error ?? "Please try again.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Network error", description: "Please try again.", variant: "destructive" });
    } finally {
      setSavingDetails(false);
    }
  }

  const openWindows = (schedule?.windows ?? []).filter(
    (w) => w.enabled && w.start_time && w.end_time,
  );

  async function handleCheckIn() {
    setCheckingIn(true);
    try {
      const res = await apiFetch("/api/checkin/requests", { method: "POST", body: JSON.stringify({}) });
      const data = await res.json().catch(() => ({}));
      if (res.status === 200 || res.status === 201) {
        toast({ title: data.status === "approved" ? "Checked in!" : "Check-in submitted", description: data.message });
      } else if (res.status === 409) {
        toast({ title: "Already checked in", description: data.error });
      } else if (res.status === 403) {
        toast({ title: "Check-in closed", description: data.error, variant: "destructive" });
      } else {
        toast({ title: "Could not check in", description: data.error ?? "Please try again.", variant: "destructive" });
      }
    } finally {
      setCheckingIn(false);
    }
  }

  const [dobDraft, setDobDraft] = useState("");
  const [savingDob, setSavingDob] = useState(false);

  async function saveBirthday() {
    if (!dobDraft) return;
    setSavingDob(true);
    try {
      const res = await apiFetch("/api/profiles/me", {
        method: "PATCH",
        body: JSON.stringify({ date_of_birth: dobDraft }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setMe((m) => (m ? { ...m, date_of_birth: dobDraft, age: computeAge(dobDraft) } : m));
        setDobDraft("");
        toast({ title: "Birthday saved" });
      } else {
        toast({ title: "Could not save birthday", description: data.error ?? "Please try again.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Network error", description: "Please try again.", variant: "destructive" });
    } finally {
      setSavingDob(false);
    }
  }

  const pinForm = useForm<PinForm>({ resolver: zodResolver(pinSchema), defaultValues: { pin: "", confirm_pin: "" } });
  async function onChangePin(values: PinForm) {
    const res = await apiFetch("/api/auth/pin", { method: "PATCH", body: JSON.stringify({ pin: values.pin }) });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      toast({ title: "PIN updated" });
      pinForm.reset();
    } else {
      toast({ title: "Could not update PIN", description: data.error ?? "Please try again.", variant: "destructive" });
    }
  }

  function logout() {
    clearPinSession();
    setLocation("/");
  }

  if (loading) {
    return (
      <Layout>
        <div className="max-w-md mx-auto py-12 flex justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-md mx-auto py-10 space-y-6">
        <Card className="border border-border bg-card rounded-2xl overflow-hidden">
          <div className="h-1.5 w-full bg-primary" />
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-2xl font-semibold">{me?.full_name}</CardTitle>
                <CardDescription>@{me?.username}</CardDescription>
              </div>
              <Badge variant="outline" className={me?.role === "member" ? "bg-primary/10 text-primary border-primary/25" : "bg-muted text-muted-foreground border-border"}>
                {me?.role === "member" ? "Member" : "Visitor"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {me?.role !== "member" && (
              <p className="text-sm text-muted-foreground">
                You're checked in as a visitor. A leader can upgrade you to full member.
              </p>
            )}
            <Button onClick={handleCheckIn} disabled={checkingIn} className="w-full h-12">
              {checkingIn ? <Loader2 className="w-4 h-4 animate-spin" /> : <><CheckCircle className="w-4 h-4 mr-2" /> Check in</>}
            </Button>
          </CardContent>
        </Card>

        <NotificationSetupCard />

        {me?.role === "member" && <StreakWidget sessionDates={sessionDates} />}

        <Card className="border border-border bg-card rounded-2xl">
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" /> Check-in times
            </CardTitle>
          </CardHeader>
          <CardContent>
            {openWindows.length > 0 ? (
              <ul className="space-y-1.5 text-sm">
                {openWindows.map((w) => (
                  <li key={w.day_of_week} className="flex justify-between">
                    <span className="text-muted-foreground">{DAY_NAMES[w.day_of_week]}</span>
                    <span className="font-medium tabular-nums">{w.start_time}–{w.end_time}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Check-in times will appear here.</p>
            )}
          </CardContent>
        </Card>

        <Card className="border border-border bg-card rounded-2xl">
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-primary" /> Upcoming events
            </CardTitle>
          </CardHeader>
          <CardContent>
            {events.length > 0 ? (
              <ul className="space-y-3">
                {events.map((e) => (
                  <li key={e.id} className="rounded-xl border border-border/60 px-3 py-2.5">
                    <p className="font-medium text-sm">{e.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {e.date}
                      {e.time ? ` · ${e.time}` : ""}
                      {e.location ? (
                        <span className="inline-flex items-center gap-1 ml-2">
                          <MapPin className="w-3 h-3" /> {e.location}
                        </span>
                      ) : null}
                    </p>
                    {me?.role === "member" && (
                      <div className="mt-2 flex gap-2">
                        <Button
                          size="sm"
                          variant={myRsvps[e.id] === "going" ? "default" : "outline"}
                          className="h-8 flex-1"
                          disabled={savingRsvp === e.id}
                          onClick={() => handleRsvp(e.id, "going")}
                        >
                          {savingRsvp === e.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "I'm going"}
                        </Button>
                        <Button
                          size="sm"
                          variant={myRsvps[e.id] === "not_going" ? "secondary" : "outline"}
                          className="h-8 flex-1"
                          disabled={savingRsvp === e.id}
                          onClick={() => handleRsvp(e.id, "not_going")}
                        >
                          Can't make it
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No upcoming events yet — check back soon.</p>
            )}
          </CardContent>
        </Card>

        <Card className="border border-border bg-card rounded-2xl">
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Cake className="w-4 h-4 text-primary" /> Your birthday
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {me?.date_of_birth ? (
              <p className="text-sm">
                <span className="font-medium tabular-nums">{me.date_of_birth}</span>
                {me.age !== null && (
                  <span className="text-muted-foreground"> · {me.age} years old</span>
                )}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Add your birthday so we get your age right.
              </p>
            )}
            <div className="flex gap-2">
              <Input
                type="date"
                max={todaySAST()}
                className="h-11"
                value={dobDraft}
                onChange={(e) => setDobDraft(e.target.value)}
              />
              <Button
                variant="outline"
                className="h-11 shrink-0"
                onClick={saveBirthday}
                disabled={!dobDraft || savingDob}
              >
                {savingDob ? <Loader2 className="w-4 h-4 animate-spin" /> : me?.date_of_birth ? "Update" : "Save"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {me?.role === "member" && (
          <Card className="border border-border bg-card rounded-2xl">
            <CardHeader>
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <GraduationCap className="w-4 h-4 text-primary" /> Your details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">School</label>
                <Input
                  className="h-11"
                  placeholder="Your school"
                  value={detailsDraft.school}
                  onChange={(e) => setDetailsDraft((d) => ({ ...d, school: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Phone</label>
                <PhoneInput
                  value={detailsDraft.phone}
                  onChange={(v) => setDetailsDraft((d) => ({ ...d, phone: v }))}
                />
              </div>
              <Button
                variant="outline"
                className="w-full h-11"
                onClick={saveDetails}
                disabled={savingDetails}
              >
                {savingDetails ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save details"}
              </Button>
            </CardContent>
          </Card>
        )}

        <Card className="border border-border bg-card rounded-2xl">
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" /> Change your PIN
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Form {...pinForm}>
              <form onSubmit={pinForm.handleSubmit(onChangePin)} className="space-y-4">
                <FormField control={pinForm.control} name="pin" render={({ field }) => (
                  <FormItem>
                    <FormLabel>New PIN</FormLabel>
                    <FormControl><PinInput maxLength={6} className="h-12" placeholder="••••" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={pinForm.control} name="confirm_pin" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm new PIN</FormLabel>
                    <FormControl><PinInput maxLength={6} className="h-12" placeholder="••••" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <Button type="submit" variant="outline" className="w-full h-11" disabled={pinForm.formState.isSubmitting}>
                  Update PIN
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>

        <Button variant="ghost" className="w-full text-muted-foreground" onClick={logout}>
          <LogOut className="w-4 h-4 mr-2" /> Log out
        </Button>
      </div>
      <PrefsNudgeDialog />
    </Layout>
  );
}
