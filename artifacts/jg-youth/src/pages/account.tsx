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
import { Badge } from "@/components/ui/badge";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { getPinSession, clearPinSession } from "@/lib/pinSession";
import { apiFetch } from "@/lib/api";
import { CheckCircle, Clock, LogOut, Loader2 } from "lucide-react";
import { useLocation } from "wouter";

interface Me { id: string; full_name: string; username: string | null; role: string; age: number | null; }
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
  }, [setLocation]);

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
              <Clock className="w-4 h-4 text-primary" /> Change your PIN
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Form {...pinForm}>
              <form onSubmit={pinForm.handleSubmit(onChangePin)} className="space-y-4">
                <FormField control={pinForm.control} name="pin" render={({ field }) => (
                  <FormItem>
                    <FormLabel>New PIN</FormLabel>
                    <FormControl><Input className="h-12 text-center tracking-[0.5em] font-mono" type="password" inputMode="numeric" maxLength={6} placeholder="••••" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={pinForm.control} name="confirm_pin" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm new PIN</FormLabel>
                    <FormControl><Input className="h-12 text-center tracking-[0.5em] font-mono" type="password" inputMode="numeric" maxLength={6} placeholder="••••" {...field} /></FormControl>
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
    </Layout>
  );
}
