import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, BellRing, Clock, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

function pinInput(set: (v: string) => void) {
  return (e: React.ChangeEvent<HTMLInputElement>) => set(e.target.value.replace(/\D/g, "").slice(0, 6));
}

function SignInForm() {
  const queryClient = useQueryClient();
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const login = useMutation({
    mutationFn: () => worshipPost<AuthResponse>("/auth/login", { phone, pin }),
    onSuccess: (r) => {
      setWorshipSession(r);
      queryClient.setQueryData(worshipKeys.me, r.account);
    },
    onError: (err: Error) => toast.error(err.message),
  });
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
        <Input id="wl-phone" type="tel" autoComplete="tel" placeholder="082 123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="wl-pin">PIN</Label>
        <Input id="wl-pin" type="password" inputMode="numeric" autoComplete="current-password" placeholder="4–6 digits" value={pin} onChange={pinInput(setPin)} />
      </div>
      <Button type="submit" className="w-full" disabled={login.isPending || !phone || pin.length < 4}>
        {login.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Sign in
      </Button>
      <p className="text-center text-xs text-muted-foreground">Forgot your PIN? Ask a worship leader to reset it.</p>
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
        <Input id="wj-phone" type="tel" autoComplete="tel" placeholder="082 123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} />
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
      <Button type="submit" className="w-full" disabled={join.isPending || !name.trim() || !phone || pin.length < 4}>
        {join.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Request to join
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        A worship leader will approve you. You don't need to be a JG Youth member.
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
          <Tabs defaultValue="signin">
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
