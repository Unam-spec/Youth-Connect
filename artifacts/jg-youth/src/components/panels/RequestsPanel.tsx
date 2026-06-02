import { UserPlus, Star, GraduationCap, Users } from "lucide-react";
import { useListMembershipRequests, getListMembershipRequestsQueryKey } from "@workspace/api-client-react";
import { DashCard, SectionTitle, SkeletonRows, EmptyState, PendingCheckIn, CheckInCard } from "./shared";
import { Button } from "@/components/ui/button";

interface RequestsPanelProps {
  pendingFirstTimers: PendingCheckIn[];
  isPendingLoading: boolean;
  handleApproveCheckIn: (id: string) => void;
  handleRejectCheckIn: (id: string) => void;
  mutateRequest: (action: "approve" | "reject", requestId: string) => void;
}

export function RequestsPanel({
  pendingFirstTimers,
  isPendingLoading,
  handleApproveCheckIn,
  handleRejectCheckIn,
  mutateRequest,
}: RequestsPanelProps) {
  const { data: requests, isLoading: isRequestsLoading } = useListMembershipRequests(
    { status: "pending" },
    {
      query: {
        queryKey: getListMembershipRequestsQueryKey({ status: "pending" }),
      },
    }
  );

  return (
    <div className="space-y-6">
      {/* ── Membership Requests ── */}
      <DashCard>
        <SectionTitle
          title="Membership Requests"
          icon={<UserPlus className="h-4 w-4 text-amber-400" />}
        />
        <p className="text-xs text-muted-foreground mb-4">
          People who have registered and want to become members.
        </p>
        {isRequestsLoading ? (
          <SkeletonRows count={2} />
        ) : requests && requests.length > 0 ? (
          <div className="space-y-2">
            {requests.map((req: any) => (
              <div
                key={req.id}
                className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between hover:border-amber-500/30 transition-colors"
              >
                <div>
                  <p className="font-semibold text-sm">
                    {req.profile?.full_name ?? "Unknown"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {req.profile?.phone ?? "No phone"}
                  </p>
                  {req.reason && (
                    <p className="text-xs italic text-muted-foreground mt-2 bg-muted p-2 rounded-md">
                      "{req.reason}"
                    </p>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button
                    size="sm"
                    onClick={() => mutateRequest("approve", req.id)}
                    className="h-7 text-xs bg-primary hover:bg-primary/90 text-primary-foreground border-0"
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => mutateRequest("reject", req.id)}
                    className="h-7 text-xs"
                  >
                    Reject
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState text="No pending membership requests." />
        )}
      </DashCard>

      {/* ── First Timers ── */}
      <DashCard>
        <div className="flex items-center justify-between mb-1">
          <SectionTitle
            title="First Timer Check-in Approvals"
            icon={<Star className="h-4 w-4 text-amber-400" />}
          />
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          People visiting for the first time who need to be checked in.
        </p>
        {isPendingLoading && pendingFirstTimers.length === 0 ? (
          <SkeletonRows />
        ) : pendingFirstTimers.length > 0 ? (
          <div className="space-y-3">
            {pendingFirstTimers.map((req) => (
              <div key={req.id} className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 flex flex-col sm:flex-row gap-4 sm:items-start sm:justify-between hover:border-amber-500/50 transition-colors">
                <div className="space-y-3 flex-1">
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-full flex items-center justify-center text-sm font-bold bg-amber-500/20 text-amber-600 dark:text-amber-400 shrink-0">
                      {req.name?.charAt(0)?.toUpperCase() ?? "?"}
                    </div>
                    <div>
                      <p className="font-bold text-base text-foreground flex items-center gap-2">
                        {req.name}
                        <span className="text-[10px] font-bold uppercase tracking-wider text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded-md border border-amber-500/20">
                          New
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {req.phone ?? "No phone"}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {req.age && (
                      <div className="flex flex-col bg-muted/40 rounded-lg p-2 border border-border">
                        <span className="text-muted-foreground font-medium mb-0.5">Age</span>
                        <span className="font-semibold">{req.age}</span>
                      </div>
                    )}
                    {req.school && (
                      <div className="flex flex-col bg-muted/40 rounded-lg p-2 border border-border">
                        <span className="text-muted-foreground font-medium mb-0.5 flex items-center gap-1">
                          <GraduationCap className="w-3 h-3" /> School
                        </span>
                        <span className="font-semibold truncate" title={req.school}>{req.school}</span>
                      </div>
                    )}
                    {req.parent_phone && (
                      <div className="flex flex-col bg-muted/40 rounded-lg p-2 border border-border col-span-2 sm:col-span-1">
                        <span className="text-muted-foreground font-medium mb-0.5 flex items-center gap-1">
                          <Users className="w-3 h-3" /> Parent Phone
                        </span>
                        <span className="font-semibold">{req.parent_phone}</span>
                      </div>
                    )}
                    {req.how_did_you_hear && (
                      <div className="flex flex-col bg-muted/40 rounded-lg p-2 border border-border col-span-2 sm:col-span-1">
                        <span className="text-muted-foreground font-medium mb-0.5">Discovery</span>
                        <span className="font-semibold truncate" title={req.how_did_you_hear}>{req.how_did_you_hear}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex sm:flex-col gap-2 shrink-0 w-full sm:w-auto pt-2 sm:pt-0 border-t border-border/50 sm:border-t-0">
                  <Button
                    size="sm"
                    onClick={() => handleApproveCheckIn(req.id)}
                    className="flex-1 sm:flex-none h-9 bg-amber-500 hover:bg-amber-400 text-white font-semibold border-0 shadow-sm"
                  >
                    Check In
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleRejectCheckIn(req.id)}
                    className="flex-1 sm:flex-none h-9 border-amber-500/20 hover:bg-destructive/10 hover:text-destructive"
                  >
                    Reject
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState text="No pending first-timers right now." />
        )}
      </DashCard>
    </div>
  );
}
