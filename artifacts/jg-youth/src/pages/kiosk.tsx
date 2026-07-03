import { useEffect, useRef, useState } from "react";
import { Redirect, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { PhoneInput } from "@/components/ui/phone-input";
import { getLeaderSession } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { computeAge, MIN_AGE, MAX_AGE, todaySAST } from "@/lib/age";
import { openWhatsApp } from "@/lib/whatsapp";
import {
  CheckCircle2, Search, UserPlus, Lock, Loader2, Camera,
  ChevronLeft, PartyPopper, MessageCircle, KeyRound,
} from "lucide-react";

// Kiosk mode: one leader phone passed around at service. Everything here runs
// under the leader's session (apiFetch attaches x-leader-session) — members
// never log in on this device. Screens auto-reset so the next person always
// lands on the home screen.

type Screen =
  | "home"
  | "search"
  | "confirm"
  | "success"
  | "already"
  | "register"
  | "credentials"
  | "membership";

interface SearchResult {
  id: string;
  full_name: string;
  phone: string | null;
  avatar_url: string | null;
  role: string;
}

interface KioskCredentials {
  profile_id: string;
  full_name: string;
  username: string;
  pin: string;
  phone: string | null;
}

// Screens that may auto-reset to home when nobody is interacting. The
// registration form is deliberately excluded — losing a half-typed form is
// worse than an idle screen.
const IDLE_RESET_SCREENS: Screen[] = ["search", "confirm", "success", "already"];
const IDLE_MS = 45_000;
const SUCCESS_RESET_MS = 4_000;
// Mirrors CONSENT_AGE in the backend membership consent gate: under-13s need
// parent details before a leader can later promote them to member.
const CONSENT_AGE = 13;

const registerSchema = z.object({
  avatar_url: z.string().min(1, "A photo is required"),
  full_name: z.string().min(2, "Full name is required").max(120),
  gender: z.enum(["male", "female"], { required_error: "Pick one" }),
  date_of_birth: z
    .string()
    .min(1, "Date of birth is required")
    .refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && v <= todaySAST(), {
      message: "Enter a valid date of birth (not in the future)",
    })
    .refine((v) => {
      const a = computeAge(v);
      return a !== null && a >= MIN_AGE && a <= MAX_AGE;
    }, `Age must be between ${MIN_AGE} and ${MAX_AGE}`),
  phone: z.string().optional(),
  parent_name: z.string().optional(),
  parent_phone: z.string().optional(),
});
type RegisterValues = z.infer<typeof registerSchema>;

export default function Kiosk() {
  const [, setLocation] = useLocation();
  const [screen, setScreen] = useState<Screen>("home");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [checkingIn, setCheckingIn] = useState(false);
  const [credentials, setCredentials] = useState<KioskCredentials | null>(null);
  const [membershipBusy, setMembershipBusy] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);

  const session = getLeaderSession();
  if (!session) return <Redirect to="/leader-login" />;

  function resetToHome() {
    setScreen("home");
    setSearchQuery("");
    setSearchResults([]);
    setSelected(null);
    setCredentials(null);
  }

  // Idle auto-reset for the tap-through screens.
  useEffect(() => {
    if (!IDLE_RESET_SCREENS.includes(screen)) return;
    const ms = screen === "success" || screen === "already" ? SUCCESS_RESET_MS : IDLE_MS;
    const t = setTimeout(resetToHome, ms);
    return () => clearTimeout(t);
    // searchQuery in deps: typing keeps the search screen alive.
  }, [screen, searchQuery]);

  async function handleSearch(query: string) {
    setSearchQuery(query);
    if (query.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    setIsSearching(true);
    try {
      const res = await fetch(`/api/checkin/search?query=${encodeURIComponent(query)}`);
      if (res.ok) setSearchResults(await res.json());
    } catch {
      // Kiosk stays quiet on transient search errors; the leader can retype.
    } finally {
      setIsSearching(false);
    }
  }

  async function handleCheckIn() {
    if (!selected) return;
    setCheckingIn(true);
    try {
      const res = await apiFetch("/api/attendance", {
        method: "POST",
        body: JSON.stringify({ profile_id: selected.id, check_in_method: "manual" }),
      });
      if (res.status === 201) {
        setScreen("success");
      } else if (res.status === 409) {
        setScreen("already");
      } else if (res.status === 401) {
        setLocation("/leader-login");
      } else {
        setScreen("search");
      }
    } catch {
      setScreen("search");
    } finally {
      setCheckingIn(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Slim kiosk header — no app navigation on purpose. */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="font-semibold tracking-tight">JG Youth · Check-in</span>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => setExitOpen(true)}
          aria-label="Exit kiosk mode"
        >
          <Lock className="w-4 h-4" />
        </Button>
      </header>

      <main className="flex-1 flex flex-col max-w-md w-full mx-auto px-4 py-6">
        {screen === "home" && (
          <div className="flex-1 flex flex-col justify-center gap-4">
            <h1 className="text-2xl font-semibold text-center mb-2">Welcome! 👋</h1>
            <Button className="h-20 text-lg rounded-2xl" onClick={() => setScreen("search")}>
              <Search className="w-6 h-6 mr-3" /> I'm here — check in
            </Button>
            <Button
              variant="outline"
              className="h-20 text-lg rounded-2xl"
              onClick={() => setScreen("register")}
            >
              <UserPlus className="w-6 h-6 mr-3" /> I'm new here
            </Button>
          </div>
        )}

        {screen === "search" && (
          <div className="space-y-4">
            <BackRow onBack={resetToHome} title="Find your name" />
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                autoFocus
                placeholder="Type your name…"
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                className="pl-10 h-14 text-lg rounded-xl"
              />
            </div>
            {isSearching && (
              <div className="flex justify-center py-6">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            )}
            <div className="space-y-2">
              {searchResults.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setSelected(p);
                    setScreen("confirm");
                  }}
                  className="w-full flex items-center gap-4 rounded-2xl border border-border bg-card px-4 py-4 text-left hover:bg-muted transition-colors"
                >
                  <Avatar url={p.avatar_url} name={p.full_name} size="w-12 h-12" />
                  <span className="font-medium text-lg">{p.full_name}</span>
                </button>
              ))}
            </div>
            {searchQuery.trim().length >= 2 && !isSearching && searchResults.length === 0 && (
              <div className="text-center space-y-3 py-4">
                <p className="text-muted-foreground">No one found with that name.</p>
                <Button variant="outline" onClick={() => setScreen("register")}>
                  <UserPlus className="w-4 h-4 mr-2" /> I'm new — register me
                </Button>
              </div>
            )}
          </div>
        )}

        {screen === "confirm" && selected && (
          <div className="flex-1 flex flex-col justify-center items-center gap-6 text-center">
            <Avatar url={selected.avatar_url} name={selected.full_name} size="w-28 h-28" textSize="text-4xl" />
            <div>
              <h2 className="text-2xl font-semibold">{selected.full_name}</h2>
              <p className="text-muted-foreground mt-1">Is this you?</p>
            </div>
            <div className="w-full space-y-3">
              <Button className="w-full h-16 text-lg rounded-2xl" onClick={handleCheckIn} disabled={checkingIn}>
                {checkingIn ? <Loader2 className="w-5 h-5 animate-spin" /> : <><CheckCircle2 className="w-5 h-5 mr-2" /> Yes, check me in</>}
              </Button>
              <Button variant="ghost" className="w-full h-12" onClick={() => setScreen("search")} disabled={checkingIn}>
                No, go back
              </Button>
            </div>
          </div>
        )}

        {screen === "success" && (
          <div className="flex-1 flex flex-col justify-center items-center gap-4 text-center">
            <div className="w-24 h-24 rounded-full bg-primary/10 border border-primary/25 flex items-center justify-center">
              <CheckCircle2 className="w-12 h-12 text-primary" />
            </div>
            <h2 className="text-2xl font-semibold">
              You're in{selected ? `, ${selected.full_name.split(" ")[0]}` : ""}! 🎉
            </h2>
            <p className="text-muted-foreground">Pass the phone to the next person.</p>
          </div>
        )}

        {screen === "already" && (
          <div className="flex-1 flex flex-col justify-center items-center gap-4 text-center">
            <div className="w-24 h-24 rounded-full bg-muted flex items-center justify-center">
              <CheckCircle2 className="w-12 h-12 text-muted-foreground" />
            </div>
            <h2 className="text-2xl font-semibold">Already checked in ✅</h2>
            <p className="text-muted-foreground">
              {selected?.full_name.split(" ")[0] ?? "You"} checked in earlier tonight.
            </p>
          </div>
        )}

        {screen === "register" && (
          <KioskRegisterForm
            onBack={resetToHome}
            onRegistered={(creds) => {
              setCredentials(creds);
              setScreen("credentials");
            }}
            onSessionExpired={() => setLocation("/leader-login")}
          />
        )}

        {screen === "credentials" && credentials && (
          <div className="flex-1 flex flex-col justify-center gap-6 text-center">
            <div className="space-y-1">
              <PartyPopper className="w-10 h-10 text-primary mx-auto" />
              <h2 className="text-2xl font-semibold">Welcome, {credentials.full_name.split(" ")[0]}!</h2>
              <p className="text-muted-foreground">You're checked in. Here's your login — keep it safe:</p>
            </div>
            <div className="rounded-2xl border border-primary/25 bg-primary/5 p-6 space-y-3">
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Username</p>
                <p className="text-2xl font-mono font-semibold">{credentials.username}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">PIN</p>
                <p className="text-3xl font-mono font-semibold tracking-[0.3em]">{credentials.pin}</p>
              </div>
              <p className="text-xs text-muted-foreground">
                Log in on your own phone at {window.location.origin.replace(/^https?:\/\//, "")} to
                check in, see events, and get notifications.
              </p>
            </div>
            {credentials.phone && (
              <Button
                variant="outline"
                className="h-12"
                onClick={() =>
                  openWhatsApp(
                    credentials.phone!,
                    `Welcome to JG Youth! 🎉 Your login — username: ${credentials.username}, PIN: ${credentials.pin}. Sign in on your phone here: ${window.location.origin}/pin-login`,
                  )
                }
              >
                <MessageCircle className="w-4 h-4 mr-2" /> Send my login via WhatsApp
              </Button>
            )}
            <Button className="h-14 text-lg rounded-2xl" onClick={() => setScreen("membership")}>
              Done
            </Button>
          </div>
        )}

        {screen === "membership" && credentials && (
          <div className="flex-1 flex flex-col justify-center gap-4 text-center">
            <h2 className="text-2xl font-semibold">One more thing…</h2>
            <p className="text-muted-foreground">
              Would you like to become a member of JG Youth? A leader will follow up with you.
            </p>
            <Button
              className="h-16 text-lg rounded-2xl"
              disabled={membershipBusy}
              onClick={async () => {
                setMembershipBusy(true);
                try {
                  await apiFetch("/api/kiosk/request-membership", {
                    method: "POST",
                    body: JSON.stringify({ profile_id: credentials.profile_id }),
                  });
                } catch {
                  // Non-blocking: they're registered either way.
                } finally {
                  setMembershipBusy(false);
                  resetToHome();
                }
              }}
            >
              {membershipBusy ? <Loader2 className="w-5 h-5 animate-spin" /> : "Yes, I want to be a member!"}
            </Button>
            <Button variant="ghost" className="h-12" onClick={resetToHome} disabled={membershipBusy}>
              Maybe later
            </Button>
          </div>
        )}
      </main>

      <KioskExitDialog
        open={exitOpen}
        onOpenChange={setExitOpen}
        onExit={() => setLocation("/dashboard")}
      />
    </div>
  );
}

function BackRow({ onBack, title }: { onBack: () => void; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={onBack}>
        <ChevronLeft className="w-4 h-4" />
      </Button>
      <h2 className="text-lg font-semibold">{title}</h2>
    </div>
  );
}

function Avatar({
  url, name, size, textSize = "text-lg",
}: { url: string | null; name: string; size: string; textSize?: string }) {
  if (url) {
    return <img src={url} alt={name} className={`${size} rounded-full object-cover border border-border shrink-0`} />;
  }
  return (
    <div className={`${size} rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0`}>
      <span className={`${textSize} font-bold text-primary`}>{name.charAt(0).toUpperCase()}</span>
    </div>
  );
}

function KioskRegisterForm({
  onBack, onRegistered, onSessionExpired,
}: {
  onBack: () => void;
  onRegistered: (creds: KioskCredentials) => void;
  onSessionExpired: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      avatar_url: "", full_name: "", gender: undefined, date_of_birth: "",
      phone: "", parent_name: "", parent_phone: "",
    },
    mode: "onTouched",
  });
  const avatarUrl = form.watch("avatar_url");
  const dob = form.watch("date_of_birth");
  const liveAge = computeAge(dob);
  const needsParent = liveAge !== null && liveAge < CONSENT_AGE;

  async function handlePhotoSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setPhotoError("Please choose an image file (JPG or PNG).");
      return;
    }
    setPhotoError(null);
    setUploadingPhoto(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/register/photo", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPhotoError(data.error || "Upload failed. Please try again.");
        return;
      }
      form.setValue("avatar_url", data.url, { shouldValidate: true, shouldDirty: true });
    } catch {
      setPhotoError("Upload failed — please check the connection and try again.");
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function onSubmit(values: RegisterValues) {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await apiFetch("/api/kiosk/register", {
        method: "POST",
        body: JSON.stringify({
          full_name: values.full_name,
          gender: values.gender,
          date_of_birth: values.date_of_birth,
          avatar_url: values.avatar_url,
          phone: values.phone || null,
          parent_name: values.parent_name || null,
          parent_phone: values.parent_phone || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 201) {
        onRegistered({
          profile_id: data.profile_id,
          full_name: data.full_name,
          username: data.username,
          pin: data.pin,
          phone: values.phone || null,
        });
        return;
      }
      if (res.status === 401) {
        onSessionExpired();
        return;
      }
      setSubmitError(data.error ?? "Something went wrong. Please try again.");
    } catch {
      setSubmitError("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <BackRow onBack={onBack} title="Welcome! Tell us about you" />
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField control={form.control} name="avatar_url" render={() => (
            <FormItem>
              <FormLabel>Your photo</FormLabel>
              <FormControl>
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="w-20 h-20 rounded-full border-2 border-dashed border-border flex items-center justify-center overflow-hidden bg-card"
                  >
                    {uploadingPhoto ? (
                      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    ) : avatarUrl ? (
                      <img src={avatarUrl} alt="You" className="w-full h-full object-cover" />
                    ) : (
                      <Camera className="w-6 h-6 text-muted-foreground" />
                    )}
                  </button>
                  <div className="space-y-1">
                    <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploadingPhoto}>
                      {avatarUrl ? "Change photo" : "Take a photo"}
                    </Button>
                    {photoError && <p className="text-xs text-destructive">{photoError}</p>}
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    capture="user"
                    className="hidden"
                    onChange={handlePhotoSelected}
                  />
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="full_name" render={({ field }) => (
            <FormItem>
              <FormLabel>Full name</FormLabel>
              <FormControl><Input className="h-12" placeholder="Thandi Khumalo" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="gender" render={({ field }) => (
            <FormItem>
              <FormLabel>Gender</FormLabel>
              <FormControl>
                <div className="grid grid-cols-2 gap-2">
                  {(["male", "female"] as const).map((g) => (
                    <Button
                      key={g}
                      type="button"
                      variant={field.value === g ? "default" : "outline"}
                      className="h-12 capitalize"
                      onClick={() => field.onChange(g)}
                    >
                      {g}
                    </Button>
                  ))}
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="date_of_birth" render={({ field }) => (
            <FormItem>
              <FormLabel>Date of birth</FormLabel>
              <FormControl><Input type="date" max={todaySAST()} className="h-12" {...field} /></FormControl>
              {liveAge !== null && (
                <p className="text-xs text-muted-foreground mt-1">Age: {liveAge}</p>
              )}
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="phone" render={({ field }) => (
            <FormItem>
              <FormLabel>Phone / WhatsApp (optional)</FormLabel>
              <FormControl><PhoneInput className="h-12" {...field} value={field.value ?? ""} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          {needsParent && (
            <div className="rounded-xl border border-border bg-card p-4 space-y-4">
              <p className="text-sm text-muted-foreground">
                Since you're under {CONSENT_AGE}, please add a parent or guardian:
              </p>
              <FormField control={form.control} name="parent_name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Parent / guardian name</FormLabel>
                  <FormControl><Input className="h-12" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="parent_phone" render={({ field }) => (
                <FormItem>
                  <FormLabel>Parent / guardian phone</FormLabel>
                  <FormControl><PhoneInput className="h-12" {...field} value={field.value ?? ""} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
          )}
          {submitError && <p className="text-sm text-destructive">{submitError}</p>}
          <Button type="submit" className="w-full h-14 text-lg rounded-2xl" disabled={submitting || uploadingPhoto}>
            {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : "Register & check in"}
          </Button>
        </form>
      </Form>
    </div>
  );
}

function KioskExitDialog({
  open, onOpenChange, onExit,
}: { open: boolean; onOpenChange: (v: boolean) => void; onExit: () => void }) {
  const [hasPin, setHasPin] = useState<boolean | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setPin("");
      setError(null);
      return;
    }
    setHasPin(null);
    apiFetch("/api/profiles/me/pin")
      .then((r) => (r.ok ? r.json() : { hasPIN: false }))
      .then((d) => setHasPin(!!d.hasPIN))
      .catch(() => setHasPin(false));
  }, [open]);

  async function verifyAndExit() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch("/api/kiosk/verify-pin", {
        method: "POST",
        body: JSON.stringify({ pin }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.valid || data.no_pin) {
        onExit();
      } else {
        setError("Wrong PIN — try again.");
      }
    } catch {
      setError("Could not verify. Check the connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="w-4 h-4" /> Exit kiosk mode
          </DialogTitle>
          <DialogDescription>
            {hasPin === null
              ? "Checking…"
              : hasPin
                ? "Enter your leader PIN to go back to the dashboard."
                : "Go back to the dashboard?"}
          </DialogDescription>
        </DialogHeader>
        {hasPin && (
          <Input
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            className="h-12 text-center text-lg tracking-[0.5em] font-mono"
            placeholder="••••"
            autoFocus
          />
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-2 justify-end">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          {hasPin === false ? (
            <Button onClick={onExit}>Exit</Button>
          ) : (
            <Button onClick={verifyAndExit} disabled={busy || pin.length < 4}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Exit"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
