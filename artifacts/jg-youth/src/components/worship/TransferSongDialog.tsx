import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { worshipFetch, worshipKeys, worshipPost, type WorshipAccount } from "@/lib/worship";

/** Hand a song to someone else on the team. A song has one holder at a time. */
export function TransferSongDialog({
  song,
  holderId,
  open,
  onOpenChange,
}: {
  song: { id: string; title: string };
  holderId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [to, setTo] = useState<WorshipAccount | null>(null);
  const { data } = useQuery({
    queryKey: worshipKeys.members,
    queryFn: () => worshipFetch<{ members: WorshipAccount[] }>("/members"),
    enabled: open,
  });
  const others = data?.members.filter((m) => m.id !== holderId) ?? [];

  const transfer = useMutation({
    mutationFn: () => worshipPost(`/songs/${song.id}/transfer`, { to: to?.id }),
    onSuccess: () => {
      toast.success(`"${song.title}" is now ${to?.full_name}'s`);
      queryClient.invalidateQueries({ queryKey: ["worship"] });
      setTo(null);
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast.error(err.message);
      queryClient.invalidateQueries({ queryKey: ["worship"] });
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setTo(null);
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Transfer "{song.title}"</DialogTitle>
          <DialogDescription>
            It moves to their list and they get a notification. After that, only they or the head leader can move it.
          </DialogDescription>
        </DialogHeader>
        {others.length === 0 ? (
          <p className="text-sm text-muted-foreground">There's nobody else on the team yet.</p>
        ) : (
          <div className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {others.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setTo(m)}
                className={cn(
                  "flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm hover:bg-muted/50",
                  to?.id === m.id && "bg-muted font-medium",
                )}
              >
                <span className="truncate">{m.full_name}</span>
                {to?.id === m.id && <Check className="h-4 w-4 shrink-0 text-primary" />}
              </button>
            ))}
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button onClick={() => transfer.mutate()} disabled={!to || transfer.isPending}>
            {transfer.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {to ? `Transfer to ${to.full_name.split(" ")[0]}` : "Choose someone"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
