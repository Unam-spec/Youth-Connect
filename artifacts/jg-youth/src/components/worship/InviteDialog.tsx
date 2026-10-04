import { toast } from "sonner";
import { Copy, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { buildInviteMessage, shareOnWhatsApp } from "@/lib/worshipShare";

/** The join link: opens the worship page straight on "Request to join". */
export function worshipInviteLink(): string {
  return `${window.location.origin}/worship?join=1`;
}

/** Anyone on the team (head leader, leaders, members) can invite people. */
export function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const link = worshipInviteLink();
  const message = buildInviteMessage(link);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      toast.success("Invite copied. Paste it anywhere.");
    } catch {
      toast.error("Couldn't copy. Long-press the message to copy it instead.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite someone to the team</DialogTitle>
          <DialogDescription>
            Send this to anyone on the youth worship team. A leader will accept them when they ask to join.
          </DialogDescription>
        </DialogHeader>
        <pre className="whitespace-pre-wrap rounded-xl border border-border bg-muted/50 p-3 font-[family-name:var(--app-font-sans)] text-sm">
          {message}
        </pre>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button className="flex-1" onClick={() => shareOnWhatsApp(message)}>
            <MessageCircle className="mr-2 h-4 w-4" /> Send on WhatsApp
          </Button>
          <Button className="flex-1" variant="outline" onClick={copy}>
            <Copy className="mr-2 h-4 w-4" /> Copy message
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
