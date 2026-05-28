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
import { getLeaderSession, setLeaderSession, LeaderSession } from "@/lib/auth";
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
  Eye,
  EyeOff,
  QrCode,
  RefreshCw,
  ShieldAlert,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

const today = new Date().toISOString().split("T")[0];

function useApiFetch() {
  const { getToken } = useAuth();
  return useCallback(
    async (url: string, init?: RequestInit) => {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      try {
        const token = await getToken();
        if (token) headers["Authorization"] = `Bearer ${token}`;
      } catch { /* ignore */ }
      try {
        const sessionStr = localStorage.getItem("jg_leader_session");
        if (sessionStr) {
          const session: { expires_at?: number } = JSON.parse(sessionStr);
          if (typeof session.expires_at === "number" && Date.now() < session.expires_at) {
            headers["x-leader-session"] = sessionStr;
          }
        }
      } catch { /* ignore */ }
      return fetch(url, {
        ...init,
        headers: { ...headers, ...(init?.headers as Record<string, string>) },
      });
    },
    [getToken],
  );
}

interface PendingCheckIn {
  id: string;
  name: string;
  phone: string | null;
  type: "member" | "visitor";
  role: string;
  requested_at: string;
}

interface LeaderPin {
  id: string;
  full_name: string;
  phone: string | null;
  pin_plain: string | null;
}

export default function Dashboard() {
  const session = getLeaderSession();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const apiFetch = useApiFetch();

  // ── All useState first ───────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [deleteEventId, setDeleteEventId] = useState<string | null>(null);
  const [deleteEventName, setDeleteEventName] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [showPinDialog, setShowPinDialog] = useState(false);
  const [hasPin, setHasPin] = useState(false);
  const [roleConfirm, setRoleConfirm] = useState<{
    profile: any;
    targetRole: "leader" | "super_admin";
  } | null>(null);
  const [isUpdatingPermissions, setIsUpdatingPermissions] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [showSessionQrCodeDialog, setShowSessionQrCodeDialog] = useState(false);
  const [isGeneratingQr, setIsGeneratingQr] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [rsvps, setRsvps] = useState<any[]>([]);
  const [isRsvpsLoading, setIsRsvpsLoading] = useState(false);
  const [leaderPins, setLeaderPins] = useState<LeaderPin[]>([]);
  const [isLeaderPinsLoading, setIsLeaderPinsLoading] = useState(false);
  const [revealedPins, setRevealedPins] = useState<Record<string, boolean>>({});
  const [pendingCheckIns, setPendingCheckIns] = useState<PendingCheckIn[]>([]);
  const [isPendingLoading, setIsPendingLoading] = useState(false);
  const pendingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [kpisUpdatedAt, setKpisUpdatedAt] = useState<string | null>(null);
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

  // ── All react-query hooks ────────────────────────────────────────────────
  const { data: kpis, isLoading: isKpisLoading, refetch: refetchKpis } = useGetDashboardKpis({
    query: { queryKey: getGetDashboardKpisQueryKey() },
  });
  const { data: events, isLoading: isEventsLoading } = useListEvents(undefined, {
    query: { queryKey: getListEventsQueryKey() },
  });
  const { data: attendance, isLoading: isAttendanceLoading } = useGetTodayAttendance({
    query: { queryKey: getGetTodayAttendanceQueryKey() },
  });
  const {
    data: profiles,
    isLoading: isProfilesLoading,
    isError: isProfilesError,
    refetch: refetchProfiles,
  } = useListProfiles(
    search ? { search } : undefined,
    { query: { queryKey: getListProfilesQueryKey(search ? { search } : undefined) } },
  );
  const { data: requests, isLoading: isRequestsLoading } = useListMembershipRequests(
    { status: "pending" },
    { query: { queryKey: getListMembershipRequestsQueryKey({ status: "pending" }) } },
  );
  const { data: leaders, isLoading: isLeadersLoading } = useListLeaders({
    query: { queryKey: getListLeadersQueryKey() },
  });

  const createEvent = useCreateEvent();
  const promoteToMember = usePromoteToMember();
  const revokeMembership = useRevokeMembership();
  const approveRequest = useApproveMembershipRequest();
  const rejectRequest = useRejectMembershipRequest();

  // ── Callbacks (stable refs, safe before useEffect) ───────────────────────
  const fetchHasPin = useCallback(async () => {
    try {
      const res = await apiFetch("/api/profiles/me/pin");
      if (res.ok) {
        const data = await res.json();
        setHasPin(data.hasPIN);
      }
    } catch { /* ignore */ }
  }, [apiFetch]);

  const fetchRsvps = useCallback(async () => {
    if (!selectedEventId) { setRsvps([]); return; }
    setIsRsvpsLoading(true);
    try {
      const res = await apiFetch(`/api/rsvps?event_id=${selectedEventId}`);
      if (res.ok) setRsvps(await res.json());
    } catch { /* ignore */ } finally { setIsRsvpsLoading(false); }
  }, [apiFetch, selectedEventId]);

  const fetchPendingCheckIns = useCallback(async () => {
    setIsPendingLoading(true);
    try {
      const res = await apiFetch("/api/checkin/requests?status=pending");
      if (res.ok) setPendingCheckIns(await res.json());
    } catch { /* ignore */ } finally { setIsPendingLoading(false); }
  }, [apiFetch]);

  const fetchLeaderPins = useCallback(async () => {
    setIsLeaderPinsLoading(true);
    try {
      const res = await apiFetch("/api/leaders/pins");
      if (res.ok) setLeaderPins(await res.json());
    } catch { /* ignore */ } finally { setIsLeaderPinsLoading(false); }
  }, [apiFetch]);

  // ── All useEffects ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!isKpisLoading && kpis) setKpisUpdatedAt(new Date().toLocaleTimeString());
  }, [isKpisLoading, kpis]);

  useEffect(() => {
    const id = setInterval(async () => {
      await refetchKpis();
      setKpisUpdatedAt(new Date().toLocaleTimeString());
    }, 60_000);
    return () => clearInterval(id);
  }, [refetchKpis]);

  useEffect(() => {
    if (events && events.length > 0 && !selectedEventId) {
      const sorted = [...events].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setSelectedEventId(sorted[0].id);
    }
  }, [events, selectedEventId]);

  useEffect(() => {
    if (showPinDialog) setPin("");
  }, [showPinDialog]);

  useEffect(() => { fetchHasPin(); }, [fetchHasPin]);
  useEffect(() => { fetchRsvps(); }, [fetchRsvps]);

  useEffect(() => {
    fetchPendingCheckIns();
    pendingIntervalRef.current = setInterval(fetchPendingCheckIns, 30_000);
    return () => { if (pendingIntervalRef.current) clearInterval(pendingIntervalRef.current); };
  }, [fetchPendingCheckIns]);

  const membersForCheckIn = useMemo(
    () => profiles?.filter((p: any) => p.role === "member" || p.role === "visitor") ?? [],
    [profiles],
  );

  // ── Guard: must come after ALL hooks ─────────────────────────────────────
  if (!session) return <Redirect to="/leader-login" />;

  // ── Helpers ───────────────────────────────────────────────────────────────
  function refreshDashboard() {
    queryClient.invalidateQueries({ queryKey: getGetDashboardKpisQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetTodayAttendanceQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListProfilesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListEventsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListMembershipRequestsQueryKey({ status: "pending" }) });
    queryClient.invalidateQueries({ queryKey: getListLeadersQueryKey() });
  }

  const handleGenerateSessionQrCode = async () => {
    setIsGeneratingQr(true);
    try {
      const res = await apiFetch("/api/qrcodes/session", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        const qrUrl = `${window.location.origin}/checkin?session_id=${data.slug}`;
        setQrCodeUrl(qrUrl);
        toast({ title: "Session QR generated — opening display page" });
        // Navigate to the dedicated QR display page
        window.location.href = `/session-qr?slug=${data.slug}`;
      } else {
        let errMsg = "Failed to generate QR code";
        try { const err = await res.json(); errMsg = err.error || errMsg; } catch {}
        toast({ title: "Failed to generate QR code", description: errMsg, variant: "destructive" });
      }
    } catch {
      toast({ title: "Failed to generate QR code", description: "Network error — check your connection", variant: "destructive" });
    } finally { setIsGeneratingQr(false); }
  };

  function handleCreateEvent() {
    if (!eventForm.title || !eventForm.date || !eventForm.time || !eventForm.location) {
      toast({ title: "Missing event details", description: "Title, date, time, and location are required.", variant: "destructive" });
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
          setEventForm({ title: "", description: "", date: today, time: "18:00", location: "", age_min: "", age_max: "", is_public: true });
          toast({ title: "Event created" });
          refreshDashboard();
        },
        onError: (error: Error) => toast({ title: "Event creation failed", description: error.message, variant: "destructive" }),
      },
    );
  }

  async function handleDeleteEvent() {
    if (!deleteEventId) return;
    try {
      const res = await apiFetch(`/api/events/${deleteEventId}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json();
        toast({ title: "Delete failed", description: err.error, variant: "destructive" });
        return;
      }
      toast({ title: "Event deleted" });
      setDeleteEventId(null);
      setDeleteEventName(null);
      refreshDashboard();
    } catch {
      toast({ title: "Delete failed", variant: "destructive" });
    }
  }

  async function handleConfirmRoleChange() {
    if (!roleConfirm) return;
    const { profile, targetRole } = roleConfirm;
    setRoleConfirm(null);
    queryClient.setQueryData(getListProfilesQueryKey(search ? { search } : undefined), (prev: any) => {
      if (!prev) return prev;
      return prev.map((p: any) => p.id === profile.id ? { ...p, role: targetRole } : p);
    });
    try {
      const res = await apiFetch(`/api/profiles/${profile.id}/role`, { method: "PATCH", body: JSON.stringify({ role: targetRole }) });
      if (!res.ok) {
        const err = await res.json();
        toast({ title: "Failed to update role", description: err.error, variant: "destructive" });
        refreshDashboard();
        return;
      }
      toast({ title: "Role updated", description: `${profile.full_name} is now ${targetRole.replace("_", " ")}` });
      refreshDashboard();
    } catch {
      toast({ title: "Failed to update role", variant: "destructive" });
      refreshDashboard();
    }
  }

  async function handleSavePin() {
    if (pin.length !== 4) return;
    try {
      const res = await apiFetch("/api/profiles/me/pin", { method: "PATCH", body: JSON.stringify({ pin }) });
      if (!res.ok) {
        const err = await res.json();
        toast({ title: "Failed to save PIN", description: err.error, variant: "destructive" });
        return;
      }
      toast({ title: "PIN updated" });
      setShowPinDialog(false);
      fetchHasPin();
    } catch {
      toast({ title: "Failed to save PIN", variant: "destructive" });
    }
  }

  async function handlePermissionChange(profileId: string, permissionKey: keyof LeaderSession, newValue: boolean) {
    setIsUpdatingPermissions(true);
    try {
      const res = await apiFetch(`/api/profiles/${profileId}/permissions`, { method: "PATCH", body: JSON.stringify({ [permissionKey]: newValue }) });
      if (!res.ok) {
        const err = await res.json();
        toast({ title: "Failed to update permissions", description: err.error, variant: "destructive" });
        return;
      }
      toast({ title: "Permissions updated" });
      if (session!.profile_id === profileId) {
        setLeaderSession({ ...session!, [permissionKey]: newValue });
      }
      refreshDashboard();
    } catch {
      toast({ title: "Failed to update permissions", variant: "destructive" });
    } finally { setIsUpdatingPermissions(false); }
  }

  function mutateProfileRole(action: "promote" | "revoke", profileId: string) {
    const mutation = action === "promote" ? promoteToMember : revokeMembership;
    mutation.mutate({ id: profileId }, {
      onSuccess: () => { toast({ title: action === "promote" ? "Promoted to member" : "Membership revoked" }); refreshDashboard(); },
      onError: (error: Error) => toast({ title: "Profile update failed", description: error.message, variant: "destructive" }),
    });
  }

  function mutateRequest(action: "approve" | "reject", requestId: string) {
    const mutation = action === "approve" ? approveRequest : rejectRequest;
    mutation.mutate({ id: requestId }, {
      onSuccess: () => { toast({ title: action === "approve" ? "Request approved" : "Request rejected" }); refreshDashboard(); },
      onError: (error: Error) => toast({ title: "Request update failed", description: error.message, variant: "destructive" }),
    });
  }

  async function handleApproveCheckIn(requestId: string) {
    try {
      const res = await apiFetch(`/api/checkin/requests/${requestId}/approve`, { method: "PATCH" });
      if (!res.ok) { const err = await res.json(); toast({ title: "Approval failed", description: err.error, variant: "destructive" }); return; }
      toast({ title: "Check-in approved" });
      setPendingCheckIns(prev => prev.filter(r => r.id !== requestId));
      refreshDashboard();
    } catch { toast({ title: "Approval failed", variant: "destructive" }); }
  }

  async function handleRejectCheckIn(requestId: string) {
    try {
      const res = await apiFetch(`/api/checkin/requests/${requestId}/reject`, { method: "PATCH" });
      if (!res.ok) { const err = await res.json(); toast({ title: "Rejection failed", description: err.error, variant: "destructive" }); return; }
      toast({ title: "Check-in rejected" });
      setPendingCheckIns(prev => prev.filter(r => r.id !== requestId));
    } catch { toast({ title: "Rejection failed", variant: "destructive" }); }
  }

  function togglePinReveal(id: string) {
    setRevealedPins(prev => ({ ...prev, [id]: !prev[id] }));
  }

  const superAdminCount = profiles?.filter((p: any) => p.role === "super_admin").length ?? 0;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <Layout>
      <div className="space-y-6 pb-8">
        {/* Header */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Leader Dashboard</h1>
            <p className="text-muted-foreground mt-1">Live attendance, members, events, and requests.</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {(session.role === "leader" || session.role === "super_admin") && (
              <Button onClick={handleGenerateSessionQrCode} disabled={isGeneratingQr} size="sm">
                <QrCode className="h-4 w-4 mr-2" />
                {isGeneratingQr ? "Generating..." : "Generate Session QR"}
              </Button>
            )}
            <Badge variant={session.role === "super_admin" ? "default" : "secondary"}>
              {session.role.replace("_", " ")}
            </Badge>
          </div>
        </div>

        {/* KPIs */}
        {session.can_view_kpis && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard title="Total Members" icon={<Users className="h-4 w-4 text-muted-foreground" />} value={kpis?.total_members && kpis.total_members > 0 ? kpis.total_members : undefined} loading={isKpisLoading} lastUpdated={kpisUpdatedAt} />
            <KpiCard title="Today's Attendance" icon={<CheckCircle className="h-4 w-4 text-primary" />} value={kpis?.today_attendance} loading={isKpisLoading} lastUpdated={kpisUpdatedAt} />
            <KpiCard title="New Visitors" icon={<UserPlus className="h-4 w-4 text-muted-foreground" />} value={kpis?.today_new_visitors} loading={isKpisLoading} lastUpdated={kpisUpdatedAt} />
            <KpiCard title="Upcoming Events" icon={<Calendar className="h-4 w-4 text-muted-foreground" />} value={kpis?.upcoming_events_count} loading={isKpisLoading} lastUpdated={kpisUpdatedAt} />
          </div>
        )}

        {/* Today's Check-ins banner */}
        {session.can_view_attendance && (
          <div className="rounded-xl border border-teal-500/20 bg-teal-500/5 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-teal-400">Today's Check-ins</h2>
              <span className="text-2xl font-bold text-teal-400">{isAttendanceLoading ? "—" : (attendance?.length ?? 0)}</span>
            </div>
            {isAttendanceLoading ? <Skeleton className="h-8 w-full" /> : attendance && attendance.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {attendance.slice(0, 8).map((record: any, i: number) => (
                  <span key={record.id ?? i} className="text-xs px-2 py-0.5 rounded-full bg-teal-500/10 text-teal-400 font-medium">
                    {record.profile?.full_name ?? "Unknown"}
                  </span>
                ))}
                {attendance.length > 8 && <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">+{attendance.length - 8} more</span>}
              </div>
            ) : <p className="text-xs text-muted-foreground">No check-ins yet today.</p>}
          </div>
        )}

        {/* Tabs */}
        <Tabs defaultValue="attendance" onValueChange={(val) => { if (val === "leader-pins") fetchLeaderPins(); }}>
          <TabsList className="flex flex-wrap h-auto gap-1 justify-start">
            {session.can_view_attendance && <TabsTrigger value="attendance">Today</TabsTrigger>}
            <TabsTrigger value="checkin-approvals">
              Check-ins
              {pendingCheckIns.length > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground text-xs w-4 h-4 font-semibold">{pendingCheckIns.length}</span>
              )}
            </TabsTrigger>
            {session.can_view_members && <TabsTrigger value="members">Members</TabsTrigger>}
            <TabsTrigger value="events">Events</TabsTrigger>
            <TabsTrigger value="requests">Requests</TabsTrigger>
            {(session.role === "leader" || session.role === "super_admin") && <TabsTrigger value="rsvps">RSVPs</TabsTrigger>}
            {session.role === "super_admin" && <TabsTrigger value="leaders">Leaders</TabsTrigger>}
            {session.role === "super_admin" && <TabsTrigger value="leader-pins">Leader PINs</TabsTrigger>}
            {session.role === "super_admin" && <TabsTrigger value="super-admin-slots">Super Admin Slots</TabsTrigger>}
            {(session.role === "leader" || session.role === "super_admin") && <TabsTrigger value="channel">Channel</TabsTrigger>}
          </TabsList>

          {/* Today tab */}
          <TabsContent value="attendance" className="p-4 border rounded-xl mt-4 bg-card">
            <SectionTitle title="Today's Check-ins" />
            {isAttendanceLoading ? <Skeleton className="h-24 w-full" /> : attendance && attendance.length > 0 ? (
              <SimpleTable headers={["Name", "Role", "Time", "Method"]} rows={attendance.map((r: any) => [
                r.profile?.full_name ?? "Unknown",
                r.profile?.role ?? "-",
                format(new Date(r.checked_in_at), "HH:mm"),
                r.check_in_method,
              ])} />
            ) : <EmptyLine text="No one has checked in today yet." />}
          </TabsContent>

          {/* Check-in approvals tab */}
          <TabsContent value="checkin-approvals" className="p-4 border rounded-xl mt-4 bg-card">
            <div className="flex items-center justify-between mb-4">
              <SectionTitle title="Pending Check-in Approvals" />
              <Button variant="ghost" size="sm" onClick={fetchPendingCheckIns} disabled={isPendingLoading} className="text-muted-foreground">
                <RefreshCw className={`w-4 h-4 mr-1.5 ${isPendingLoading ? "animate-spin" : ""}`} /> Refresh
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mb-4">Auto-refreshes every 30s. First-timers are labelled <span className="font-medium text-foreground">visitor</span>.</p>
            {isPendingLoading && pendingCheckIns.length === 0 ? (
              <div className="space-y-3"><Skeleton className="h-16 w-full rounded-lg" /><Skeleton className="h-16 w-full rounded-lg" /></div>
            ) : pendingCheckIns.length > 0 ? (
              <div className="space-y-2">
                {pendingCheckIns.map(req => (
                  <div key={req.id} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{req.name}</p>
                        {req.type === "visitor" && <Badge variant="outline" className="text-xs">First Timer</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">{req.phone ?? "No phone"} · {format(new Date(req.requested_at), "HH:mm")}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => handleApproveCheckIn(req.id)}>Approve</Button>
                      <Button size="sm" variant="outline" onClick={() => handleRejectCheckIn(req.id)}>Reject</Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : <EmptyLine text="No pending check-in requests right now." />}
          </TabsContent>

          {/* Members tab */}
          {session.can_view_members && (
            <TabsContent value="members" className="p-4 border rounded-xl mt-4 bg-card">
              <div className="mb-4 bg-purple-500/10 border border-purple-500/20 text-purple-300 rounded-lg p-3 text-sm flex items-center justify-between">
                <span className="font-medium">Super Admin Slots: {superAdminCount} / 4</span>
                <span className="text-xs text-purple-400 font-semibold">Max 4 allowed</span>
              </div>
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <SectionTitle title="Member Directory" />
                <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or phone" className="sm:max-w-xs" />
              </div>
              {isProfilesLoading ? (
                <div className="space-y-2"><Skeleton className="h-16 w-full rounded-lg" /><Skeleton className="h-16 w-full rounded-lg" /></div>
              ) : isProfilesError ? (
                <div onClick={() => refetchProfiles()} className="flex flex-col items-center justify-center p-6 border border-dashed rounded-lg cursor-pointer hover:bg-muted/50">
                  <p className="text-sm text-destructive font-medium mb-1">Could not load members, tap to retry</p>
                </div>
              ) : profiles && profiles.length > 0 ? (
                <div className="space-y-2">
                  {profiles.map((profile: any) => (
                    <div key={profile.id} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-medium">{profile.full_name}</p>
                        <p className="text-xs text-muted-foreground">{profile.phone || "No phone"}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <RoleBadge role={profile.role} />
                        {profile.role === "visitor" && <Button size="sm" onClick={() => mutateProfileRole("promote", profile.id)}>Make member</Button>}
                        {profile.role === "member" && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => mutateProfileRole("revoke", profile.id)}>Revoke</Button>
                            {session.role === "super_admin" && (
                              <Button size="sm" onClick={() => setRoleConfirm({ profile, targetRole: "leader" })}>Make Leader</Button>
                            )}
                          </>
                        )}
                        {profile.role === "leader" && session.role === "super_admin" && (
                          <div className="flex flex-col gap-2 w-full sm:w-auto">
                            {[
                              { key: "can_create_events", label: "Create Events" },
                              { key: "can_view_kpis", label: "View KPIs" },
                              { key: "can_view_members", label: "View Members" },
                              { key: "can_view_attendance", label: "View Attendance" },
                            ].map(({ key, label }) => (
                              <div key={key} className="flex items-center space-x-2">
                                <Switch
                                  id={`${key}-${profile.id}`}
                                  checked={profile[key]}
                                  onCheckedChange={checked => handlePermissionChange(profile.id, key as keyof LeaderSession, checked)}
                                  disabled={isUpdatingPermissions}
                                />
                                <Label htmlFor={`${key}-${profile.id}`}>{label}</Label>
                              </div>
                            ))}
                            <Button size="sm" onClick={() => setRoleConfirm({ profile, targetRole: "super_admin" })}>Make Super Admin</Button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : <EmptyLine text="No members yet." />}
            </TabsContent>
          )}

          {/* Events tab */}
          <TabsContent value="events" className="p-4 border rounded-xl mt-4 bg-card">
            {(session.can_create_events || session.role === "super_admin") && (
              <>
                <SectionTitle title="Create Event" />
                <div className="grid gap-3 md:grid-cols-2 mb-8">
                  <Input value={eventForm.title} onChange={e => setEventForm(c => ({ ...c, title: e.target.value }))} placeholder="Event title" />
                  <Input value={eventForm.location} onChange={e => setEventForm(c => ({ ...c, location: e.target.value }))} placeholder="Location" />
                  <Input type="date" value={eventForm.date} onChange={e => setEventForm(c => ({ ...c, date: e.target.value }))} />
                  <Input type="time" value={eventForm.time} onChange={e => setEventForm(c => ({ ...c, time: e.target.value }))} />
                  <Input type="number" value={eventForm.age_min} onChange={e => setEventForm(c => ({ ...c, age_min: e.target.value }))} placeholder="Min age" />
                  <Input type="number" value={eventForm.age_max} onChange={e => setEventForm(c => ({ ...c, age_max: e.target.value }))} placeholder="Max age" />
                  <Textarea value={eventForm.description} onChange={e => setEventForm(c => ({ ...c, description: e.target.value }))} placeholder="Description (optional)" className="md:col-span-2" />
                  <div className="flex items-center gap-3">
                    <Switch checked={eventForm.is_public} onCheckedChange={checked => setEventForm(c => ({ ...c, is_public: checked }))} />
                    <Label>Show on landing page</Label>
                  </div>
                  <Button onClick={handleCreateEvent} disabled={createEvent.isPending}>
                    {createEvent.isPending ? "Creating..." : "Create event"}
                  </Button>
                </div>
              </>
            )}
            <SectionTitle title="All Events" />
            {isEventsLoading ? <Skeleton className="h-32 w-full" /> : events && events.length > 0 ? (
              <SimpleTable
                headers={["Title", "Date", "Time", "Location", "Visibility", "Delete"]}
                rows={events.map((event: any) => [
                  event.title,
                  format(new Date(event.date), "MMM d, yyyy"),
                  event.time,
                  event.location,
                  event.is_public ? "Public" : "Internal",
                  (session.role === "leader" || session.role === "super_admin") ? (
                    <Button variant="ghost" size="sm" onClick={() => { setDeleteEventId(event.id); setDeleteEventName(event.title); }} className="text-destructive hover:text-destructive">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  ) : null,
                ])}
              />
            ) : <EmptyLine text="No events created yet." />}
          </TabsContent>

          {/* Requests tab */}
          <TabsContent value="requests" className="p-4 border rounded-xl mt-4 bg-card">
            <SectionTitle title="Membership Requests" />
            {isRequestsLoading ? <Skeleton className="h-24 w-full" /> : requests && requests.length > 0 ? (
              <div className="space-y-2">
                {requests.map((request: any) => (
                  <div key={request.id} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-medium">{request.profile?.full_name ?? "Unknown visitor"}</p>
                      <p className="text-sm text-muted-foreground">{request.reason}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => mutateRequest("approve", request.id)}>Approve</Button>
                      <Button size="sm" variant="outline" onClick={() => mutateRequest("reject", request.id)}>Reject</Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : <EmptyLine text="No pending membership requests." />}
          </TabsContent>

          {/* RSVPs tab */}
          {(session.role === "leader" || session.role === "super_admin") && (
            <TabsContent value="rsvps" className="p-4 border rounded-xl mt-4 bg-card">
              <div className="flex items-center justify-between mb-4">
                <SectionTitle title="Event RSVPs" />
                <Button variant="ghost" size="sm" onClick={fetchRsvps} disabled={isRsvpsLoading} className="text-muted-foreground">
                  <RefreshCw className={`w-4 h-4 mr-1.5 ${isRsvpsLoading ? "animate-spin" : ""}`} /> Refresh
                </Button>
              </div>
              <div className="mb-4">
                <Label htmlFor="event-select">Select Event</Label>
                <select id="event-select" className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={selectedEventId || ""} onChange={e => setSelectedEventId(e.target.value)}>
                  <option value="">Select an event</option>
                  {events?.map((event: any) => <option key={event.id} value={event.id}>{event.title} — {format(new Date(event.date), "MMM d, yyyy")}</option>)}
                </select>
              </div>
              {selectedEventId && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Card>
                    <CardHeader className="bg-green-500/10 rounded-t-lg pb-3">
                      <CardTitle className="text-base flex items-center justify-between">Going <Badge className="bg-green-600 text-white">{rsvps.filter((r: any) => r.status === "going").length}</Badge></CardTitle>
                    </CardHeader>
                    <CardContent className="pt-4">
                      {isRsvpsLoading ? <Skeleton className="h-20 w-full" /> : rsvps.filter((r: any) => r.status === "going").length > 0 ? (
                        <SimpleTable headers={["Name", "Date"]} rows={rsvps.filter((r: any) => r.status === "going").map((rsvp: any) => [rsvp.member_name, format(new Date(rsvp.created_at), "MMM d HH:mm")])} />
                      ) : <EmptyLine text="No responses yet." />}
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="bg-red-500/10 rounded-t-lg pb-3">
                      <CardTitle className="text-base flex items-center justify-between">Not Going <Badge className="bg-red-600 text-white">{rsvps.filter((r: any) => r.status === "not_going").length}</Badge></CardTitle>
                    </CardHeader>
                    <CardContent className="pt-4">
                      {isRsvpsLoading ? <Skeleton className="h-20 w-full" /> : rsvps.filter((r: any) => r.status === "not_going").length > 0 ? (
                        <SimpleTable headers={["Name", "Date"]} rows={rsvps.filter((r: any) => r.status === "not_going").map((rsvp: any) => [rsvp.member_name, format(new Date(rsvp.created_at), "MMM d HH:mm")])} />
                      ) : <EmptyLine text="No responses yet." />}
                    </CardContent>
                  </Card>
                </div>
              )}
            </TabsContent>
          )}

          {/* Leaders tab */}
          {session.role === "super_admin" && (
            <TabsContent value="leaders" className="p-4 border rounded-xl mt-4 bg-card">
              <SectionTitle title="Leader Management" />
              {isLeadersLoading ? <Skeleton className="h-24 w-full" /> : leaders && leaders.length > 0 ? (
                <SimpleTable
                  headers={["Name", "Role", "Create Events", "View KPIs", "View Members"]}
                  rows={leaders.map((leader: any) => [
                    leader.profile?.full_name ?? "Unknown",
                    leader.profile?.role ?? "leader",
                    leader.can_create_events ? "Yes" : "No",
                    leader.can_view_kpis ? "Yes" : "No",
                    leader.can_view_members ? "Yes" : "No",
                  ])}
                />
              ) : (
                <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  <ShieldAlert className="mb-2 h-5 w-5" />
                  No delegated leaders yet. Promote a member to Leader from the Members tab.
                </div>
              )}
            </TabsContent>
          )}

          {/* Leader PINs tab */}
          {session.role === "super_admin" && (
            <TabsContent value="leader-pins" className="p-4 border rounded-xl mt-4 bg-card">
              <div className="flex items-center justify-between mb-4">
                <SectionTitle title="Leader PINs" />
                <Button variant="ghost" size="sm" onClick={fetchLeaderPins} disabled={isLeaderPinsLoading} className="text-muted-foreground">
                  <RefreshCw className={`w-4 h-4 mr-1.5 ${isLeaderPinsLoading ? "animate-spin" : ""}`} /> Refresh
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mb-4">Visible to super admins only.</p>
              {isLeaderPinsLoading ? (
                <div className="space-y-2"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
              ) : leaderPins.length > 0 ? (
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-left">
                      <tr>
                        <th className="px-3 py-2 font-medium">Name</th>
                        <th className="px-3 py-2 font-medium">Phone</th>
                        <th className="px-3 py-2 font-medium">PIN</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leaderPins.map(leader => (
                        <tr key={leader.id} className="border-t">
                          <td className="px-3 py-2">{leader.full_name}</td>
                          <td className="px-3 py-2">{leader.phone ?? "—"}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <span className="font-mono">{revealedPins[leader.id] ? (leader.pin_plain ?? "—") : "••••"}</span>
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => togglePinReveal(leader.id)}>
                                {revealedPins[leader.id] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  <ShieldAlert className="mb-2 h-5 w-5" />
                  No leaders found or PINs not set. Click Refresh to load.
                </div>
              )}
            </TabsContent>
          )}

          {/* Super Admin Slots tab */}
          {session.role === "super_admin" && (
            <TabsContent value="super-admin-slots" className="p-4 border rounded-xl mt-4 bg-card">
              <SectionTitle title="Super Admin Slots" />
              {isProfilesLoading ? <Skeleton className="h-24 w-full" /> : (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">{superAdminCount} of 4 slots filled</p>
                  <div className="space-y-2">
                    {profiles?.filter((p: any) => p.role === "super_admin").map((admin: any) => (
                      <div key={admin.id} className="flex items-center justify-between rounded-lg border p-3">
                        <div>
                          <p className="font-medium">{admin.full_name}</p>
                          <p className="text-xs text-muted-foreground">{admin.phone || "No phone"}</p>
                        </div>
                        <Badge variant="default">Super Admin</Badge>
                      </div>
                    ))}
                  </div>
                  <div className="border-t pt-4">
                    <p className="text-sm font-medium mb-1">Your PIN</p>
                    <p className="text-xs text-muted-foreground mb-3">{hasPin ? "PIN is set — used for leader authentication." : "No PIN set yet."}</p>
                    <Button variant="outline" size="sm" onClick={() => setShowPinDialog(true)}>
                      {hasPin ? "Change PIN" : "Set PIN"}
                    </Button>
                  </div>
                </div>
              )}
            </TabsContent>
          )}

          {/* Channel tab */}
          {(session.role === "leader" || session.role === "super_admin") && (
            <TabsContent value="channel" className="p-4 border rounded-xl mt-4 bg-card">
              <SectionTitle title="Leader Channel" />
              <div className="rounded-lg border border-dashed p-8 text-center">
                <p className="text-sm text-muted-foreground">A private channel for leaders is on its way.</p>
              </div>
            </TabsContent>
          )}
        </Tabs>
      </div>

      {/* Session QR Dialog */}
      <Dialog open={showSessionQrCodeDialog} onOpenChange={setShowSessionQrCodeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Scan for Session Check-in</DialogTitle>
            <DialogDescription>Members and visitors scan this to check in tonight.</DialogDescription>
          </DialogHeader>
          <div className="flex justify-center p-4">
            {qrCodeUrl ? <QRCodeSVG value={qrCodeUrl} size={256} level="H" includeMargin /> : <p>Generating...</p>}
          </div>
          <DialogFooter><Button onClick={() => setShowSessionQrCodeDialog(false)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete event dialog */}
      <AlertDialog open={!!deleteEventId} onOpenChange={open => !open && setDeleteEventId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Event</AlertDialogTitle>
            <AlertDialogDescription>Delete "{deleteEventName}"? This removes all RSVPs and cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteEvent}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Role change dialog */}
      <AlertDialog open={!!roleConfirm} onOpenChange={open => !open && setRoleConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change Role</AlertDialogTitle>
            <AlertDialogDescription>
              Promote <strong>{roleConfirm?.profile?.full_name}</strong> to <strong>{roleConfirm?.targetRole.replace("_", " ")}</strong>?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmRoleChange}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* PIN dialog */}
      <Dialog open={showPinDialog} onOpenChange={setShowPinDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{hasPin ? "Change PIN" : "Set PIN"}</DialogTitle>
            <DialogDescription>{hasPin ? "Update your 4-digit leader PIN." : "Create a 4-digit PIN for leader authentication."}</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input type="password" placeholder="Enter 4-digit PIN" maxLength={4} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} className="text-center text-2xl tracking-widest" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPinDialog(false)}>Cancel</Button>
            <Button onClick={handleSavePin} disabled={pin.length !== 4}>{hasPin ? "Update PIN" : "Set PIN"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: string }) {
  let classes = "";
  switch (role) {
    case "super_admin": classes = "bg-purple-500/10 text-purple-400 border-purple-500/20 border"; break;
    case "leader": classes = "bg-blue-500/10 text-blue-400 border-blue-500/20 border"; break;
    case "member": classes = "bg-muted text-muted-foreground border"; break;
    default: classes = "bg-secondary text-secondary-foreground border";
  }
  return <Badge className={classes} variant="outline">{role.replace("_", " ")}</Badge>;
}

function KpiCard({ title, value, loading, icon, lastUpdated }: {
  title: string;
  value?: number;
  loading: boolean;
  icon: ReactNode;
  lastUpdated?: string | null;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        {loading ? (
          <><Skeleton className="h-7 w-16" /><Skeleton className="mt-1.5 h-3 w-28" /></>
        ) : (
          <><div className="text-2xl font-bold">{value ?? 0}</div>{lastUpdated && <p className="mt-1 text-xs text-muted-foreground">Updated {lastUpdated}</p>}</>
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

function SimpleTable({ headers, rows }: { headers: string[]; rows: (string | ReactNode)[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left">
          <tr>{headers.map(h => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t">
              {row.map((cell, j) => <td key={`${i}-${j}`} className="px-3 py-2">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
