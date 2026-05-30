import { Eye, EyeOff, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DashCard, SectionTitle, SkeletonRows, EmptyState } from "./shared";

interface PinManagementPanelProps {
  leaderPins: any[];
  isLeaderPinsLoading: boolean;
  revealedPins: Record<string, boolean>;
  togglePinReveal: (id: string) => void;
  setSettingPinFor: (leader: any) => void;
}

export function PinManagementPanel({
  leaderPins,
  isLeaderPinsLoading,
  revealedPins,
  togglePinReveal,
  setSettingPinFor,
}: PinManagementPanelProps) {
  return (
    <DashCard>
      <SectionTitle
        title="Leader PINs"
        icon={<Shield className="h-4 w-4 text-purple-400" />}
      />
      <p className="text-xs text-muted-foreground mb-4">
        Set or reveal the 4-digit PIN for each leader. This PIN is used for
        authenticated leader actions.
      </p>
      {isLeaderPinsLoading ? (
        <SkeletonRows count={3} />
      ) : leaderPins && leaderPins.length > 0 ? (
        <div className="space-y-3">
          {leaderPins.map((l: any) => (
            <div
              key={l.id}
              className="flex items-center justify-between p-4 border border-border/50 rounded-xl bg-card/30"
            >
              <div>
                <p className="font-semibold text-sm">{l.full_name}</p>
                <p className="text-xs text-muted-foreground">
                  {l.phone ?? "No phone"}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {l.pin_plain ? (
                  <div className="flex items-center gap-2">
                    <div className="font-mono bg-muted/50 px-2 py-1 rounded text-sm tracking-widest min-w-[60px] text-center">
                      {revealedPins[l.id] ? l.pin_plain : "••••"}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => togglePinReveal(l.id)}
                      className="h-8 w-8 p-0 text-muted-foreground"
                    >
                      {revealedPins[l.id] ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                ) : (
                  <span className="text-xs text-amber-500 bg-amber-500/10 px-2 py-1 rounded">
                    Not Set
                  </span>
                )}
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
    </DashCard>
  );
}
