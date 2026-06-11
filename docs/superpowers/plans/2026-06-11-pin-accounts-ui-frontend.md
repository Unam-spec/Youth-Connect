# PIN Accounts UI — Frontend (React) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the React UI for username+PIN accounts in `artifacts/jg-youth` — signup, login, a kid `/account` home, and a leader management panel — consuming the already-built backend endpoints, without disturbing the Clerk (email) or leader flows.

**Architecture:** New pages (`pin-signup`, `pin-login`, `account`) and one dashboard panel (`PinAccountsPanel`), wired with a new `pinSession` localStorage identity (separate from the leader session) that `apiFetch` attaches as `x-leader-session`. All calls use `fetch`/`apiFetch` (these endpoints aren't in the generated client). Mirrors existing patterns: `leader-login.tsx` (forms), `PinManagementPanel.tsx` + `shared.tsx` (panels), shadcn/ui + dark theme.

**Tech Stack:** React, wouter, shadcn/ui, react-hook-form + zod, @tanstack/react-query (only where already used), lucide-react.

**Verification:** `cd artifacts/jg-youth && npm run typecheck` (`tsc --noEmit`) after each task; final `npm run build`. This app has no unit-test runner (consistent with the codebase), so correctness is typecheck + a manual click-through at the end.

**Depends on (already merged/done):** `POST /api/auth/pin-signup`, `POST /api/auth/pin-login`, `PATCH /api/auth/pin`, `GET /api/auth/me`, `GET /api/pin-accounts`, `POST /api/pin-accounts/:id/grant-membership` (accepts `parent_name`/`parent_phone`), `POST /api/pin-accounts/:id/reset-pin`, `GET /api/checkin/schedule`, `GET /api/events`. Backend returns **401** (not 404) for authed-but-profileless check-in.

---

## File Structure

- Create: `src/lib/pinSession.ts` — kid PIN session storage (mirrors `lib/auth.ts`).
- Modify: `src/lib/api.ts` — attach pin session as `x-leader-session` when no leader session.
- Create: `src/pages/pin-signup.tsx`, `src/pages/pin-login.tsx`, `src/pages/account.tsx`.
- Modify: `src/App.tsx` — three new routes.
- Modify: `src/pages/home.tsx` — a "No email? Use a username" link.
- Create: `src/components/panels/PinAccountsPanel.tsx` — self-contained leader panel (list + promote + reset dialogs).
- Modify: `src/pages/dashboard.tsx` — render `<PinAccountsPanel />` in the members tab.

All paths are under `artifacts/jg-youth/`.

---

## Phase 1 — Auth plumbing

### Task 1: `pinSession` storage

**Files:**
- Create: `artifacts/jg-youth/src/lib/pinSession.ts`

- [ ] **Step 1: Create the file**

```ts
export interface PinSession {
  role: "visitor" | "member";
  profile_id: string;
  session_token: string;
  username?: string;
  expires_at: number;
}

export function setPinSession(session: Omit<PinSession, "expires_at">): void {
  const expires_at = Date.now() + 8 * 60 * 60 * 1000; // 8 hours
  localStorage.setItem("jg_pin_session", JSON.stringify({ ...session, expires_at }));
}

export function getPinSession(): PinSession | null {
  const raw = localStorage.getItem("jg_pin_session");
  if (!raw) return null;
  try {
    const session: PinSession = JSON.parse(raw);
    if (Date.now() > session.expires_at) {
      localStorage.removeItem("jg_pin_session");
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function clearPinSession(): void {
  localStorage.removeItem("jg_pin_session");
}
```

- [ ] **Step 2: Typecheck**

Run: `cd artifacts/jg-youth && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add artifacts/jg-youth/src/lib/pinSession.ts
git commit -m "feat(web): pinSession localStorage helpers for kid PIN accounts"
```

### Task 2: Attach pin session in `apiFetch`

**Files:**
- Modify: `artifacts/jg-youth/src/lib/api.ts`

- [ ] **Step 1: Add the import**

At the top of `artifacts/jg-youth/src/lib/api.ts`, after `import { getLeaderSession } from "./auth";`, add:

```ts
import { getPinSession } from "./pinSession";
```

- [ ] **Step 2: Update both session-attach blocks**

There are TWO identical blocks (one in `apiFetch`, one in `useApiFetch`). In BOTH, replace this exact block:

```ts
  // Add leader session for super admin authentication
  const leaderSession = getLeaderSession();
  if (leaderSession) {
    headers["x-leader-session"] = JSON.stringify(leaderSession);
  }
```

with:

```ts
  // Attach a PIN session header: leaders use the leader session; username+PIN
  // kids use the pin session. The backend validates either against
  // profiles.session_token.
  const leaderSession = getLeaderSession();
  if (leaderSession) {
    headers["x-leader-session"] = JSON.stringify(leaderSession);
  } else {
    const pinSession = getPinSession();
    if (pinSession) {
      headers["x-leader-session"] = JSON.stringify({
        profile_id: pinSession.profile_id,
        session_token: pinSession.session_token,
        expires_at: pinSession.expires_at,
      });
    }
  }
```

- [ ] **Step 3: Typecheck**

Run: `cd artifacts/jg-youth && npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add artifacts/jg-youth/src/lib/api.ts
git commit -m "feat(web): apiFetch attaches kid pin session as x-leader-session"
```

---

## Phase 2 — Signup & login pages + routing

### Task 3: `PinSignup` page

**Files:**
- Create: `artifacts/jg-youth/src/pages/pin-signup.tsx`

- [ ] **Step 1: Create the page**

```tsx
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState } from "react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { setPinSession } from "@/lib/pinSession";
import { ChevronLeft, UserPlus } from "lucide-react";
import { Link, useLocation } from "wouter";

const schema = z
  .object({
    full_name: z.string().min(1, "Your name is required").max(120),
    username: z
      .string()
      .min(3, "3-20 characters")
      .max(20, "3-20 characters")
      .regex(/^[a-zA-Z0-9_]+$/, "Letters, numbers, or underscore only"),
    age: z
      .string()
      .regex(/^\d{1,3}$/, "Enter your age")
      .refine((v) => Number(v) >= 1 && Number(v) <= 120, "Age must be 1-120"),
    pin: z.string().regex(/^\d{4,6}$/, "PIN must be 4-6 digits"),
    confirm_pin: z.string(),
  })
  .refine((d) => d.pin === d.confirm_pin, {
    message: "PINs do not match",
    path: ["confirm_pin"],
  });

type FormValues = z.infer<typeof schema>;

export default function PinSignup() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { full_name: "", username: "", age: "", pin: "", confirm_pin: "" },
  });

  async function onSubmit(values: FormValues) {
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/pin-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: values.full_name,
          username: values.username,
          pin: values.pin,
          age: Number(values.age),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 201) {
        setPinSession({
          role: "visitor",
          profile_id: data.profile_id,
          session_token: data.session_token,
          username: String(values.username).trim().toLowerCase(),
        });
        toast({ title: "Account created!" });
        setLocation("/account");
        return;
      }
      if (res.status === 409) {
        form.setError("username", { message: "That username is already taken." });
        return;
      }
      toast({ title: "Sign up failed", description: data.error ?? "Please try again.", variant: "destructive" });
    } catch {
      toast({ title: "Network error", description: "Please try again.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Layout>
      <div className="max-w-md mx-auto py-12">
        <div className="mb-6">
          <Link href="/">
            <Button variant="ghost" size="sm" className="-ml-3 text-muted-foreground">
              <ChevronLeft className="w-4 h-4 mr-1" />
              Back
            </Button>
          </Link>
        </div>
        <Card className="border border-border bg-card rounded-2xl overflow-hidden">
          <div className="h-1.5 w-full bg-primary" />
          <CardHeader className="text-center pt-8">
            <div className="mx-auto w-12 h-12 bg-primary/10 border border-primary/20 rounded-full flex items-center justify-center mb-4">
              <UserPlus className="w-6 h-6 text-primary" />
            </div>
            <CardTitle className="text-2xl font-semibold tracking-tight">Create an account</CardTitle>
            <CardDescription>No email needed — pick a username and a PIN.</CardDescription>
          </CardHeader>
          <CardContent className="pb-8">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField control={form.control} name="full_name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Your name</FormLabel>
                    <FormControl><Input className="h-12" placeholder="Thandi K" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="username" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Username</FormLabel>
                    <FormControl><Input className="h-12" placeholder="thandi_k" autoCapitalize="none" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="age" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Age</FormLabel>
                    <FormControl><Input className="h-12" type="number" inputMode="numeric" placeholder="13" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="pin" render={({ field }) => (
                  <FormItem>
                    <FormLabel>PIN (4-6 digits)</FormLabel>
                    <FormControl><Input className="h-12 text-center text-lg tracking-[0.5em] font-mono" type="password" inputMode="numeric" maxLength={6} placeholder="••••" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="confirm_pin" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm PIN</FormLabel>
                    <FormControl><Input className="h-12 text-center text-lg tracking-[0.5em] font-mono" type="password" inputMode="numeric" maxLength={6} placeholder="••••" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <Button type="submit" className="w-full h-12 mt-2" disabled={submitting}>
                  {submitting ? "Creating..." : "Create account"}
                </Button>
              </form>
            </Form>
            <p className="text-center text-sm text-muted-foreground mt-6">
              Have an account?{" "}
              <Link href="/pin-login" className="text-primary font-medium">Log in</Link>
            </p>
            <p className="text-center text-xs text-muted-foreground mt-2">
              Have an email?{" "}
              <Link href="/sign-up" className="text-primary font-medium">Sign up with email</Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd artifacts/jg-youth && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add artifacts/jg-youth/src/pages/pin-signup.tsx
git commit -m "feat(web): pin-signup page (username + PIN account creation)"
```

### Task 4: `PinLogin` page

**Files:**
- Create: `artifacts/jg-youth/src/pages/pin-login.tsx`

- [ ] **Step 1: Create the page**

```tsx
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState } from "react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { setPinSession } from "@/lib/pinSession";
import { ChevronLeft, LogIn } from "lucide-react";
import { Link, useLocation } from "wouter";

const schema = z.object({
  username: z.string().min(1, "Username is required"),
  pin: z.string().min(1, "PIN is required"),
});
type FormValues = z.infer<typeof schema>;

export default function PinLogin() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { username: "", pin: "" },
  });

  async function onSubmit(values: FormValues) {
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/pin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setPinSession({
          role: data.role === "member" ? "member" : "visitor",
          profile_id: data.profile_id,
          session_token: data.session_token,
          username: values.username.trim().toLowerCase(),
        });
        toast({ title: "Welcome back!" });
        setLocation("/account");
        return;
      }
      toast({ title: "Login failed", description: data.error ?? "Invalid username or PIN", variant: "destructive" });
    } catch {
      toast({ title: "Network error", description: "Please try again.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Layout>
      <div className="max-w-md mx-auto py-12">
        <div className="mb-6">
          <Link href="/">
            <Button variant="ghost" size="sm" className="-ml-3 text-muted-foreground">
              <ChevronLeft className="w-4 h-4 mr-1" />
              Back
            </Button>
          </Link>
        </div>
        <Card className="border border-border bg-card rounded-2xl overflow-hidden">
          <div className="h-1.5 w-full bg-primary" />
          <CardHeader className="text-center pt-8">
            <div className="mx-auto w-12 h-12 bg-primary/10 border border-primary/20 rounded-full flex items-center justify-center mb-4">
              <LogIn className="w-6 h-6 text-primary" />
            </div>
            <CardTitle className="text-2xl font-semibold tracking-tight">Log in</CardTitle>
            <CardDescription>Use the username and PIN you created.</CardDescription>
          </CardHeader>
          <CardContent className="pb-8">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField control={form.control} name="username" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Username</FormLabel>
                    <FormControl><Input className="h-12" autoCapitalize="none" placeholder="thandi_k" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="pin" render={({ field }) => (
                  <FormItem>
                    <FormLabel>PIN</FormLabel>
                    <FormControl><Input className="h-12 text-center text-lg tracking-[0.5em] font-mono" type="password" inputMode="numeric" maxLength={6} placeholder="••••" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <Button type="submit" className="w-full h-12 mt-2" disabled={submitting}>
                  {submitting ? "Logging in..." : "Log in"}
                </Button>
              </form>
            </Form>
            <p className="text-center text-sm text-muted-foreground mt-6">
              New here?{" "}
              <Link href="/pin-signup" className="text-primary font-medium">Create an account</Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd artifacts/jg-youth && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add artifacts/jg-youth/src/pages/pin-login.tsx
git commit -m "feat(web): pin-login page (username + PIN)"
```

### Task 5: Routes + Home discoverability

**Files:**
- Modify: `artifacts/jg-youth/src/App.tsx`
- Modify: `artifacts/jg-youth/src/pages/home.tsx`

- [ ] **Step 1: Import the pages in App.tsx**

In `artifacts/jg-youth/src/App.tsx`, after the line `import BecomeMember from "@/pages/become-member";`, add:

```ts
import PinSignup from "@/pages/pin-signup";
import PinLogin from "@/pages/pin-login";
import AccountHome from "@/pages/account";
```

- [ ] **Step 2: Add the routes**

In `App.tsx`, inside the `<Switch>`, after the line `<Route path="/leader-login" component={LeaderLogin} />`, add:

```tsx
          <Route path="/pin-signup" component={PinSignup} />
          <Route path="/pin-login" component={PinLogin} />
          <Route path="/account" component={AccountHome} />
```

- [ ] **Step 3: Add a Home link**

In `artifacts/jg-youth/src/pages/home.tsx`, find the "Login" button block:

```tsx
              <Button
                size="lg"
                variant="outline"
                className="w-full h-12 px-8 text-base"
                onClick={() => setLocation("/sign-in")}
              >
                <LogIn className="mr-2 h-5 w-5" />
                Login
              </Button>
```

and add immediately AFTER it (still inside the same flex container):

```tsx
              <Button
                size="lg"
                variant="ghost"
                className="w-full h-12 px-8 text-base"
                onClick={() => setLocation("/pin-signup")}
              >
                No email? Use a username
              </Button>
```

- [ ] **Step 4: Typecheck**

Run: `cd artifacts/jg-youth && npm run typecheck`
Expected: PASS (note: `AccountHome` is created in Task 6 — if doing Task 5 before Task 6, expect a missing-module error on the `account` import; do Task 6 first, or create the file then. Recommended order: do Task 6 before Step 1's `AccountHome` import. If you must commit Task 5 first, temporarily skip the AccountHome import + route and add them in Task 6.)

- [ ] **Step 5: Commit**

```bash
git add artifacts/jg-youth/src/App.tsx artifacts/jg-youth/src/pages/home.tsx
git commit -m "feat(web): routes for pin-signup/pin-login/account + Home link"
```

---

## Phase 3 — `/account` page

### Task 6: `AccountHome` page

**Files:**
- Create: `artifacts/jg-youth/src/pages/account.tsx`

> NOTE: Create this file BEFORE Task 5's `AccountHome` import/route compile, or do Task 6 first.

- [ ] **Step 1: Create the page**

```tsx
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
```

- [ ] **Step 2: Typecheck**

Run: `cd artifacts/jg-youth && npm run typecheck`
Expected: PASS (with Task 5's route present; if Task 5 not yet done, this page still typechecks on its own).

- [ ] **Step 3: Commit**

```bash
git add artifacts/jg-youth/src/pages/account.tsx
git commit -m "feat(web): /account home (status, check-in, change PIN, logout)"
```

---

## Phase 4 — Leader PIN Accounts panel

### Task 7: `PinAccountsPanel` (self-contained)

**Files:**
- Create: `artifacts/jg-youth/src/components/panels/PinAccountsPanel.tsx`

- [ ] **Step 1: Create the panel**

```tsx
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
import { useApiFetch } from "@/lib/api";
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
  const apiFetch = useApiFetch();
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
```

- [ ] **Step 2: Typecheck**

Run: `cd artifacts/jg-youth && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add artifacts/jg-youth/src/components/panels/PinAccountsPanel.tsx
git commit -m "feat(web): PinAccountsPanel — list, promote (consent-gated), reset PIN"
```

### Task 8: Render the panel in the dashboard members tab

**Files:**
- Modify: `artifacts/jg-youth/src/pages/dashboard.tsx`

- [ ] **Step 1: Import the panel**

In `artifacts/jg-youth/src/pages/dashboard.tsx`, after the line `import { MemberDirectoryPanel } from "@/components/panels/MemberDirectoryPanel";`, add:

```ts
import { PinAccountsPanel } from "@/components/panels/PinAccountsPanel";
```

- [ ] **Step 2: Render it in the members tab**

In `dashboard.tsx`, find the members `TabsContent` opening line:

```tsx
          <TabsContent value="members" className="mt-0 space-y-6">
```

Immediately after that opening tag, add:

```tsx
            <PinAccountsPanel />
```

(It renders above `RequestsPanel`/`MemberDirectoryPanel` in the same tab. The `space-y-6` on the container spaces it correctly.)

- [ ] **Step 3: Typecheck + build**

Run: `cd artifacts/jg-youth && npm run typecheck && npm run build`
Expected: typecheck PASS; build succeeds.

- [ ] **Step 4: Commit**

```bash
git add artifacts/jg-youth/src/pages/dashboard.tsx
git commit -m "feat(web): show PinAccountsPanel in dashboard members tab"
```

---

## Phase 5 — Manual verification

### Task 9: Click-through (manual; needs the app + backend running)

**Files:** none.

- [ ] **Step 1:** `cd artifacts/jg-youth && npm run dev`, open the app.
- [ ] **Step 2:** Home → "No email? Use a username" → `/pin-signup`. Create an account (age 11). Expect redirect to `/account` showing "Visitor" + your name/username.
- [ ] **Step 3:** On `/account`, click "Check in" → expect a pending/closed toast (proves the PIN session authenticates). Change PIN → success toast. Log out → Home.
- [ ] **Step 4:** `/pin-login` with the new username + new PIN → `/account`.
- [ ] **Step 5:** As a leader, open `/dashboard` → members tab → "PIN Accounts" panel shows the account with its visible PIN. Click "Promote" on the age-11 visitor → dialog requires parent name + phone + consent → confirm → row flips to "Member". Click "Reset PIN" on someone → new PIN shown in dialog; panel's visible PIN updates.
- [ ] **Step 6:** Confirm the existing Clerk sign-in and leader login still work unchanged.
- [ ] **Step 7:** If anything deviates, stop and debug before marking complete.

---

## Self-Review

**Spec coverage (frontend design doc):**
- New `/pin-signup`, `/pin-login`, `/account` routes outside Clerk gate → Tasks 3,4,5,6. ✅
- Separate `jg_pin_session` + `apiFetch` attach → Tasks 1,2. ✅
- Signup: kid-only fields, client zod mirrors server, auto-login, inline 409 → Task 3. ✅
- Login → `/account`, 401 handling → Task 4. ✅
- `/account`: status badge, check-in (uses GET /auth/me — the corrected self endpoint), read-only check-in schedule, change-PIN, logout; RSVP excluded; check-in 401 treated as not-signed-in → Task 6. ✅
- Leader panel: list w/ visible PIN, under-13 consent-gated promote (parent fields sent in one call), reset-PIN-shown-once → Tasks 7,8. ✅
- Home discoverability link → Task 5. ✅

**Note vs spec:** the design said `/account` loads via `GET /profiles/:id`; that route is leader-gated, so this plan uses `GET /api/auth/me` (added in the backend-deps plan) instead. Consistent with that correction.

**Deferred:** Clerk sign-in/sign-up "use a username" link (Home link covers discoverability; adding it inside Clerk's component is awkward and low-value — Home + `/pin-login` cross-links suffice); the upcoming-events list on `/account` (the spec mentioned "schedule + events", but events are already on Home and add little to the kid's check-in flow — `/account` shows the check-in schedule, which is the part tied to checking in. Add events later if wanted).

**Placeholder scan:** none — every code step is complete. ✅
**Type/name consistency:** `setPinSession`/`getPinSession`/`clearPinSession`, the `PinSession` shape, `apiFetch`/`useApiFetch`, and the `/api/...` endpoint paths are consistent across all tasks and match the backend. ✅
