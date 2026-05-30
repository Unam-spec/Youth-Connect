import { Star, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useListProfiles, getListProfilesQueryKey } from "@workspace/api-client-react";
import { DashCard, SectionTitle, SkeletonRows } from "./shared";

interface AdminSlotsPanelProps {
  superAdminCount: number;
  hasPin: boolean;
  setShowPinDialog: (show: boolean) => void;
  setShowWipeConfirm: (show: boolean) => void;
}

export function AdminSlotsPanel({
  superAdminCount,
  hasPin,
  setShowPinDialog,
  setShowWipeConfirm,
}: AdminSlotsPanelProps) {
  const { data: profiles, isLoading: isProfilesLoading } = useListProfiles(undefined, {
    query: { queryKey: getListProfilesQueryKey() },
  });

  return (
    <DashCard>
      <SectionTitle
        title="Super Admin Slots"
        icon={<Star className="h-4 w-4 text-purple-400" />}
      />
      {isProfilesLoading ? (
        <SkeletonRows />
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className={`h-2 w-8 rounded-full ${i < superAdminCount ? "bg-purple-500" : "bg-muted"}`}
                />
              ))}
            </div>
            <span className="text-xs text-muted-foreground">
              {superAdminCount} of 4 slots filled
            </span>
          </div>
          <div className="space-y-2">
            {profiles
              ?.filter((p: any) => p.role === "super_admin")
              .map((admin: any) => (
                <div
                  key={admin.id}
                  className="flex items-center justify-between rounded-xl border border-purple-500/20 bg-purple-500/5 p-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-full overflow-hidden bg-purple-500/20 flex items-center justify-center text-sm font-bold text-purple-300">
                      {admin.avatar_url ? (
                        admin.avatar_url.startsWith("gradient:") ? (
                          <div
                            className="h-full w-full"
                            style={{ background: admin.avatar_url.replace("gradient:", "") }}
                          />
                        ) : (
                          <img
                            src={admin.avatar_url}
                            alt={admin.full_name}
                            className="h-full w-full object-cover"
                          />
                        )
                      ) : (
                        admin.full_name?.charAt(0)?.toUpperCase() ?? "?"
                      )}
                    </div>
                    <div>
                      <p className="font-medium text-sm">
                        {admin.full_name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {admin.phone || "No phone"}
                      </p>
                    </div>
                  </div>
                  <Badge
                    className="bg-purple-500/15 text-purple-300 border-purple-500/30"
                    variant="outline"
                  >
                    Super Admin
                  </Badge>
                </div>
              ))}
          </div>
          <div className="border-t border-border/40 pt-4 flex flex-col gap-4">
            <div>
              <p className="text-sm font-semibold mb-1">Your PIN</p>
              <p className="text-xs text-muted-foreground mb-3">
                {hasPin
                  ? "PIN is set • used for leader authentication."
                  : "No PIN set yet. Set one to enable leader login."}
              </p>
              <Button
                id="btn-set-pin"
                variant="outline"
                size="sm"
                onClick={() => setShowPinDialog(true)}
                className="border-teal-500/30 hover:border-teal-500 hover:text-teal-300 transition-colors"
              >
                {hasPin ? "Change PIN" : "Set PIN"}
              </Button>
            </div>

            <div className="border-t border-border/40 pt-4">
              <p className="text-sm font-semibold text-red-400 mb-1">Danger Zone</p>
              <p className="text-xs text-muted-foreground mb-3">
                Completely wipe all events, attendance records, RSVPs, check-ins, and non-admin members. This action is irreversible.
              </p>
              <Button
                id="btn-wipe-data"
                variant="destructive"
                size="sm"
                onClick={() => setShowWipeConfirm(true)}
                className="bg-red-950 hover:bg-red-900 border border-red-500/35 text-red-200"
              >
                Wipe All Test Data
              </Button>
            </div>
          </div>
        </div>
      )}
    </DashCard>
  );
}
