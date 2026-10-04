import { useState, type ReactNode } from "react";
import { Link, useSearch } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, BellRing, Clock, KeyRound, Loader2, Lock, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhoneInput } from "@/components/ui/phone-input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  setWorshipSession,
  useWorshipMe,
  worshipKeys,
  worshipPost,
  type WorshipAccount,
  type WorshipSession,
} from "@/lib/worship";
import { enableWorshipPush } from "@/lib/worshipPush";
import { InstrumentPicker } from "./ProfileDialog";
import { signOutOfWorship, WorshipFrame, WorshipShell } from "./WorshipShell";

type AuthResponse = WorshipSession & { account: WorshipAccount };

/** The phone field holds just the dial code (e.g. "+27") until a number is typed. */
function hasPhoneNumber(phone: string): boolean {
  return phone.replace(/\D/g, "").length >= 8;
}

function pinInput(set: (v: string) => void) {
  return (e: React.ChangeEvent<HTMLInputElement>) => set(e.target.value.replace(/\D/g, "").slice(0, 6));
}

type ForgotResult = { ok: boolean; whatsapp_url: string | null; is_head_leader: boolean };

/** "Forgot PIN?": notifies the head leader and offers a WhatsApp message to them. */
function ForgotPinForm({ initialPhone, onBack }: { initialPhone: string; onBack: () => void }) {
  const [phone, setPhone] = useState(initialPhone);
  const [result, setResult] = useState<ForgotResult | null>(null);
  const send = useMutation({
    mutationFn: () => worshipPost<ForgotResult>("/auth/forgot-pin", { phone }),
    onSuccess: setResult,
    onError: (err: Error) => toast.error(err.message),
  });

  if (result?.is_head_leader) {
    return (
      <div className="space-y-4 text-center">
        <p className="text-sm">
          You're the head leader, so there's no one above you to reset it. Ask the app admin for a new PIN.
        </p>
        <Button variant="outline" className="w-full" onClick={onBack}>
          Back to sign in
        </Button>
      </div>
    );
  }

  if (result) {
    const url = result.whatsapp_url;
    return (
      <div className="space-y-4 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/15">
          <KeyRound className="h-6 w-6 text-primary" />
        </span>
        <p className="font-semibold">Request sent 🙏</p>
        <p className="text-sm text-muted-foreground">
          If this number is on the team, the head leader has been notified and will send you a new PIN.
          {url && " You can also message them directly:"}
        </p>
        {url && (
          <Button
            className="w-full"
            onClick={() => {
              const opened = window.open(url, "_blank");
              if (!opened) window.location.href = url;
            }}
          >
            <MessageCircle className="mr-2 h-4 w-4" /> Message the head leader on WhatsApp
          </Button>
        )}
        <Button variant="ghost" className="w-full" onClick={onBack}>
          Back to sign in
        </Button>
      </div>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        send.mutate();
      }}
    >
      <div className="space-y-1">
        <p className="font-semibold">Forgot your PIN?</p>
        <p className="text-sm text-muted-foreground">
          Enter your number and we'll ask the head leader to send you a new one.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="wf-phone">Phone number</Label>
        <PhoneInput id="wf-phone" value={phone} onChange={setPhone} />
      </div>
      <Button type="submit" className="w-full" disabled={send.isPending || !hasPhoneNumber(phone)}>
        {send.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Request a new PIN
      </Button>
      <Button type="button" variant="ghost" className="w-full" onClick={onBack}>
        Back to sign in
      </Button>
    </form>
  );
}

function SignInForm() {
  const queryClient = useQueryClient();
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [forgot, setForgot] = useState(false);
  const login = useMutation({
    mutationFn: () => worshipPost<AuthResponse>("/auth/login", { phone, pin }),
    onSuccess: (r) => {
      setWorshipSession(r);
      queryClient.setQueryData(worshipKeys.me, r.account);
    },
    onError: (err: Error) => toast.error(err.message),
  });
  if (forgot) return <ForgotPinForm initialPhone={phone} onBack={() => setForgot(false)} />;
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        login.mutate();
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="wl-phone">Phone number</Label>
        <PhoneInput id="wl-phone" value={phone} onChange={setPhone} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="wl-pin">PIN</Label>
        <Input id="wl-pin" type="password" inputMode="numeric" autoComplete="current-password" placeholder="4–6 digits" value={pin} onChange={pinInput(setPin)} />
      </div>
      <Button type="submit" className="w-full" disabled={login.isPending || !hasPhoneNumber(phone) || pin.length < 4}>
        {login.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Sign in
      </Button>
      <button
        type="button"
        onClick={() => setForgot(true)}
        className="block w-full text-center text-sm font-medium text-primary hover:underline"
      >
        Forgot PIN?
      </button>
    </form>
  );
}

function JoinForm() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [instruments, setInstruments] = useState<string[]>([]);
  const join = useMutation({
    mutationFn: () =>
      worshipPost<AuthResponse>("/auth/join", { full_name: name, phone, pin, instruments }),
    onSuccess: (r) => {
      setWorshipSession(r);
      queryClient.setQueryData(worshipKeys.me, r.account);
      if (r.account.status === "approved") {
        toast.success("Welcome! You're the first one here, so you're the head leader.");
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        join.mutate();
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="wj-name">Your name</Label>
        <Input id="wj-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="wj-phone">Phone number</Label>
        <PhoneInput id="wj-phone" value={phone} onChange={setPhone} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="wj-pin">Choose a PIN</Label>
        <Input id="wj-pin" type="password" inputMode="numeric" autoComplete="new-password" placeholder="4–6 digits" value={pin} onChange={pinInput(setPin)} />
        <p className="text-xs text-muted-foreground">You'll use your phone number and this PIN to sign in.</p>
      </div>
      <div className="space-y-1.5">
        <Label>What do you do on the team?</Label>
        <InstrumentPicker value={instruments} onChange={setInstruments} />
      </div>
      <Button
        type="submit"
        className="w-full"
        disabled={join.isPending || !name.trim() || !hasPhoneNumber(phone) || pin.length < 4}
      >
        {join.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Request to join
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        A worship leader will approve you.
      </p>
    </form>
  );
}

const backLink = (
  <Link href="/" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
    <ArrowLeft className="h-3.5 w-3.5" />
    JG Youth
  </Link>
);

function SignedOut() {
  // The invite link (/worship?join=1) opens straight on "Request to join".
  const startOnJoin = new URLSearchParams(useSearch()).has("join");
  return (
    <WorshipFrame right={backLink}>
      <div className="mx-auto max-w-sm pt-8">
        <div className="mb-6 space-y-2 text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
            <Lock className="h-3 w-3" /> Worship team only
          </span>
          <h1 className="font-[family-name:var(--app-font-heading)] text-3xl font-semibold tracking-tight">
            Your songs. Your keys.
          </h1>
          <p className="text-sm text-muted-foreground">Sign in, or ask to join the team.</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5">
          <Tabs defaultValue={startOnJoin ? "join" : "signin"}>
            <TabsList className="mb-5 grid w-full grid-cols-2">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="join">Request to join</TabsTrigger>
            </TabsList>
            <TabsContent value="signin">
              <SignInForm />
            </TabsContent>
            <TabsContent value="join">
              <JoinForm />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </WorshipFrame>
  );
}

function Waiting({ account }: { account: WorshipAccount }) {
  const queryClient = useQueryClient();
  const me = useWorshipMe();
  const cancel = useMutation({
    mutationFn: () => worshipPost("/me", undefined, "DELETE"),
    onSuccess: () => signOutOfWorship(queryClient),
    onError: (err: Error) => toast.error(err.message),
  });
  return (
    <WorshipFrame right={backLink}>
      <div className="mx-auto max-w-sm pt-12 text-center">
        <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/15">
          <Clock className="h-7 w-7 text-primary" />
        </span>
        <h1 className="font-[family-name:var(--app-font-heading)] text-2xl font-semibold">
          Thanks, {account.full_name.split(" ")[0]}!
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your request is waiting for a worship leader to accept it. We'll let you know when you're in.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <Button
            variant="outline"
            onClick={async () => {
              const r = await enableWorshipPush();
              if (r === "subscribed") toast.success("We'll send a notification to this device when you're accepted.");
              else if (r === "denied") toast.error("Notifications are blocked. Allow them in your browser settings.");
              else if (r === "ios-needs-install")
                toast.message("On iPhone, add this site to your Home Screen first, then turn notifications on.");
              else toast.error("Couldn't turn on notifications on this device.");
            }}
          >
            <BellRing className="mr-2 h-4 w-4" />
            Notify me when I'm accepted
          </Button>
          <Button onClick={() => me.refetch()} disabled={me.isFetching}>
            {me.isFetching && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Check again
          </Button>
          <Button variant="ghost" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
            Cancel my request
          </Button>
        </div>
      </div>
    </WorshipFrame>
  );
}

/**
 * Wraps every worship page: signed-out people see sign-in / join, pending
 * requests see the waiting screen, approved members get the page.
 */
export function WorshipGate({ children }: { children: (account: WorshipAccount) => ReactNode }) {
  const { data: account, isLoading, isError, refetch } = useWorshipMe();
  if (isLoading) {
    return (
      <WorshipFrame>
        <div className="flex justify-center pt-24">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </WorshipFrame>
    );
  }
  if (isError) {
    return (
      <WorshipFrame right={backLink}>
        <div className="pt-24 text-center">
          <p className="text-sm text-muted-foreground">Couldn't reach the worship team. Check your connection.</p>
          <Button className="mt-4" variant="outline" onClick={() => refetch()}>
            Try again
          </Button>
        </div>
      </WorshipFrame>
    );
  }
  if (!account) return <SignedOut />;
  if (account.status !== "approved") return <Waiting account={account} />;
  return <WorshipShell account={account}>{children(account)}</WorshipShell>;
}
