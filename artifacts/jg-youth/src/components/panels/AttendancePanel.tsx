import { CheckCircle, RefreshCw, UserCheck } from "lucide-react";
import { useGetTodayAttendance } from "@workspace/api-client-react";
import { getGetTodayAttendanceQueryKey } from "@workspace/api-client-react";
import { format } from "date-fns";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  DashCard,
  SectionTitle,
  SkeletonRows,
  SimpleTable,
  EmptyState,
  CheckInCard,
  PendingCheckIn,
} from "./shared";

interface AttendancePanelProps {
  pendingCheckIns: PendingCheckIn[];
  isPendingLoading: boolean;
  fetchPendingCheckIns: () => void;
  handleApproveCheckIn: (id: string) => void;
  handleRejectCheckIn: (id: string) => void;
}

export function AttendancePanel({
  pendingCheckIns,
  isPendingLoading,
  fetchPendingCheckIns,
  handleApproveCheckIn,
  handleRejectCheckIn,
}: AttendancePanelProps) {
  const { data: attendance, isLoading: isAttendanceLoading } = useGetTodayAttendance({
    query: { queryKey: getGetTodayAttendanceQueryKey() },
  });

  // Members plus first-timers who opted in to membership at registration.
  const pendingMemberCheckIns = useMemo(
    () => pendingCheckIns.filter((r) => r.type === "member" || r.wants_membership),
    [pendingCheckIns]
  );

  return (
    <div className="space-y-4">
      {/* ── Today's Check-ins ── */}
      <DashCard>
        <SectionTitle
          title="Today's Check-ins"
          icon={<CheckCircle className="h-4 w-4 text-primary" />}
        />
        {isAttendanceLoading ? (
          <SkeletonRows />
        ) : attendance && attendance.length > 0 ? (
          <SimpleTable
            headers={["Name", "Role", "Time", "Method"]}
            rows={attendance.map((r: any) => [
              r.profile?.full_name ?? "Unknown",
              r.profile?.role ?? "-",
              format(new Date(r.checked_in_at), "HH:mm"),
              r.check_in_method,
            ])}
          />
        ) : (
          <EmptyState text="No one has checked in today yet." />
        )}
      </DashCard>

      {/* ── Check-in Approvals ── */}
      <DashCard>
        <div className="flex items-center justify-between mb-1">
          <SectionTitle
            title="Member Check-in Approvals"
            icon={<UserCheck className="h-4 w-4 text-primary" />}
          />
          <Button
            id="btn-refresh-checkins"
            variant="ghost"
            size="sm"
            onClick={fetchPendingCheckIns}
            disabled={isPendingLoading}
            className="text-muted-foreground hover:text-primary -mt-4"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 mr-1 ${isPendingLoading ? "animate-spin" : ""}`}
            />{" "}
            Refresh
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Members who requested check-in, plus first-timers who chose to become a
          member at registration. Auto-refreshes every 30s.
        </p>
        {isPendingLoading && pendingMemberCheckIns.length === 0 ? (
          <SkeletonRows />
        ) : pendingMemberCheckIns.length > 0 ? (
          <div className="space-y-2">
            {pendingMemberCheckIns.map((req) => (
              <CheckInCard
                key={req.id}
                req={req}
                onApprove={() => handleApproveCheckIn(req.id)}
                onReject={() => handleRejectCheckIn(req.id)}
              />
            ))}
          </div>
        ) : (
          <EmptyState text="No pending member check-in requests right now." />
        )}
      </DashCard>
    </div>
  );
}
