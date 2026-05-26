import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@clerk/react";
import { format } from "date-fns";
import { Redirect } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetDashboardKpisQueryKey,
  getGetTodayAttendanceQueryKey,
  getListEventsQueryKey,
  getListLeadersQueryKey,
  getListMembershipRequestsQueryKey,
  getListProfilesQueryKey,
  useApproveMembershipRequest,
  useCreateEvent,
  useGetDashboardKpis,
  useGetTodayAttendance,
  useListEvents,
  useListLeaders,
  useListMembershipRequests,
  useListProfiles,
  usePromoteToMember,
  useRejectMembershipRequest,
  useRevokeMembership,
} from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { getLeaderSession } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Calendar,
  CheckCircle,
  QrCode,
  RefreshCw,
  ShieldAlert,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";

const today = new Date().toISOString().split("T")[0];

// ── Leader-session-aware fetch wrapper ────────────────────────────────────────

/**
 * Returns a fetch wrapper that automatically attaches the x-leader-session
 * header from localStorage on every request. This allows PIN-authenticated
 * leaders to call protected API endpoints without a Clerk JWT.
 */
function useApiFetch() {
  const { getToken } = useAuth();
  return useCallback(async (url: string, init?: RequestInit) => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    try {
      const token = await getToken();
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
    } catch {
      // ignore
    }

    // Attach leader session if present and not expired
    try {
      const sessionStr = localStorage.getItem("jg_leader_session");
      if (sessionStr) {
        const session: { expires_at?: number } = JSON.parse(sessionStr);
        if (
          typeof session.expires_at === "number" &&
          Date.now() < session.expires_at
        ) {
          headers["x-leader-session"] = sessionStr;
        }
      }
    } catch {
      // ignore malformed session
    }

    return fetch(url, {
      ...init,
      headers: { ...headers, ...(init?.headers as Record<string, string>) },
    });
  }, [getToken]);
}

// ── Pending check-in request type ────────────────────────────────────────────

interface PendingCheckIn {
  id: string;
  name: string;
  phone: string | null;
  type: "member" | "visitor";
  role: string;
  requested_at: string;
}

// ── Dashboard component ───────────────────────────────────────────────────────

export default function Dashboard() {
  const session = getLeaderSession();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const apiFetch = useApiFetch();
  const [search, setSearch] = useState("");
  const [deleteEventId, setDeleteEventId] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [showPinDialog, setShowPinDialog] = useState(false);
  const [hasPin, setHasPin] = useState(false);
  const [roleConfirm, setRoleConfirm] = useState<{
    profile: any;
    targetRole: "leader" | "super_admin";
  } | null>(null);

  const fetchHasPin = useCallback(async () => {
    try {
      const response = await apiFetch("/api/profiles/me/pin");
      if (response.ok) {
        const data = await response.json();
        setHasPin(data.hasPIN);
      }
    } catch {
      // ignore
    }
  }, [apiFetch]);

  useEffect(() => {
    fetchHasPin();
  }, [fetchHasPin]);

  useEffect(() => {
    if (showPinDialog) {
      setPin("");
    }
  }, [showPinDialog]);

  const [pendingCheckIns, setPendingCheckIns] = useState<PendingCheckIn[]>([]);
  const [isPendingLoading, setIsPendingLoading] = useState(false);
  const pendingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const [eventForm, setEventForm] = useState({
    title: "",
    description: "",
    date: today,
    time: "18:00",
    location: "",
    age_min: "",
    age_max: "",
    is_public: true,
  });

  if (!session) {
    return <Redirect to="/leader-login" />;
  }

  const { data: kpis, isLoading: isKpisLoading } = useGetDashboardKpis({
    query: { queryKey: getGetDashboardKpisQueryKey() },
  });
  const { data: attendance, isLoading: isAttendanceLoading } =
    useGetTodayAttendance({
      query: { queryKey: getGetTodayAttendanceQueryKey() },
    });
  const {
    data: profiles,
    isLoading: isProfilesLoading,
    isError: isProfilesError,
    refetch: refetchProfiles,
  } = useListProfiles(
    search ? { search } : undefined,
    {
      query: {
        queryKey: getListProfilesQueryKey(search ? { search } : undefined),
      },
    },
  );
  const { data: events, isLoading: isEventsLoading } = useListEvents(
    undefined,
    {
      query: { queryKey: getListEventsQueryKey() },
    },
  );
  const { data: requests, isLoading: isRequestsLoading } =
    useListMembershipRequests(
      { status: "pending" },
      {
        query: {
          queryKey: getListMembershipRequestsQueryKey({ status: "pending" }),
        },
      },
    );
  const { data: leaders, isLoading: isLeadersLoading } = useListLeaders({
    query: {
      enabled: session.role === "super_admin",
      queryKey: getListLeadersQueryKey(),
    },
  });

  const createEvent = useCreateEvent();
  const promoteToMember = usePromoteToMember();
  const revokeMembership = useRevokeMembership();
  const approveRequest = useApproveMembershipRequest();
  const rejectRequest = useRejectMembershipRequest();

  const membersForCheckIn = useMemo(
    () =>
      profiles?.filter(
        (profile: any) =>
          profile.role === "member" || profile.role === "visitor",
      ) ?? [],
    [profiles],
  );

  // ── Pending check-in approvals ──────────────────────────────────────────────

  const fetchPendingCheckIns = useCallback(async () => {
    setIsPendingLoading(true);
    try {
      const response = await apiFetch("/api/checkin/requests?status=pending");
      if (response.ok) {
        const data = await response.json();
        setPendingCheckIns(data);
      }
    } catch {
      // silently ignore network errors on background refresh
    } finally {
      setIsPendingLoading(false);
    }
  }, [apiFetch]);

  // Initial fetch + auto-refresh every 30 seconds
  useEffect(() => {
    fetchPendingCheckIns();

    pendingIntervalRef.current = setInterval(fetchPendingCheckIns, 30_000);

    return () => {
      if (pendingIntervalRef.current) {
        clearInterval(pendingIntervalRef.current);
      }
    };
  }, [fetchPendingCheckIns]);

  // ── Dashboard helpers ───────────────────────────────────────────────────────

  function refreshDashboard() {
    queryClient.invalidateQueries({ queryKey: getGetDashboardKpisQueryKey() });
    queryClient.invalidateQueries({
      queryKey: getGetTodayAttendanceQueryKey(),
    });
    queryClient.invalidateQueries({ queryKey: getListProfilesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListEventsQueryKey() });
    queryClient.invalidateQueries({
      queryKey: getListMembershipRequestsQueryKey({ status: "pending" }),
    });
    queryClient.invalidateQueries({ queryKey: getListLeadersQueryKey() });
  }

  function handleCreateEvent() {
    if (
      !eventForm.title ||
      !eventForm.date ||
      !eventForm.time ||
      !eventForm.location
    ) {
      toast({
        title: "Missing event details",
        description: "Title, date, time, and location are required.",
        variant: "destructive",
      });
      return;
    }

    createEvent.mutate(
      {
        data: {
          title: eventForm.title,
          description: eventForm.description || undefined,
          date: eventForm.date,
          time: eventForm.time,
          location: eventForm.location,
          age_min: eventForm.age_min ? Number(eventForm.age_min) : null,
          age_max: eventForm.age_max ? Number(eventForm.age_max) : null,
          custom_requirements: [],
          is_public: eventForm.is_public,
        },
      },
      {
        onSuccess: () => {
          setEventForm({
            title: "",
            description: "",
            date: today,
            time: "18:00",
            location: "",
            age_min: "",
            age_max: "",
            is_public: true,
          });
          toast({ title: "Event created" });
          refreshDashboard();
        },
        onError: (error: Error) =>
          toast({
            title: "Event creation failed",
            description: error.message,
            variant: "destructive",
          }),
      },
    );
  }

  async function handleDeleteEvent() {
    if (!deleteEventId) return;

    try {
      const response = await apiFetch(`/api/events/${deleteEventId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const error = await response.json();
        toast({
          title: "Delete failed",
          description: error.error || "An error occurred",
          variant: "destructive",
        });
        return;
      }

      toast({ title: "Event deleted successfully" });
      setDeleteEventId(null);
      refreshDashboard();
    } catch {
      toast({
        title: "Delete failed",
        description: "An error occurred",
        variant: "destructive",
      });
    }
  }

  async function handleConfirmRoleChange() {
    if (!roleConfirm) return;
    const { profile, targetRole } = roleConfirm;
    setRoleConfirm(null);

    // Optimistically update the cache immediately!
    queryClient.setQueryData(
      getListProfilesQueryKey(search ? { search } : undefined),
      (prev: any) => {
        if (!prev) return prev;
        return prev.map((p: any) =>
          p.id === profile.id ? { ...p, role: targetRole } : p
        );
      }
    );

    try {
      const response = await apiFetch(`/api/profiles/${profile.id}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role: targetRole }),
      });

      if (!response.ok) {
        const error = await response.json();
        toast({
          title: "Failed to update role",
          description: error.error || "An error occurred",
          variant: "destructive",
        });
        refreshDashboard();
        return;
      }

      toast({
        title: "Role updated successfully",
        description: `${profile.full_name} is now a ${targetRole.replace("_", " ")}`,
      });
      refreshDashboard();
    } catch {
      toast({
        title: "Failed to update role",
        description: "An error occurred",
        variant: "destructive",
      });
      refreshDashboard();
    }
  }

  async function handleSavePin() {
    if (pin.length !== 4) return;

    try {
      const response = await apiFetch("/api/profiles/me/pin", {
        method: "PATCH",
        body: JSON.stringify({ pin }),
      });

      if (!response.ok) {
        const error = await response.json();
        toast({
          title: "Failed to save PIN",
          description: error.error || "An error occurred",
          variant: "destructive",
        });
        return;
      }

      toast({ title: "PIN updated successfully" });
      setShowPinDialog(false);
      fetchHasPin();
    } catch {
      toast({
        title: "Failed to save PIN",
        description: "An error occurred",
        variant: "destructive",
      });
    }
  }

  function mutateProfileRole(action: "promote" | "revoke", profileId: string) {
    const mutation = action === "promote" ? promoteToMember : revokeMembership;
    mutation.mutate(
      { id: profileId },
      {
        onSuccess: () => {
          toast({
            title:
              action === "promote"
                ? "Promoted to member"
                : "Membership revoked",
          });
          refreshDashboard();
        },
        onError: (error: Error) =>
          toast({
            title: "Profile update failed",
            description: error.message,
            variant: "destructive",
          }),
      },
    );
  }

  function mutateRequest(action: "approve" | "reject", requestId: string) {
    const mutation = action === "approve" ? approveRequest : rejectRequest;
    mutation.mutate(
      { id: requestId },
      {
        onSuccess: () => {
          toast({
            title:
              action === "approve" ? "Request approved" : "Request rejected",
          });
          refreshDashboard();
        },
        onError: (error: Error) =>
          toast({
            title: "Request update failed",
            description: error.message,
            variant: "destructive",
          }),
      },
    );
  }

  // ── Check-in approval handlers ────────────────────────────────────────────

  async function handleApproveCheckIn(requestId: string) {
    try {
      const response = await apiFetch(
        `/api/checkin/requests/${requestId}/approve`,
        { method: "PATCH" },
      );
      if (!response.ok) {
        const error = await response.json();
        toast({
          title: "Approval failed",
          description: error.error || "An error occurred",
          variant: "destructive",
        });
        return;
      }
      toast({ title: "Check-in approved" });
      // Remove from local list immediately, then refresh
      setPendingCheckIns((prev) => prev.filter((r) => r.id !== requestId));
      refreshDashboard();
    } catch {
      toast({
        title: "Approval failed",
        description: "An error occurred",
        variant: "destructive",
      });
    }
  }

  async function handleRejectCheckIn(requestId: string) {
    try {
      const response = await apiFetch(
        `/api/checkin/requests/${requestId}/reject`,
        { method: "PATCH" },
      );
      if (!response.ok) {
        const error = await response.json();
        toast({
          title: "Rejection failed",
          description: error.error || "An error occurred",
          variant: "destructive",
        });
        return;
      }
      toast({ title: "Check-in rejected" });
      // Remove from local list immediately
      setPendingCheckIns((prev) => prev.filter((r) => r.id !== requestId));
    } catch {
      toast({
        title: "Rejection failed",
        description: "An error occurred",
        variant: "destructive",
      });
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const superAdminCount = profiles?.filter((p: any) => p.role === "super_admin").length ?? 0;

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Leader Dashboard
            </h1>
            <p className="text-muted-foreground mt-1">
              Live attendance, members, events, and requests.
            </p>
          </div>
          <Badge
            variant={session.role === "super_admin" ? "default" : "secondary"}
          >
            {session.role.replace("_", " ")}
          </Badge>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            title="Total Members"
            icon={<Users className="h-4 w-4 text-muted-foreground" />}
            value={kpis?.total_members}
            loading={isKpisLoading}
          />
          <KpiCard
            title="Today's Attendance"
            icon={<CheckCircle className="h-4 w-4 text-primary" />}
            value={kpis?.today_attendance}
            loading={isKpisLoading}
          />
          <KpiCard
            title="New Visitors Today"
            icon={<UserPlus className="h-4 w-4 text-muted-foreground" />}
            value={kpis?.today_new_visitors}
            loading={isKpisLoading}
          />
          <KpiCard
            title="Upcoming Events"
            icon={<Calendar className="h-4 w-4 text-muted-foreground" />}
            value={kpis?.upcoming_events_count}
            loading={isKpisLoading}
          />
        </div>

        <Tabs defaultValue="attendance" className="mt-8">
          <TabsList className="grid grid-cols-2 md:grid-cols-5 h-auto md:h-10 gap-2 md:gap-0">
            <TabsTrigger value="attendance">Today</TabsTrigger>
            <TabsTrigger value="checkin-approvals">
              Check-ins
              {pendingCheckIns.length > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground text-xs w-5 h-5 font-semibold">
                  {pendingCheckIns.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="members">Members</TabsTrigger>
            <TabsTrigger value="events">Events</TabsTrigger>
            <TabsTrigger value="requests">Requests</TabsTrigger>
            {session.role === "super_admin" && (
              <TabsTrigger value="leaders">Leaders</TabsTrigger>
            )}
            {session.role === "super_admin" && (
              <TabsTrigger value="super-admin-slots">
                Super Admin Slots
              </TabsTrigger>
            )}
          </TabsList>

          {/* ── Today's attendance ─────────────────────────────────────────── */}
          <TabsContent
            value="attendance"
            className="p-4 border rounded-xl mt-4 bg-card"
          >
            <SectionTitle title="Today's Check-ins" />
            {isAttendanceLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : attendance && attendance.length > 0 ? (
              <SimpleTable
                headers={["Name", "Role", "Time", "Method"]}
                rows={attendance.map((record: any) => [
                  record.profile?.full_name ?? "Unknown",
                  record.profile?.role ?? "-",
                  format(new Date(record.checked_in_at), "HH:mm"),
                  record.check_in_method,
                ])}
              />
            ) : (
              <EmptyLine text="No one has checked in today yet." />
            )}
          </TabsContent>

          {/* ── Pending check-in approvals ─────────────────────────────────── */}
          <TabsContent
            value="checkin-approvals"
            className="p-4 border rounded-xl mt-4 bg-card"
          >
            <div className="flex items-center justify-between mb-4">
              <SectionTitle title="Pending Check-in Approvals" />
              <Button
                variant="ghost"
                size="sm"
                onClick={fetchPendingCheckIns}
                disabled={isPendingLoading}
                className="text-muted-foreground"
              >
                <RefreshCw
                  className={`w-4 h-4 mr-1.5 ${isPendingLoading ? "animate-spin" : ""}`}
                />
                Refresh
              </Button>
            </div>

            <p className="text-xs text-muted-foreground mb-4">
              Auto-refreshes every 30 seconds. First-timers are labelled{" "}
              <span className="font-medium text-foreground">visitor</span>.
            </p>

            {isPendingLoading && pendingCheckIns.length === 0 ? (
              <div className="space-y-3">
                <Skeleton className="h-16 w-full rounded-lg" />
                <Skeleton className="h-16 w-full rounded-lg" />
              </div>
            ) : pendingCheckIns.length > 0 ? (
              <div className="space-y-2">
                {pendingCheckIns.map((req) => (
                  <div
                    key={req.id}
                    className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{req.name}</p>
                        {req.type === "visitor" && (
                          <Badge variant="outline" className="text-xs">
                            First Timer
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {req.phone ?? "No phone"} ·{" "}
                        {format(new Date(req.requested_at), "HH:mm")}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => handleApproveCheckIn(req.id)}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleRejectCheckIn(req.id)}
                      >
                        Reject
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyLine text="No pending check-in requests right now." />
            )}
          </TabsContent>

          {/* ── Members ────────────────────────────────────────────────────── */}
          <TabsContent
            value="members"
            className="p-4 border rounded-xl mt-4 bg-card"
          >
            <div className="mb-4 bg-purple-500/10 border border-purple-500/20 text-purple-300 rounded-lg p-3 text-sm flex items-center justify-between">
              <span className="font-medium">Super Admin Slots: {superAdminCount} / 4</span>
              <span className="text-xs text-purple-400 font-semibold">Max 4 allowed</span>
            </div>

            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <SectionTitle title="Member Directory" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name or phone"
                className="sm:max-w-xs"
              />
            </div>
            {isProfilesLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-16 w-full rounded-lg" />
                <Skeleton className="h-16 w-full rounded-lg" />
                <Skeleton className="h-16 w-full rounded-lg" />
              </div>
            ) : isProfilesError ? (
              <div
                onClick={() => refetchProfiles()}
                className="flex flex-col items-center justify-center p-6 border border-dashed rounded-lg cursor-pointer hover:bg-muted/50 transition-colors"
              >
                <p className="text-sm text-destructive font-medium mb-1">
                  Could not load members, tap to retry
                </p>
                <p className="text-xs text-muted-foreground">
                  Tap anywhere in this box to reload the directory
                </p>
              </div>
            ) : profiles && profiles.length > 0 ? (
              <div className="space-y-2">
                {profiles.map((profile: any) => (
                  <div
                    key={profile.id}
                    className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="font-medium">{profile.full_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {profile.phone || "No phone"} ·{" "}
                        {profile.email || "No email"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <RoleBadge role={profile.role} />
                      {profile.role === "visitor" && (
                        <Button
                          size="sm"
                          onClick={() =>
                            mutateProfileRole("promote", profile.id)
                          }
                        >
                          Make member
                        </Button>
                      )}
                      {profile.role === "member" && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              mutateProfileRole("revoke", profile.id)
                            }
                          >
                            Revoke
                          </Button>
                          {session.role === "super_admin" && (
                            <Button
                              size="sm"
                              onClick={() => setRoleConfirm({ profile, targetRole: "leader" })}
                            >
                              Make Leader
                            </Button>
                          )}
                        </>
                      )}
                      {profile.role === "leader" && (
                        <>
                          {session.role === "super_admin" && (
                            <Button
                              size="sm"
                              onClick={() => setRoleConfirm({ profile, targetRole: "super_admin" })}
                            >
                              Make Super Admin
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyLine text="No members yet" />
            )}
          </TabsContent>

          {/* ── Events ─────────────────────────────────────────────────────── */}
          <TabsContent
            value="events"
            className="p-4 border rounded-xl mt-4 bg-card"
          >
            <SectionTitle title="Create Event" />
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                value={eventForm.title}
                onChange={(event) =>
                  setEventForm((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                placeholder="Event title"
              />
              <Input
                value={eventForm.location}
                onChange={(event) =>
                  setEventForm((current) => ({
                    ...current,
                    location: event.target.value,
                  }))
                }
                placeholder="Location"
              />
              <Input
                type="date"
                value={eventForm.date}
                onChange={(event) =>
                  setEventForm((current) => ({
                    ...current,
                    date: event.target.value,
                  }))
                }
              />
              <Input
                type="time"
                value={eventForm.time}
                onChange={(event) =>
                  setEventForm((current) => ({
                    ...current,
                    time: event.target.value,
                  }))
                }
              />
              <Input
                type="number"
                value={eventForm.age_min}
                onChange={(event) =>
                  setEventForm((current) => ({
                    ...current,
                    age_min: event.target.value,
                  }))
                }
                placeholder="Min age"
              />
              <Input
                type="number"
                value={eventForm.age_max}
                onChange={(event) =>
                  setEventForm((current) => ({
                    ...current,
                    age_max: event.target.value,
                  }))
                }
                placeholder="Max age"
              />
              <Textarea
                value={eventForm.description}
                onChange={(event) =>
                  setEventForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                placeholder="Description"
                className="md:col-span-2"
              />
              <div className="flex items-center gap-3">
                <Switch
                  checked={eventForm.is_public}
                  onCheckedChange={(checked) =>
                    setEventForm((current) => ({
                      ...current,
                      is_public: checked,
                    }))
                  }
                />
                <Label>Show on landing page and member dashboards</Label>
              </div>
              <Button
                onClick={handleCreateEvent}
                disabled={createEvent.isPending}
              >
                {createEvent.isPending ? "Creating..." : "Create event"}
              </Button>
            </div>

            <div className="mt-8">
              <div className="flex items-center justify-between mb-4">
                <SectionTitle title="Events" />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    toast({
                      title: "QR Code generated for this Friday session",
                    });
                  }}
                >
                  <QrCode className="w-4 h-4 mr-2" />
                  Generate QR Code
                </Button>
              </div>
              {isEventsLoading ? (
                <Skeleton className="h-32 w-full" />
              ) : events && events.length > 0 ? (
                <SimpleTable
                  headers={[
                    "Title",
                    "Date",
                    "Time",
                    "Location",
                    "Visibility",
                    "Actions",
                  ]}
                  rows={events.map((event: any) => [
                    event.title,
                    format(new Date(event.date), "MMM d, yyyy"),
                    event.time,
                    event.location,
                    event.is_public ? "Public" : "Internal",
                    session.role === "leader" ||
                    session.role === "super_admin" ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteEventId(event.id)}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    ) : null,
                  ])}
                />
              ) : (
                <EmptyLine text="No events created yet." />
              )}
            </div>
          </TabsContent>

          {/* ── Membership requests ────────────────────────────────────────── */}
          <TabsContent
            value="requests"
            className="p-4 border rounded-xl mt-4 bg-card"
          >
            <SectionTitle title="Membership Requests" />
            {isRequestsLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : requests && requests.length > 0 ? (
              <div className="space-y-2">
                {requests.map((request: any) => (
                  <div
                    key={request.id}
                    className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="font-medium">
                        {request.profile?.full_name ?? "Unknown visitor"}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {request.reason}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => mutateRequest("approve", request.id)}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => mutateRequest("reject", request.id)}
                      >
                        Reject
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyLine text="No pending membership requests." />
            )}
          </TabsContent>

          {/* ── Leaders (super admin only) ─────────────────────────────────── */}
          {session.role === "super_admin" && (
            <TabsContent
              value="leaders"
              className="p-4 border rounded-xl mt-4 bg-card"
            >
              <SectionTitle title="Leader Management" />
              {isLeadersLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : leaders && leaders.length > 0 ? (
                <SimpleTable
                  headers={[
                    "Name",
                    "Role",
                    "Create Events",
                    "Manage Members",
                    "KPIs",
                  ]}
                  rows={leaders.map((leader: any) => [
                    leader.profile?.full_name ?? "Unknown",
                    leader.profile?.role ?? "leader",
                    leader.can_create_events ? "Yes" : "No",
                    leader.can_manage_members ? "Yes" : "No",
                    leader.can_view_kpis ? "Yes" : "No",
                  ])}
                />
              ) : (
                <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  <ShieldAlert className="mb-2 h-5 w-5" />
                  No delegated leaders yet. Use the API/Supabase seed path for
                  the first leader, then leader creation can be added here.
                </div>
              )}
            </TabsContent>
          )}

          {/* ── Super admin slots ──────────────────────────────────────────── */}
          {session.role === "super_admin" && (
            <TabsContent
              value="super-admin-slots"
              className="p-4 border rounded-xl mt-4 bg-card"
            >
              <SectionTitle title="Super Admin Slots" />
              {isProfilesLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">
                      {profiles?.filter((p: any) => p.role === "super_admin")
                        .length || 0}{" "}
                      of 4 slots filled
                    </p>
                  </div>
                  <div className="space-y-2">
                    {profiles
                      ?.filter((p: any) => p.role === "super_admin")
                      .map((admin: any) => (
                        <div
                          key={admin.id}
                          className="flex items-center justify-between rounded-lg border p-3"
                        >
                          <div>
                            <p className="font-medium">{admin.full_name}</p>
                            <p className="text-xs text-muted-foreground">
                              {admin.phone || "No phone"} ·{" "}
                              {admin.email || "No email"}
                            </p>
                          </div>
                          <Badge variant="default">Super Admin</Badge>
                        </div>
                      ))}
                  </div>
                  {(profiles?.filter((p: any) => p.role === "super_admin")
                    .length || 0) >= 4 ? (
                    <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                      All slots filled
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() =>
                        toast({ title: "Transfer feature coming soon" })
                      }
                    >
                      Transfer Super Admin Position
                    </Button>
                  )}

                  <div className="border-t pt-6">
                    <SectionTitle title="PIN Management" />
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium">Your PIN</p>
                          <p className="text-xs text-muted-foreground">
                            Secure PIN for leader authentication
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setShowPinDialog(true)}
                        >
                          {pin ? "Change PIN" : "Generate PIN"}
                        </Button>
                      </div>
                      {hasPin && (
                        <div className="rounded-lg bg-muted p-4">
                          <p className="text-sm text-muted-foreground mb-2">
                            PIN Status:
                          </p>
                          <p className="text-2xl font-bold tracking-widest text-green-400">
                            SECURED ••••
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </TabsContent>
          )}
        </Tabs>
      </div>

      {/* ── Delete event confirmation ─────────────────────────────────────── */}
      <AlertDialog
        open={!!deleteEventId}
        onOpenChange={(open) => !open && setDeleteEventId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Event</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this event? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteEvent}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Role confirmation dialog ─────────────────────────────────────── */}
      <AlertDialog
        open={!!roleConfirm}
        onOpenChange={(open) => !open && setRoleConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change User Role</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to promote <strong>{roleConfirm?.profile?.full_name}</strong> to <strong>{roleConfirm?.targetRole.replace("_", " ")}</strong>?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmRoleChange}>
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── PIN dialog ────────────────────────────────────────────────────── */}
      <Dialog open={showPinDialog} onOpenChange={setShowPinDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{hasPin ? "Change PIN" : "Generate PIN"}</DialogTitle>
            <DialogDescription>
              {hasPin
                ? "Update your 4-digit PIN for secure leader authentication"
                : "Create a new 4-digit PIN for secure leader authentication"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Input
              type="password"
              placeholder="Enter 4-digit PIN"
              maxLength={4}
              value={pin}
              onChange={(e) =>
                setPin(e.target.value.replace(/\D/g, "").slice(0, 4))
              }
              className="text-center text-2xl tracking-widest"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPinDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSavePin} disabled={pin.length !== 4}>
              {hasPin ? "Update PIN" : "Generate PIN"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: string }) {
  let classes = "border-transparent ";
  switch (role) {
    case "super_admin":
      classes += "bg-purple-500/10 text-purple-400 border-purple-500/20 border";
      break;
    case "leader":
      classes += "bg-blue-500/10 text-blue-400 border-blue-500/20 border";
      break;
    case "member":
      classes += "bg-muted text-muted-foreground border-transparent border";
      break;
    default:
      // visitor or other roles
      classes += "bg-secondary text-secondary-foreground border-transparent border";
  }

  return (
    <Badge className={classes} variant="outline">
      {role.replace("_", " ")}
    </Badge>
  );
}

function KpiCard({
  title,
  value,
  loading,
  icon,
}: {
  title: string;
  value?: number;
  loading: boolean;
  icon: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-7 w-16" />
        ) : (
          <div className="text-2xl font-bold">{value ?? 0}</div>
        )}
      </CardContent>
    </Card>
  );
}

function SectionTitle({ title }: { title: string }) {
  return <h3 className="mb-4 text-lg font-semibold">{title}</h3>;
}

function EmptyLine({ text }: { text: string }) {
  return <p className="text-sm text-muted-foreground">{text}</p>;
}

function SimpleTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: (string | ReactNode)[][];
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left">
          <tr>
            {headers.map((header) => (
              <th key={header} className="px-3 py-2 font-medium">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-t">
              {row.map((cell, cellIndex) => (
                <td key={`${rowIndex}-${cellIndex}`} className="px-3 py-2">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
