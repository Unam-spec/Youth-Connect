import { useState, useEffect } from "react";
import { MessageCircle, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useUpdateMyProfile,
  getGetMyProfileQueryKey,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

export function PreferencesModal({
  open,
  onOpenChange,
  whatsappOptIn,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  whatsappOptIn: boolean;
}) {
  const updateProfile = useUpdateMyProfile();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Local mirror so the switch responds instantly; reverts on failure.
  const [optIn, setOptIn] = useState(whatsappOptIn);
  const [saving, setSaving] = useState(false);

  useEffect(() => setOptIn(whatsappOptIn), [whatsappOptIn]);

  async function handleToggle(next: boolean) {
    const previous = optIn;
    setOptIn(next);
    setSaving(true);
    try {
      await updateProfile.mutateAsync({ data: { whatsapp_opt_in: next } });
      queryClient.invalidateQueries({ queryKey: getGetMyProfileQueryKey() });
      toast({ title: next ? "WhatsApp notifications on" : "WhatsApp notifications off" });
    } catch {
      setOptIn(previous);
      toast({ title: "Couldn't update preference", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-2xl border-border bg-popover">
        <DialogHeader>
          <DialogTitle className="font-[family-name:var(--app-font-heading)] text-xl font-semibold tracking-tight">
            Preferences
          </DialogTitle>
          <DialogDescription>
            Choose how you'd like to hear from JG Youth.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 space-y-3">
          <div className="flex items-start justify-between gap-4 rounded-xl border border-border bg-card p-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <MessageCircle className="h-4 w-4 text-primary" />
              </span>
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Event WhatsApp notifications
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Get session details, event announcements & reminders on WhatsApp.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 pt-0.5">
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              <Switch
                checked={optIn}
                onCheckedChange={handleToggle}
                disabled={saving}
                aria-label="Toggle event WhatsApp notifications"
              />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
