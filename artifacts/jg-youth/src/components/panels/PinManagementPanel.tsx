import { useState } from "react";
import { MessageCircle, Shield } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { useApiFetch } from "@/lib/api";
import { openWhatsApp } from "@/lib/whatsapp";
import { useToast } from "@/hooks/use-toast";
import { DashCard, SectionTitle, SkeletonRows, EmptyState } from "./shared";

interface PinManagementPanelProps {
  leaderPins: any[];
  isLeaderPinsLoading: boolean;
  setSettingPinFor: (leader: any) => void;
}

export function PinManagementPanel({
  leaderPins,
  isLeaderPinsLoading,
  setSettingPinFor,
}: PinManagementPanelProps) {
  const apiFetch = useApiFetch();
  const { toast } = useToast();
  const [inviting, setInviting] = useState<any | null>(null);
  const [isSending, setIsSending] = useState(false);

  const notLoggedIn = leaderPins?.filter((l: any) => l.has_logged_in === false).length ?? 0;

  // Mints a fresh PIN server-side, then hands WhatsApp a ready-made invite.
  const sendInvite = async () => {
    if (!inviting) return;
    setIsSending(true);
    try {
      const res = await apiFetch(`/api/leaders/${inviting.id}/invite`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not create the invite.");
      openWhatsApp(data.phone, data.message);
      toast({
        title: "Invite ready in WhatsApp",
        description: `Press send in WhatsApp to deliver it to ${inviting.full_name}.`,
      });
      setInviting(null);
    } catch (err) {
      toast({
        title: "Invite failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <DashCard>
      <SectionTitle
        title="Leader PINs"
        icon={<Shield className="h-4 w-4 text-primary" />}
      />
      <p className="text-xs text-muted-foreground mb-4">
        Invite leaders to use the app on their own phone, or set their PIN.
        {notLoggedIn > 0 && (
          <> <span className="font-medium text-foreground">{notLoggedIn} haven't logged in yet.</span></>
        )}
      </p>
      {isLeaderPinsLoading ? (
        <SkeletonRows count={3} />
      ) : leaderPins && leaderPins.length > 0 ? (
        <div className="space-y-3">
          {leaderPins.map((l: any) => (
            <div
              key={l.id}
              className="flex items-center justify-between gap-3 p-4 border border-border rounded-xl bg-card"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-sm">{l.full_name}</p>
                  {l.has_logged_in === false && (
                    <Badge variant="outline" className="text-[10px]">
                      Never logged in
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {l.phone ?? "No phone"}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  onClick={() => setInviting(l)}
                  disabled={!l.phone}
                  className="h-8 text-xs px-3"
                >
                  <MessageCircle className="h-3.5 w-3.5 sm:mr-1.5" />
                  <span className="hidden sm:inline">Invite</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSettingPinFor(l)}
                  className="h-8 text-xs px-3"
                >
                  Set PIN
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState text="No leaders found." />
      )}

      <AlertDialog open={!!inviting} onOpenChange={(open) => !open && !isSending && setInviting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Invite {inviting?.full_name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This gives them a new PIN (their old PIN stops working) and opens
              WhatsApp with an invite ready to send: the app link, their login
              details and how to add it to their home screen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isSending}
              onClick={(e) => {
                e.preventDefault();
                void sendInvite();
              }}
            >
              {isSending ? "Preparing…" : "Open WhatsApp"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashCard>
  );
}
