import { useMemo, useState, useEffect, type ReactNode } from "react";
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
  useCheckIn,
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
import { useApiFetch } from "@/lib/api";
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
  ShieldAlert,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";

const today = new Date().toISOString().split("T")[0];

export default function Dashboard() {
  const session = getLeaderSession();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const apiFetch = useApiFetch();
  const [search, setSearch] = useState("");
  const [deleteEventId, setDeleteEventId] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [showPinDialog, setShowPinDialog] = useState(false);
  const [confirmLeaderProfile, setConfirmLeaderProfile] = useState<any>(null);
  const [confirmSuperAdminProfile, setConfirmSuperAdminProfile] =
    useState<any>(null);
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
  const { data: profiles, isLoading: isProfilesLoading } = useListProfiles(
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

  // Load current PIN on mount for super admin
  useEffect(() => {
    async function loadPin() {
      if (session && session.role === "super_admin") {
        try {
          const response = await apiFetch("/api/profiles/me");
          if (response.ok) {
            const data = await response.json();
            if (data.pin_hash) {
              setPin(data.pin_hash);
            }
          }
        } catch (error) {
          console.error("Failed to load PIN:", error);
        }
      }
    }
    loadPin();
  }, [session?.role, apiFetch]);

  const checkIn = useCheckIn();
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

  function handleManualCheckIn(profileId: string) {
    checkIn.mutate(
      { data: { profile_id: profileId, check_in_method: "manual" } },
      {
        onSuccess: () => {
          toast({ title: "Checked in" });
          refreshDashboard();
        },
        onError: (error: Error) =>
          toast({
            title: "Check-in failed",
            description: error.message,
            variant: "destructive",
          }),
      },
    );
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
    } catch (error) {
      toast({
        title: "Delete failed",
        description: "An error occurred",
        variant: "destructive",
      });
    }
  }

  async function handleMakeLeader(profileId: string) {
    try {
      const response = await apiFetch(`/api/profiles/${profileId}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role: "leader" }),
      });

      if (!response.ok) {
        const error = await response.json();
        toast({
          title: "Failed to promote to leader",
          description: error.error || "An error occurred",
          variant: "destructive",
        });
        return;
      }

      const profile = profiles?.find((p: any) => p.id === profileId);
      toast({ title: `${profile?.full_name} is now a Leader` });
      setConfirmLeaderProfile(null);
      refreshDashboard();
    } catch (error) {
      toast({
        title: "Failed to promote to leader",
        description: "An error occurred",
        variant: "destructive",
      });
    }
  }

  async function handleMakeSuperAdmin(profileId: string) {
    try {
      const response = await apiFetch(`/api/profiles/${profileId}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role: "super_admin" }),
      });

      if (!response.ok) {
        const error = await response.json();
        toast({
          title: "Failed to promote to super admin",
          description: error.error || "An error occurred",
          variant: "destructive",
        });
        return;
      }

      const profile = profiles?.find((p: any) => p.id === profileId);
      toast({ title: `${profile?.full_name} is now a Super Admin` });
      setConfirmSuperAdminProfile(null);
      refreshDashboard();
    } catch (error) {
      toast({
        title: "Failed to promote to super admin",
        description: "An error occurred",
        variant: "destructive",
      });
    }
  }

  async function handleSavePin() {
    if (pin.length !== 4) {
      toast({
        title: "Invalid PIN",
        description: "PIN must be 4 digits",
        variant: "destructive",
      });
      return;
    }

    try {
      const response = await apiFetch("/api/profiles/me", {
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

      const data = await response.json();
      setPin(data.pin_hash || pin);
      toast({ title: "PIN saved successfully" });
      setShowPinDialog(false);
    } catch (error) {
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

            <div className="mt-6">
              <SectionTitle title="Manual Check-in" />
              <div className="grid gap-2">
                {membersForCheckIn.slice(0, 8).map((profile: any) => (
                  <div
                    key={profile.id}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div>
                      <p className="font-medium">{profile.full_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {profile.phone || "No phone"} · {profile.role}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => handleManualCheckIn(profile.id)}
                    >
                      Check in
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </TabsContent>

          <TabsContent
            value="members"
            className="p-4 border rounded-xl mt-4 bg-card"
          >
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <SectionTitle title="Member Directory" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name or phone"
                className="sm:max-w-xs"
              />
            </div>

            {session.role === "super_admin" && (
              <div className="mb-4 sticky top-0 z-10 bg-card p-3 rounded-lg border">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-purple-600">
                    Super Admin Slots:{" "}
                    {profiles?.filter((p: any) => p.role === "super_admin")
                      .length || 0}{" "}
                    / 4 filled
                  </p>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all ${
                      (profiles?.filter((p: any) => p.role === "super_admin")
                        .length || 0) >= 4
                        ? "bg-red-500"
                        : "bg-purple-500"
                    }`}
                    style={{
                      width: `${((profiles?.filter((p: any) => p.role === "super_admin").length || 0) / 4) * 100}%`,
                    }}
                  />
                </div>
              </div>
            )}

            {isProfilesLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[...Array(6)].map((_, i) => (
                  <Skeleton key={i} className="h-48 w-full" />
                ))}
              </div>
            ) : profiles && profiles.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {profiles.map((profile: any) => (
                  <div
                    key={profile.id}
                    className="flex flex-col gap-3 rounded-lg border p-4 bg-card"
                  >
                    <div>
                      <p className="text-lg font-bold">{profile.full_name}</p>
                      <p className="text-xs text-muted-foreground mb-2">
                        Joined:{" "}
                        {profile.created_at
                          ? new Date(profile.created_at).toLocaleDateString()
                          : "Unknown"}
                      </p>
                      <Badge
                        variant={
                          profile.role === "super_admin"
                            ? "default"
                            : profile.role === "leader"
                              ? "secondary"
                              : "outline"
                        }
                        className={
                          profile.role === "super_admin"
                            ? "bg-purple-600 hover:bg-purple-700"
                            : profile.role === "leader"
                              ? "bg-blue-600 hover:bg-blue-700"
                              : "bg-gray-600 hover:bg-gray-700"
                        }
                      >
                        {profile.role === "super_admin"
                          ? "Super Admin"
                          : profile.role === "leader"
                            ? "Leader"
                            : profile.role === "member"
                              ? "Member"
                              : profile.role}
                      </Badge>
                    </div>
                    <div className="flex gap-2 mt-auto">
                      {profile.role === "member" &&
                        session &&
                        session.role === "super_admin" && (
                          <Button
                            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                            onClick={() => setConfirmLeaderProfile(profile)}
                          >
                            Make Leader
                          </Button>
                        )}
                      {profile.role === "leader" &&
                        session &&
                        session.role === "super_admin" && (
                          <Button
                            className="flex-1 bg-purple-600 hover:bg-purple-700 text-white"
                            disabled={
                              (profiles?.filter(
                                (p: any) => p.role === "super_admin",
                              ).length || 0) >= 4
                            }
                            title={
                              (profiles?.filter(
                                (p: any) => p.role === "super_admin",
                              ).length || 0) >= 4
                                ? "All 4 super admin slots are filled"
                                : ""
                            }
                            onClick={() => setConfirmSuperAdminProfile(profile)}
                          >
                            Make Super Admin
                          </Button>
                        )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyLine text="No profiles found." />
            )}
          </TabsContent>

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
                      {pin && (
                        <div className="rounded-lg bg-muted p-4">
                          <p className="text-sm text-muted-foreground mb-2">
                            Current PIN:
                          </p>
                          <p className="text-2xl font-bold tracking-widest">
                            ••••
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

      <Dialog open={showPinDialog} onOpenChange={setShowPinDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pin ? "Change PIN" : "Generate PIN"}</DialogTitle>
            <DialogDescription>
              {pin ? "Enter your new 4-digit PIN" : "Generate a new 4-digit PIN for secure authentication"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Input
              type="text"
              placeholder="Enter 4-digit PIN"
              maxLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
              className="text-center text-2xl tracking-widest"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPinDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSavePin}>
              {pin ? "Update PIN" : "Generate PIN"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmLeaderProfile} onOpenChange={() => setConfirmLeaderProfile(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Promote to Leader</AlertDialogTitle>
            <AlertDialogDescription>
              Promote {confirmLeaderProfile?.full_name} to Leader? They will gain access to the leader dashboard and event management.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => handleMakeLeader(confirmLeaderProfile?.id)}>
              Make Leader
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirmSuperAdminProfile} onOpenChange={() => setConfirmSuperAdminProfile(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Promote to Super Admin</AlertDialogTitle>
            <AlertDialogDescription>
              Promote {confirmSuperAdminProfile?.full_name} to Super Admin? This will use slot {profiles?.filter((p: any) => p.role === "super_admin").length || 0 + 1} of 4. Super admin slots are limited.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => handleMakeSuperAdmin(confirmSuperAdminProfile?.id)}>
              Make Super Admin
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );

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
  rows: string[][];
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
