import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  INSTRUMENTS,
  instrumentLabel,
  worshipKeys,
  worshipPost,
  type WorshipAccount,
} from "@/lib/worship";

export function InstrumentPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {INSTRUMENTS.map((i) => {
        const on = value.includes(i);
        return (
          <button
            key={i}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((v) => v !== i) : [...value, i])}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              on
                ? "border-primary/50 bg-primary/15 text-primary"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {instrumentLabel(i)}
          </button>
        );
      })}
    </div>
  );
}

export function ProfileDialog({
  account,
  open,
  onOpenChange,
}: {
  account: WorshipAccount;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(account.full_name);
  const [instruments, setInstruments] = useState(account.instruments);
  const [range, setRange] = useState(account.vocal_range ?? "");
  const [bio, setBio] = useState(account.bio ?? "");
  const [muted, setMuted] = useState(Boolean(account.notifications_muted));
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(account.full_name);
    setInstruments(account.instruments);
    setRange(account.vocal_range ?? "");
    setBio(account.bio ?? "");
    setMuted(Boolean(account.notifications_muted));
    setCurrentPin("");
    setNewPin("");
  }, [open, account]);

  const save = useMutation({
    mutationFn: async () => {
      await worshipPost(
        "/me",
        { full_name: name, instruments, vocal_range: range, bio, notifications_muted: muted },
        "PATCH",
      );
      if (newPin) await worshipPost("/me/pin", { current_pin: currentPin, new_pin: newPin });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["worship"] });
      toast.success("Profile saved");
      onOpenChange(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Your worship profile</DialogTitle>
          <DialogDescription>The rest of the team can see this.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="wp-name">Name</Label>
            <Input id="wp-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>What you do on the team</Label>
            <InstrumentPicker value={instruments} onChange={setInstruments} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wp-range">Vocal range (optional)</Label>
            <Input
              id="wp-range"
              placeholder="e.g. Alto, Tenor, G3–D5"
              value={range}
              onChange={(e) => setRange(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wp-bio">About you (optional)</Label>
            <Textarea id="wp-bio" rows={2} maxLength={300} value={bio} onChange={(e) => setBio(e.target.value)} />
          </div>
          <div className="flex items-center justify-between rounded-xl border border-border p-3">
            <div>
              <p className="text-sm font-medium">Mute push notifications</p>
              <p className="text-xs text-muted-foreground">You'll still see them under the bell.</p>
            </div>
            <Switch checked={muted} onCheckedChange={setMuted} />
          </div>
          <div className="space-y-2 rounded-xl border border-border p-3">
            <p className="text-sm font-medium">Change PIN (optional)</p>
            <div className="grid grid-cols-2 gap-2">
              <Input
                type="password"
                inputMode="numeric"
                placeholder="Current PIN"
                value={currentPin}
                onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              />
              <Input
                type="password"
                inputMode="numeric"
                placeholder="New PIN"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !name.trim()}>
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
