import { useState } from "react";
import { Eye, EyeOff, KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PinInput } from "@/components/ui/pin-input";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/api";
import { DashCard, SectionTitle } from "./shared";

/**
 * Shared kiosk PIN: one PIN every leader/super-admin uses to exit kiosk mode
 * on the shared check-in phone. Revealed on demand; changeable here.
 */
export function KioskPinPanel() {
  const { toast } = useToast();
  const [pin, setPin] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [newPin, setNewPin] = useState("");
  const [saving, setSaving] = useState(false);

  async function toggleReveal() {
    if (revealed) {
      setRevealed(false);
      return;
    }
    if (pin) {
      setRevealed(true);
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch("/api/kiosk/pin");
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.pin) {
        setPin(data.pin);
        setRevealed(true);
      } else {
        toast({ title: "Could not load the kiosk PIN", variant: "destructive" });
      }
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function saveNewPin() {
    if (!/^\d{4,6}$/.test(newPin)) {
      toast({ title: "PIN must be 4-6 digits", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch("/api/kiosk/pin", {
        method: "PUT",
        body: JSON.stringify({ pin: newPin }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setPin(data.pin ?? newPin);
        setRevealed(true);
        setNewPin("");
        toast({ title: "Kiosk PIN updated" });
      } else {
        toast({
          title: "Could not update kiosk PIN",
          description: data.error ?? "Please try again.",
          variant: "destructive",
        });
      }
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <DashCard>
      <SectionTitle
        title="Kiosk PIN"
        icon={<KeyRound className="h-4 w-4 text-primary" />}
      />
      <p className="text-xs text-muted-foreground mb-4">
        The one PIN every leader uses to exit Kiosk Mode on the shared check-in
        phone. Keep it away from the kids passing the phone around.
      </p>
      <div className="flex items-center gap-3 mb-4">
        <span className="font-mono text-2xl tracking-[0.4em] tabular-nums">
          {revealed && pin ? pin : "••••"}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs px-3"
          onClick={toggleReveal}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : revealed ? (
            <><EyeOff className="h-3.5 w-3.5 mr-1.5" /> Hide</>
          ) : (
            <><Eye className="h-3.5 w-3.5 mr-1.5" /> Reveal</>
          )}
        </Button>
      </div>
      <div className="flex gap-2 max-w-xs">
        <PinInput
          maxLength={6}
          placeholder="New PIN"
          value={newPin}
          onChange={setNewPin}
          className="h-9"
        />
        <Button
          size="sm"
          className="h-9 shrink-0"
          onClick={saveNewPin}
          disabled={saving || newPin.length < 4}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Change"}
        </Button>
      </div>
    </DashCard>
  );
}
