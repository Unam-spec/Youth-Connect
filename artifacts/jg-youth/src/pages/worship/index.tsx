import { useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Crown, KeyRound, MessageCircle, MoreVertical, Send, UserMinus, UserPlus, X } from "lucide-react";
import { openWhatsApp } from "@/lib/whatsapp";
import { InviteDialog } from "@/components/worship/InviteDialog";
import { GettingStarted } from "@/components/worship/GettingStarted";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { WorshipGate } from "@/components/worship/WorshipGate";
import {
  canApprove,
  initials,
  instrumentLabel,
  roleLabel,
  worshipFetch,
  worshipKeys,
  worshipPost,
  type WorshipAccount,
} from "@/lib/worship";

function Avatar({ name, className = "h-12 w-12 text-sm" }: { name: string; className?: string }) {
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-full bg-primary/15 font-semibold text-primary ${className}`}>
      {initials(name)}
    </span>
  );
}

function JoinRequests() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: worshipKeys.requests,
    queryFn: () => worshipFetch<{ requests: WorshipAccount[] }>("/requests"),
    refetchInterval: 60_000,
  });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "decline" }) =>
      worshipPost(`/requests/${id}/${action}`),
    onSuccess: (_d, v) => {
      toast.success(v.action === "approve" ? "Welcome to the team!" : "Request declined");
      queryClient.invalidateQueries({ queryKey: worshipKeys.requests });
      queryClient.invalidateQueries({ queryKey: worshipKeys.members });
    },
    onError: (err: Error) => toast.error(err.message),
  });
  if (!data?.requests.length) return null;
  return (
    <section className="mb-8">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <UserPlus className="h-4 w-4 text-primary" />
        Join requests
        <span className="rounded-full bg-primary px-2 text-xs text-primary-foreground">{data.requests.length}</span>
      </h2>
      <div className="space-y-2">
        {data.requests.map((r) => (
          <div key={r.id} className="flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-3">
            <Avatar name={r.full_name} className="h-10 w-10 text-xs" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{r.full_name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {r.instruments.length ? r.instruments.map(instrumentLabel).join(", ") : "No role picked yet"}
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Decline ${r.full_name}`}
              disabled={act.isPending}
              onClick={() => act.mutate({ id: r.id, action: "decline" })}
            >
              <X className="h-4 w-4" />
            </Button>
            <Button size="sm" disabled={act.isPending} onClick={() => act.mutate({ id: r.id, action: "approve" })}>
              <Check className="mr-1 h-4 w-4" /> Approve
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Head leader gives someone a new PIN: confirm → new PIN shown once → send it
 * straight to them on WhatsApp. Used by the ⋮ menu and by tapping a
 * "forgot their PIN" notification.
 */
function ResetPinFlow({
  member,
  open,
  onOpenChange,
}: {
  member: WorshipAccount;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [result, setResult] = useState<{ pin: string; phone: string } | null>(null);
  const reset = useMutation({
    mutationFn: () => worshipPost<{ pin: string; phone: string }>(`/members/${member.id}/reset-pin`),
    onSuccess: setResult,
    onError: (err: Error) => toast.error(err.message),
  });
  const first = member.full_name.split(" ")[0];
  const close = (o: boolean) => {
    if (!o) setResult(null);
    onOpenChange(o);
  };
  const message = result
    ? `Hi ${first}, your new Worship Team PIN is *${result.pin}* 🔑\n\nSign in with your phone number and this PIN at ${window.location.origin}/worship. You can change it under Edit profile.`
    : "";

  return (
    <AlertDialog open={open} onOpenChange={close}>
      <AlertDialogContent>
        {!result ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>Give {member.full_name} a new PIN?</AlertDialogTitle>
              <AlertDialogDescription>
                Their old PIN stops working and they're signed out on every device.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <Button onClick={() => reset.mutate()} disabled={reset.isPending}>
                <KeyRound className="mr-2 h-4 w-4" /> Make a new PIN
              </Button>
            </AlertDialogFooter>
          </>
        ) : (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>New PIN for {member.full_name}</AlertDialogTitle>
              <AlertDialogDescription>Send it to them. They can change it after signing in.</AlertDialogDescription>
            </AlertDialogHeader>
            <p className="py-2 text-center font-mono text-4xl font-bold tracking-[0.3em]">{result.pin}</p>
            <div className="flex flex-col gap-2">
              <Button onClick={() => openWhatsApp(result.phone, message)}>
                <MessageCircle className="mr-2 h-4 w-4" /> Send to {first} on WhatsApp
              </Button>
              <AlertDialogCancel className="mt-0">Done</AlertDialogCancel>
            </div>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Head leader only: promote/demote, reset PIN, remove. */
function LeaderMenu({ member }: { member: WorshipAccount }) {
  const queryClient = useQueryClient();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const isLeader = member.role === "leader";
  const done = () => queryClient.invalidateQueries({ queryKey: ["worship"] });

  const setRole = useMutation({
    mutationFn: () => worshipPost(`/members/${member.id}/role`, { role: isLeader ? "member" : "leader" }, "PATCH"),
    onSuccess: () => {
      toast.success(isLeader ? `${member.full_name} is now a member` : `${member.full_name} is now a leader`);
      done();
    },
    onError: (err: Error) => toast.error(err.message),
  });
  const remove = useMutation({
    mutationFn: () => worshipPost(`/members/${member.id}`, undefined, "DELETE"),
    onSuccess: () => {
      toast.success(`${member.full_name} was removed from the team`);
      done();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Manage ${member.full_name}`}>
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setRole.mutate()}>
            <Crown className="mr-2 h-4 w-4" />
            {isLeader ? "Make member" : "Make leader"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setResetOpen(true)}>
            <KeyRound className="mr-2 h-4 w-4" /> Reset PIN
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive" onSelect={() => setConfirmRemove(true)}>
            <UserMinus className="mr-2 h-4 w-4" /> Remove from team
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {member.full_name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Their worship account and song list will be deleted. Songs they added to the library stay.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => remove.mutate()}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ResetPinFlow member={member} open={resetOpen} onOpenChange={setResetOpen} />
    </>
  );
}

function TeamPage({ me }: { me: WorshipAccount }) {
  const { data, isLoading } = useQuery({
    queryKey: worshipKeys.members,
    queryFn: () => worshipFetch<{ members: WorshipAccount[] }>("/members"),
  });
  const isHeadLeader = me.role === "owner";
  const [inviteOpen, setInviteOpen] = useState(false);
  // Tapping a "forgot their PIN" notification lands on /worship?reset=<id>.
  const resetId = new URLSearchParams(useSearch()).get("reset");
  const [, setLocation] = useLocation();
  const resetMember = isHeadLeader && resetId ? data?.members.find((m) => m.id === resetId) : undefined;

  return (
    <div>
      {canApprove(me) && <JoinRequests />}
      {data && (
        <GettingStarted me={me} songCount={data.members.find((m) => m.id === me.id)?.song_count ?? 0} />
      )}
      <button
        type="button"
        onClick={() => setInviteOpen(true)}
        className="mb-6 flex w-full items-center gap-3 rounded-2xl border border-primary/30 bg-primary/10 p-4 text-left transition-colors hover:bg-primary/15"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/20">
          <Send className="h-5 w-5 text-primary" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Invite someone to the team</span>
          <span className="block text-xs text-muted-foreground">Send the join link on WhatsApp to anyone on the youth worship team.</span>
        </span>
      </button>
      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} />
      {resetMember && (
        <ResetPinFlow
          member={resetMember}
          open
          onOpenChange={(o) => !o && setLocation("/worship", { replace: true })}
        />
      )}
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="font-[family-name:var(--app-font-heading)] text-2xl font-semibold tracking-tight">The team</h1>
        {data && (
          <span className="text-xs text-muted-foreground">
            {data.members.length} {data.members.length === 1 ? "person" : "people"}
          </span>
        )}
      </div>
      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {data?.members.map((m) => (
            <div key={m.id} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3 transition-colors hover:border-primary/40">
              <Link href={`/worship/members/${m.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                <Avatar name={m.full_name} />
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
                    {m.full_name}
                    {m.id === me.id && <span className="text-xs font-normal text-muted-foreground">(you)</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {m.instruments.length ? m.instruments.map(instrumentLabel).join(", ") : "Worship team"}
                  </p>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                    {roleLabel(m.role) && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 font-semibold text-primary">
                        <Crown className="h-3 w-3" /> {roleLabel(m.role)}
                      </span>
                    )}
                    <span>
                      {m.song_count ?? 0} song{m.song_count === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>
              </Link>
              {isHeadLeader && m.role !== "owner" && <LeaderMenu member={m} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function WorshipHome() {
  return <WorshipGate>{(me) => <TeamPage me={me} />}</WorshipGate>;
}
