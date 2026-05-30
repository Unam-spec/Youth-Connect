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
  Shield,
  Trash2,
  UserPlus,
  Users,
  UserCheck,
  Star,
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
      } catch {
        /* ignore */
      }
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
        /* ignore */
      }
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
  age?: number | null;
  school?: string | null;
  parent_phone?: string | null;
  how_did_you_hear?: string | null;
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
  const [deleteMemberId, setDeleteMemberId] = useState<string | null>(null);
  const [deleteMemberName, setDeleteMemberName] = useState<string | null>(null);
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
  const [settingPinFor, setSettingPinFor] = useState<LeaderPin | null>(null);
  const [leaderPinInput, setLeaderPinInput] = useState("");
  const [pendingCheckIns, setPendingCheckIns] = useState<PendingCheckIn[]>([]);
  const [isPendingLoading, setIsPendingLoading] = useState(false);
  const pendingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
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
  const {
    data: kpis,
    isLoading: isKpisLoading,
    refetch: refetchKpis,
  } = useGetDashboardKpis({
    query: { queryKey: getGetDashboardKpisQueryKey() },
  });
  const { data: events, isLoading: isEventsLoading } = useListEvents(
    undefined,
    {
      query: { queryKey: getListEventsQueryKey() },
    },
  );
  const { data: attendance, isLoading: isAttendanceLoading } =
    useGetTodayAttendance({
      query: { queryKey: getGetTodayAttendanceQueryKey() },
    });
  const {
    data: profiles,
    isLoading: isProfilesLoading,
    isError: isProfilesError,
    refetch: refetchProfiles,
  } = useListProfiles(search ? { search } : undefined, {
    query: {
      queryKey: getListProfilesQueryKey(search ? { search } : undefined),
    },
  });
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
    query: { queryKey: getListLeadersQueryKey() },
  });

  const createEvent = useCreateEvent();
  const promoteToMember = usePromoteToMember();
  const revokeMembership = useRevokeMembership();
  const approveRequest = useApproveMembershipRequest();
  const rejectRequest = useRejectMembershipRequest();

  // ── Stable callbacks ─────────────────────────────────────────────────────
  const fetchHasPin = useCallback(async () => {
    try {
      const res = await apiFetch("/api/profiles/me/pin");
      if (res.ok) {
        const data = await res.json();
        setHasPin(data.hasPIN);
      }
    } catch {
      /* ignore */
    }
  }, [apiFetch]);

  const fetchRsvps = useCallback(async () => {
    if (!selectedEventId) {
      setRsvps([]);
      return;
    }
    setIsRsvpsLoading(true);
    try {
      const res = await apiFetch(`/api/rsvps?event_id=${selectedEventId}`);
      if (res.ok) setRsvps(await res.json());
    } catch {
      /* ignore */
    } finally {
      setIsRsvpsLoading(false);
    }
  }, [apiFetch, selectedEventId]);

  const fetchPendingCheckIns = useCallback(async () => {
    setIsPendingLoading(true);
    try {
      const res = await apiFetch("/api/checkin/requests?status=pending");
      if (res.ok) setPendingCheckIns(await res.json());
    } catch {
      /* ignore */
    } finally {
      setIsPendingLoading(false);
    }
  }, [apiFetch]);

  const fetchLeaderPins = useCallback(async () => {
    setIsLeaderPinsLoading(true);
    try {
      const res = await apiFetch("/api/leaders/pins");
      if (res.ok) setLeaderPins(await res.json());
    } catch {
      /* ignore */
    } finally {
      setIsLeaderPinsLoading(false);
    }
  }, [apiFetch]);

  // ── All useEffects ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!isKpisLoading && kpis)
      setKpisUpdatedAt(new Date().toLocaleTimeString());
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
      const sorted = [...events].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
      );
      setSelectedEventId(sorted[0].id);
    }
  }, [events, selectedEventId]);

  useEffect(() => {
    if (showPinDialog) setPin("");
  }, [showPinDialog]);
  useEffect(() => {
    fetchHasPin();
  }, [fetchHasPin]);
  useEffect(() => {
    fetchRsvps();
  }, [fetchRsvps]);

  // Use a ref to hold the latest fetchPendingCheckIns so the interval never restarts
  const fetchPendingRef = useRef(fetchPendingCheckIns);
  useEffect(() => {
    fetchPendingRef.current = fetchPendingCheckIns;
  }, [fetchPendingCheckIns]);

  useEffect(() => {
    // Initial fetch
    fetchPendingRef.current();
    // Poll every 30s without restarting the interval on re-renders
    pendingIntervalRef.current = setInterval(
      () => fetchPendingRef.current(),
      30_000,
    );
    return () => {
      if (pendingIntervalRef.current) clearInterval(pendingIntervalRef.current);
    };
  }, []); // empty deps — interval starts once, uses ref for latest function

  // Auto-load leader pins on mount for super admins
  useEffect(() => {
    if (session?.role === "super_admin") fetchLeaderPins();
  }, [fetchLeaderPins]); // eslint-disable-line react-hooks/exhaustive-deps

  // Split check-in requests by type
  const pendingMemberCheckIns = useMemo(
    () => pendingCheckIns.filter((r) => r.type === "member"),
    [pendingCheckIns],
  );
  const pendingFirstTimers = useMemo(
    () => pendingCheckIns.filter((r) => r.type === "visitor"),
    [pendingCheckIns],
  );

  // ── Guard: must come after ALL hooks ─────────────────────────────────────
  if (!session) return <Redirect to="/leader-login" />;

  // Derived
  const superAdminCount =
    profiles?.filter((p: any) => p.role === "super_admin").length ?? 0;
  // Super admins always see Members tab, regardless of can_view_members flag
  const canViewMembers =
    session.can_view_members || session.role === "super_admin";
  const totalRequestBadge = (requests?.length ?? 0) + pendingFirstTimers.length;

  // ── Helpers ───────────────────────────────────────────────────────────────
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

  const handleGenerateSessionQrCode = async () => {
    setIsGeneratingQr(true);
    try {
      const res = await apiFetch("/api/qrcodes/session", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        const qrUrl = `${window.location.origin}/checkin?session_id=${data.slug}`;
        setQrCodeUrl(qrUrl);
        toast({ title: "Session QR generated — opening display page" });
        window.location.href = `/session-qr?slug=${data.slug}`;
      } else {
        let errMsg = "Failed to generate QR code";
        try {
          const err = await res.json();
          errMsg = err.error || errMsg;
        } catch {}
        toast({
          title: "Failed to generate QR code",
          description: errMsg,
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: "Failed to generate QR code",
        description: "Network error — check your connection",
        variant: "destructive",
      });
    } finally {
      setIsGeneratingQr(false);
    }
  };

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
      const res = await apiFetch(`/api/events/${deleteEventId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json();
        toast({
          title: "Delete failed",
          description: err.error,
          variant: "destructive",
        });
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

  async function handleDeleteMember() {
    if (!deleteMemberId) return;
    try {
      const res = await apiFetch(`/api/profiles/${deleteMemberId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json();
        toast({
          title: "Delete failed",
          description: err.error,
          variant: "destructive",
        });
        return;
      }
      toast({ title: "Member deleted" });
      setDeleteMemberId(null);
      setDeleteMemberName(null);
      refreshDashboard();
    } catch {
      toast({ title: "Delete failed", variant: "destructive" });
    }
  }

  async function handleConfirmRoleChange() {
    if (!roleConfirm) return;
    const { profile, targetRole } = roleConfirm;
    setRoleConfirm(null);
    queryClient.setQueryData(
      getListProfilesQueryKey(search ? { search } : undefined),
      (prev: any) => {
        if (!prev) return prev;
        return prev.map((p: any) =>
          p.id === profile.id ? { ...p, role: targetRole } : p,
        );
      },
    );
    try {
      const res = await apiFetch(`/api/profiles/${profile.id}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role: targetRole }),
      });
      if (!res.ok) {
        const err = await res.json();
        toast({
          title: "Failed to update role",
          description: err.error,
          variant: "destructive",
        });
        refreshDashboard();
        return;
      }
      toast({
        title: "Role updated",
        description: `${profile.full_name} is now ${targetRole.replace("_", " ")}`,
      });
      refreshDashboard();
    } catch {
      toast({ title: "Failed to update role", variant: "destructive" });
      refreshDashboard();
    }
  }

  async function handleSavePin() {
    if (pin.length !== 4) return;
    try {
      const res = await apiFetch("/api/profiles/me/pin", {
        method: "PATCH",
        body: JSON.stringify({ pin }),
      });
      if (!res.ok) {
        const err = await res.json();
        toast({
          title: "Failed to save PIN",
          description: err.error,
          variant: "destructive",
        });
        return;
      }
      toast({ title: "PIN updated" });
      setShowPinDialog(false);
      fetchHasPin();
    } catch {
      toast({ title: "Failed to save PIN", variant: "destructive" });
    }
  }

  async function handleSetLeaderPin() {
    if (!settingPinFor || leaderPinInput.length !== 4) return;
    try {
      const res = await apiFetch(`/api/leaders/${settingPinFor.id}/set-pin`, {
        method: "POST",
        body: JSON.stringify({ pin: leaderPinInput }),
      });
      if (!res.ok) {
        const err = await res.json();
        toast({
          title: "Failed to set PIN",
          description: err.error,
          variant: "destructive",
        });
        return;
      }
      toast({ title: `PIN set for ${settingPinFor.full_name}` });
      setSettingPinFor(null);
      setLeaderPinInput("");
      fetchLeaderPins();
    } catch {
      toast({ title: "Failed to set PIN", variant: "destructive" });
    }
  }

  async function handlePermissionChange(
    profileId: string,
    permissionKey: keyof LeaderSession,
    newValue: boolean,
  ) {
    setIsUpdatingPermissions(true);
    try {
      const res = await apiFetch(`/api/profiles/${profileId}/permissions`, {
        method: "PATCH",
        body: JSON.stringify({ [permissionKey]: newValue }),
      });
      if (!res.ok) {
        const err = await res.json();
        toast({
          title: "Failed to update permissions",
          description: err.error,
          variant: "destructive",
        });
        return;
      }
      toast({ title: "Permissions updated" });
      if (session!.profile_id === profileId) {
        setLeaderSession({ ...session!, [permissionKey]: newValue });
      }
      refreshDashboard();
    } catch {
      toast({ title: "Failed to update permissions", variant: "destructive" });
    } finally {
      setIsUpdatingPermissions(false);
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
    // Check if current time is 18:30 SAST or later
    const now = new Date();
    const sastTime = new Date(
      now.toLocaleString("en-US", { timeZone: "Africa/Johannesburg" }),
    );
    const sastHours = sastTime.getHours();
    const sastMinutes = sastTime.getMinutes();
    const sastTotalMinutes = sastHours * 60 + sastMinutes;
    const requiredTime = 18 * 60 + 30; // 18:30

    const isSuperAdmin = session?.role === "super_admin";

    if (sastTotalMinutes < requiredTime && !isSuperAdmin) {
      toast({
        title: `${action === "approve" ? "Approval" : "Rejection"} restricted`,
        description:
          "You can only approve/reject membership requests at 18:30 SAST or later",
        variant: "destructive",
      });
      return;
    }

    const mutation = action === "approve" ? approveRequest : rejectRequest;
    mutation.mutate(
      { id: requestId },
      {
        onSuccess: () => {
          toast({
            title:
              action === "approve" ? "Request approved" : "Request rejected",
          });
          // Invalidate only after a short delay to avoid flash of empty list
          setTimeout(() => refreshDashboard(), 400);
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

  async function handleApproveCheckIn(requestId: string) {
    // Check if current time is 18:30 SAST or later
    const now = new Date();
    const sastTime = new Date(
      now.toLocaleString("en-US", { timeZone: "Africa/Johannesburg" }),
    );
    const sastHours = sastTime.getHours();
    const sastMinutes = sastTime.getMinutes();
    const sastTotalMinutes = sastHours * 60 + sastMinutes;
    const requiredTime = 18 * 60 + 30; // 18:30

    const isSuperAdmin = session?.role === "super_admin";

    if (sastTotalMinutes < requiredTime && !isSuperAdmin) {
      toast({
        title: "Approval restricted",
        description: "You can only approve check-ins at 18:30 SAST or later",
        variant: "destructive",
      });
      return;
    }

    try {
      const res = await apiFetch(`/api/checkin/requests/${requestId}/approve`, {
        method: "PATCH",
      });
      if (!res.ok) {
        const err = await res.json();
        toast({
          title: "Approval failed",
          description: err.error,
          variant: "destructive",
        });
        return;
      }
      toast({ title: "Check-in approved" });
      setPendingCheckIns((prev) => prev.filter((r) => r.id !== requestId));
      refreshDashboard();
    } catch {
      toast({ title: "Approval failed", variant: "destructive" });
    }
  }

  async function handleRejectCheckIn(requestId: string) {
    // Check if current time is 18:30 SAST or later
    const now = new Date();
    const sastTime = new Date(
      now.toLocaleString("en-US", { timeZone: "Africa/Johannesburg" }),
    );
    const sastHours = sastTime.getHours();
    const sastMinutes = sastTime.getMinutes();
    const sastTotalMinutes = sastHours * 60 + sastMinutes;
    const requiredTime = 18 * 60 + 30; // 18:30

    const isSuperAdmin = session?.role === "super_admin";

    if (sastTotalMinutes < requiredTime && !isSuperAdmin) {
      toast({
        title: "Rejection restricted",
        description: "You can only reject check-ins at 18:30 SAST or later",
        variant: "destructive",
      });
      return;
    }

    try {
      const res = await apiFetch(`/api/checkin/requests/${requestId}/reject`, {
        method: "PATCH",
      });
      if (!res.ok) {
        const err = await res.json();
        toast({
          title: "Rejection failed",
          description: err.error,
          variant: "destructive",
        });
        return;
      }
      toast({ title: "Check-in rejected" });
      setPendingCheckIns((prev) => prev.filter((r) => r.id !== requestId));
    } catch {
      toast({ title: "Rejection failed", variant: "destructive" });
    }
  }

  function togglePinReveal(id: string) {
    setRevealedPins((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <Layout>
      <div className="space-y-5 pb-12">
        {/* ── Header ── */}
        <div className="relative overflow-hidden rounded-2xl border border-teal-500/20 bg-gradient-to-br from-teal-500/10 via-cyan-500/8 to-blue-600/10 p-6">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(20,184,166,0.08),_transparent_60%)] pointer-events-none" />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between relative z-10">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-teal-400" />
                </span>
                <span className="text-xs font-semibold text-teal-400 uppercase tracking-widest">
                  Live
                </span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
                Leader Dashboard
              </h1>
              <p className="text-muted-foreground mt-1 text-sm">
                Attendance, members, events &amp; requests - all in one place.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {(session.role === "leader" ||
                session.role === "super_admin") && (
                <Button
                  id="btn-generate-qr"
                  onClick={handleGenerateSessionQrCode}
                  disabled={isGeneratingQr}
                  size="sm"
                  className="bg-teal-500 hover:bg-teal-400 text-white border-0 shadow-lg shadow-teal-500/20"
                >
                  <QrCode className="h-4 w-4 mr-2" />
                  {isGeneratingQr ? "Generating…" : "Session QR"}
                </Button>
              )}
              <Badge
                className={
                  session.role === "super_admin"
                    ? "bg-purple-500/15 text-purple-300 border-purple-500/30"
                    : "bg-blue-500/15 text-blue-300 border-blue-500/30"
                }
                variant="outline"
              >
                <Shield className="h-3 w-3 mr-1" />
                {session.role.replace("_", " ")}
              </Badge>
            </div>
          </div>
        </div>

        {/* ── KPI Cards ── */}
        {session.can_view_kpis && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard
              title="Total Members"
              icon={<Users className="h-4 w-4 text-teal-400" />}
              value={
                kpis?.total_members && kpis.total_members > 0
                  ? kpis.total_members
                  : undefined
              }
              loading={isKpisLoading}
              lastUpdated={kpisUpdatedAt}
              accent="teal"
            />
            <KpiCard
              title="Today's Attendance"
              icon={<CheckCircle className="h-4 w-4 text-cyan-400" />}
              value={kpis?.today_attendance}
              loading={isKpisLoading}
              lastUpdated={kpisUpdatedAt}
              accent="cyan"
            />
            <KpiCard
              title="New Visitors"
              icon={<UserPlus className="h-4 w-4 text-blue-400" />}
              value={kpis?.today_new_visitors}
              loading={isKpisLoading}
              lastUpdated={kpisUpdatedAt}
              accent="blue"
            />
            <KpiCard
              title="Upcoming Events"
              icon={<Calendar className="h-4 w-4 text-indigo-400" />}
              value={kpis?.upcoming_events_count}
              loading={isKpisLoading}
              lastUpdated={kpisUpdatedAt}
              accent="indigo"
            />
          </div>
        )}

        {/* ── Today's Check-ins banner ── */}
        {session.can_view_attendance && (
          <div className="rounded-xl border border-teal-500/20 bg-gradient-to-r from-teal-500/8 to-transparent p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-teal-400" />
                <span className="text-sm font-semibold text-teal-300">
                  Today's Check-ins
                </span>
              </div>
              <span className="text-3xl font-bold text-teal-300 tabular-nums">
                {isAttendanceLoading ? "—" : (attendance?.length ?? 0)}
              </span>
            </div>
            {isAttendanceLoading ? (
              <Skeleton className="h-7 w-full" />
            ) : attendance && attendance.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {attendance.slice(0, 10).map((record: any, i: number) => (
                  <span
                    key={record.id ?? i}
                    className="text-xs px-2.5 py-0.5 rounded-full bg-teal-500/12 text-teal-300 font-medium border border-teal-500/20"
                  >
                    {record.profile?.full_name ?? "Unknown"}
                  </span>
                ))}
                {attendance.length > 10 && (
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-muted text-muted-foreground border border-border/60">
                    +{attendance.length - 10} more
                  </span>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                No check-ins yet today.
              </p>
            )}
          </div>
        )}

        {/* ── Tabs ── */}
        <Tabs
          defaultValue="attendance"
          onValueChange={(val) => {
            if (val === "leader-pins") fetchLeaderPins();
          }}
        >
          <TabsList className="flex flex-wrap h-auto gap-1 justify-start bg-card/60 border border-border/60 p-1.5 rounded-xl backdrop-blur-sm">
            {session.can_view_attendance && (
              <TabsTrigger
                id="tab-today"
                value="attendance"
                className="rounded-lg text-xs data-[state=active]:bg-teal-500 data-[state=active]:text-white data-[state=active]:shadow-none"
              >
                Today
              </TabsTrigger>
            )}
            <TabsTrigger
              id="tab-checkins"
              value="checkin-approvals"
              className="rounded-lg text-xs data-[state=active]:bg-teal-500 data-[state=active]:text-white data-[state=active]:shadow-none"
            >
              Check-ins
              {pendingMemberCheckIns.length > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-cyan-500 text-white text-xs w-4 h-4 font-bold">
                  {pendingMemberCheckIns.length}
                </span>
              )}
            </TabsTrigger>
            {canViewMembers && (
              <TabsTrigger
                id="tab-members"
                value="members"
                className="rounded-lg text-xs data-[state=active]:bg-teal-500 data-[state=active]:text-white data-[state=active]:shadow-none"
              >
                Members
              </TabsTrigger>
            )}
            <TabsTrigger
              id="tab-events"
              value="events"
              className="rounded-lg text-xs data-[state=active]:bg-teal-500 data-[state=active]:text-white data-[state=active]:shadow-none"
            >
              Events
            </TabsTrigger>
            <TabsTrigger
              id="tab-requests"
              value="requests"
              className="rounded-lg text-xs data-[state=active]:bg-teal-500 data-[state=active]:text-white data-[state=active]:shadow-none"
            >
              Requests
              {totalRequestBadge > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-amber-500 text-white text-xs w-4 h-4 font-bold">
                  {totalRequestBadge}
                </span>
              )}
            </TabsTrigger>
            {(session.role === "leader" || session.role === "super_admin") && (
              <TabsTrigger
                id="tab-rsvps"
                value="rsvps"
                className="rounded-lg text-xs data-[state=active]:bg-teal-500 data-[state=active]:text-white data-[state=active]:shadow-none"
              >
                RSVPs
              </TabsTrigger>
            )}
            {session.role === "super_admin" && (
              <TabsTrigger
                id="tab-leaders"
                value="leaders"
                className="rounded-lg text-xs data-[state=active]:bg-teal-500 data-[state=active]:text-white data-[state=active]:shadow-none"
              >
                Leaders
              </TabsTrigger>
            )}
            {session.role === "super_admin" && (
              <TabsTrigger
                id="tab-leader-pins"
                value="leader-pins"
                className="rounded-lg text-xs data-[state=active]:bg-teal-500 data-[state=active]:text-white data-[state=active]:shadow-none"
              >
                Leader PINs
              </TabsTrigger>
            )}
            {session.role === "super_admin" && (
              <TabsTrigger
                id="tab-super-admin"
                value="super-admin-slots"
                className="rounded-lg text-xs data-[state=active]:bg-teal-500 data-[state=active]:text-white data-[state=active]:shadow-none"
              >
                Admin Slots
              </TabsTrigger>
            )}
            {(session.role === "leader" || session.role === "super_admin") && (
              <TabsTrigger
                id="tab-channel"
                value="channel"
                className="rounded-lg text-xs data-[state=active]:bg-teal-500 data-[state=active]:text-white data-[state=active]:shadow-none"
              >
                Channel
              </TabsTrigger>
            )}
          </TabsList>

          {/* ── Today tab ── */}
          <TabsContent value="attendance" className="mt-4">
            <DashCard>
              <SectionTitle
                title="Today's Check-ins"
                icon={<CheckCircle className="h-4 w-4 text-teal-400" />}
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
          </TabsContent>

          {/* ── Check-ins tab — existing MEMBERS only ── */}
          <TabsContent value="checkin-approvals" className="mt-4">
            <DashCard>
              <div className="flex items-center justify-between mb-1">
                <SectionTitle
                  title="Member Check-in Approvals"
                  icon={<UserCheck className="h-4 w-4 text-teal-400" />}
                />
                <Button
                  id="btn-refresh-checkins"
                  variant="ghost"
                  size="sm"
                  onClick={fetchPendingCheckIns}
                  disabled={isPendingLoading}
                  className="text-muted-foreground hover:text-teal-400 -mt-4"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 mr-1 ${isPendingLoading ? "animate-spin" : ""}`}
                  />{" "}
                  Refresh
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mb-4">
                Only shows existing members who scanned the QR and requested
                check-in. Auto-refreshes every 30s.
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
          </TabsContent>

          {/* ── Members tab ── */}
          {canViewMembers && (
            <TabsContent value="members" className="mt-4">
              <DashCard>
                {session.role === "super_admin" && (
                  <div className="mb-5 flex items-center justify-between rounded-xl bg-purple-500/10 border border-purple-500/20 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Star className="h-4 w-4 text-purple-400" />
                      <span className="text-sm font-semibold text-purple-300">
                        Super Admin Slots: {superAdminCount} / 4
                      </span>
                    </div>
                    <span className="text-xs text-purple-400 font-medium">
                      Max 4 allowed
                    </span>
                  </div>
                )}
                <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <SectionTitle
                    title="Member Directory"
                    icon={<Users className="h-4 w-4 text-teal-400" />}
                  />
                  <Input
                    id="member-search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search name or phone…"
                    className="sm:max-w-xs border-teal-500/20 focus-visible:ring-teal-500/40"
                  />
                </div>
                {isProfilesLoading ? (
                  <SkeletonRows count={4} />
                ) : isProfilesError ? (
                  <div
                    onClick={() => refetchProfiles()}
                    className="flex flex-col items-center justify-center p-8 border border-dashed border-destructive/30 rounded-xl cursor-pointer hover:bg-muted/20 transition-colors"
                  >
                    <p className="text-sm text-destructive font-medium">
                      Could not load members — tap to retry
                    </p>
                  </div>
                ) : profiles && profiles.length > 0 ? (
                  <div className="space-y-2.5">
                    {profiles.map((profile: any) => (
                      <div
                        key={profile.id}
                        className="flex flex-col gap-3 rounded-xl border border-border/50 bg-card/30 p-4 sm:flex-row sm:items-start sm:justify-between hover:border-teal-500/30 hover:bg-teal-500/3 transition-all"
                      >
                        <div className="flex items-start gap-3">
                          <div
                            className={`h-10 w-10 rounded-full overflow-hidden flex items-center justify-center shrink-0 text-sm font-bold ${
                              profile.role === "super_admin"
                                ? "bg-purple-500/20 text-purple-300"
                                : profile.role === "leader"
                                  ? "bg-blue-500/20 text-blue-300"
                                  : profile.role === "member"
                                    ? "bg-teal-500/20 text-teal-300"
                                    : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {profile.avatar_url ? (
                              profile.avatar_url.startsWith("gradient:") ? (
                                <div
                                  className="h-full w-full"
                                  style={{ background: profile.avatar_url.replace("gradient:", "") }}
                                />
                              ) : (
                                <img
                                  src={profile.avatar_url}
                                  alt={profile.full_name}
                                  className="h-full w-full object-cover"
                                />
                              )
                            ) : (
                              profile.full_name?.charAt(0)?.toUpperCase() ?? "?"
                            )}
                          </div>
                          <div>
                            <p className="font-semibold text-sm leading-tight">
                              {profile.full_name}
                            </p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {profile.phone || "No phone"}
                            </p>
                            <div className="mt-2">
                              <RoleBadge role={profile.role} />
                            </div>
                          </div>
                        </div>
                        <div className="flex items-start gap-2 flex-wrap sm:flex-col sm:items-end sm:shrink-0">
                          {profile.role === "visitor" && (
                            <Button
                              id={`btn-promote-${profile.id}`}
                              size="sm"
                              onClick={() =>
                                mutateProfileRole("promote", profile.id)
                              }
                              className="bg-teal-500 hover:bg-teal-400 text-white border-0 h-7 text-xs px-3"
                            >
                              Make Member
                            </Button>
                          )}
                          {profile.role === "member" && (
                            <div className="flex items-center gap-2 flex-wrap sm:flex-col sm:items-end">
                              <Button
                                id={`btn-revoke-${profile.id}`}
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  mutateProfileRole("revoke", profile.id)
                                }
                                className="h-7 text-xs px-3"
                              >
                                Revoke
                              </Button>
                              {session.role === "super_admin" && (
                                <Button
                                  id={`btn-make-leader-${profile.id}`}
                                  size="sm"
                                  onClick={() =>
                                    setRoleConfirm({
                                      profile,
                                      targetRole: "leader",
                                    })
                                  }
                                  className="bg-blue-500 hover:bg-blue-400 text-white border-0 h-7 text-xs px-3"
                                >
                                  Make Leader
                                </Button>
                              )}
                              {session.role === "super_admin" && (
                                <Button
                                  id={`btn-delete-member-${profile.id}`}
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    setDeleteMemberId(profile.id);
                                    setDeleteMemberName(profile.full_name);
                                  }}
                                  className="text-destructive hover:text-destructive h-7 w-7 p-0"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              )}
                            </div>
                          )}
                          {profile.role === "leader" &&
                            session.role === "super_admin" && (
                              <Button
                                id={`btn-delete-leader-${profile.id}`}
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setDeleteMemberId(profile.id);
                                  setDeleteMemberName(profile.full_name);
                                }}
                                className="text-destructive hover:text-destructive h-7 w-7 p-0"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            )}
                          {profile.role === "leader" &&
                            session.role === "super_admin" && (
                              <div className="flex flex-col gap-2 w-full sm:w-56">
                                <div className="rounded-lg border border-blue-500/20 bg-blue-500/8 p-3 space-y-2">
                                  <p className="text-xs font-semibold text-blue-300 mb-1.5">
                                    Permissions
                                  </p>
                                  {[
                                    {
                                      key: "can_create_events",
                                      label: "Create Events",
                                    },
                                    {
                                      key: "can_view_kpis",
                                      label: "View KPIs",
                                    },
                                    {
                                      key: "can_view_members",
                                      label: "View Members",
                                    },
                                    {
                                      key: "can_view_attendance",
                                      label: "View Attendance",
                                    },
                                  ].map(({ key, label }) => (
                                    <div
                                      key={key}
                                      className="flex items-center justify-between gap-3"
                                    >
                                      <Label
                                        htmlFor={`${key}-${profile.id}`}
                                        className="text-xs text-muted-foreground cursor-pointer select-none"
                                      >
                                        {label}
                                      </Label>
                                      <Switch
                                        id={`${key}-${profile.id}`}
                                        checked={!!profile[key]}
                                        onCheckedChange={(checked) =>
                                          handlePermissionChange(
                                            profile.id,
                                            key as keyof LeaderSession,
                                            checked,
                                          )
                                        }
                                        disabled={isUpdatingPermissions}
                                        className="data-[state=checked]:bg-teal-500 scale-90"
                                      />
                                    </div>
                                  ))}
                                </div>
                                <Button
                                  id={`btn-make-super-admin-${profile.id}`}
                                  size="sm"
                                  onClick={() =>
                                    setRoleConfirm({
                                      profile,
                                      targetRole: "super_admin",
                                    })
                                  }
                                  className="bg-purple-500 hover:bg-purple-400 text-white border-0 h-7 text-xs w-full"
                                >
                                  Make Super Admin
                                </Button>
                              </div>
                            )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState text="No members found." />
                )}
              </DashCard>
            </TabsContent>
          )}

          {/* ── Events tab ── */}
          <TabsContent value="events" className="mt-4">
            <DashCard>
              {(session.can_create_events ||
                session.role === "super_admin") && (
                <>
                  <SectionTitle
                    title="Create Event"
                    icon={<Calendar className="h-4 w-4 text-teal-400" />}
                  />
                  <div className="grid gap-3 md:grid-cols-2 mb-8">
                    <Input
                      value={eventForm.title}
                      onChange={(e) =>
                        setEventForm((c) => ({ ...c, title: e.target.value }))
                      }
                      placeholder="Event title"
                    />
                    <Input
                      value={eventForm.location}
                      onChange={(e) =>
                        setEventForm((c) => ({
                          ...c,
                          location: e.target.value,
                        }))
                      }
                      placeholder="Location"
                    />
                    <Input
                      type="date"
                      value={eventForm.date}
                      onChange={(e) =>
                        setEventForm((c) => ({ ...c, date: e.target.value }))
                      }
                    />
                    <Input
                      type="time"
                      value={eventForm.time}
                      onChange={(e) =>
                        setEventForm((c) => ({ ...c, time: e.target.value }))
                      }
                    />
                    <Input
                      type="number"
                      value={eventForm.age_min}
                      onChange={(e) =>
                        setEventForm((c) => ({ ...c, age_min: e.target.value }))
                      }
                      placeholder="Min age (optional)"
                    />
                    <Input
                      type="number"
                      value={eventForm.age_max}
                      onChange={(e) =>
                        setEventForm((c) => ({ ...c, age_max: e.target.value }))
                      }
                      placeholder="Max age (optional)"
                    />
                    <Textarea
                      value={eventForm.description}
                      onChange={(e) =>
                        setEventForm((c) => ({
                          ...c,
                          description: e.target.value,
                        }))
                      }
                      placeholder="Description (optional)"
                      className="md:col-span-2 resize-none"
                    />
                    <div className="flex items-center gap-3">
                      <Switch
                        id="is-public"
                        checked={eventForm.is_public}
                        onCheckedChange={(checked) =>
                          setEventForm((c) => ({ ...c, is_public: checked }))
                        }
                        className="data-[state=checked]:bg-teal-500"
                      />
                      <Label htmlFor="is-public" className="cursor-pointer">
                        Show on landing page
                      </Label>
                    </div>
                    <Button
                      id="btn-create-event"
                      onClick={handleCreateEvent}
                      disabled={createEvent.isPending}
                      className="bg-teal-500 hover:bg-teal-400 text-white border-0"
                    >
                      {createEvent.isPending ? "Creating…" : "Create Event"}
                    </Button>
                  </div>
                  <div className="border-t border-border/40 mb-5" />
                </>
              )}
              <SectionTitle
                title="All Events"
                icon={<Calendar className="h-4 w-4 text-blue-400" />}
              />
              {isEventsLoading ? (
                <Skeleton className="h-32 w-full rounded-xl" />
              ) : events && events.length > 0 ? (
                <SimpleTable
                  headers={[
                    "Title",
                    "Date",
                    "Time",
                    "Location",
                    "Visibility",
                    "",
                  ]}
                  rows={events.map((event: any) => [
                    event.title,
                    format(new Date(event.date), "MMM d, yyyy"),
                    event.time,
                    event.location,
                    event.is_public ? (
                      <span className="text-xs text-teal-400 font-medium">
                        Public
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        Internal
                      </span>
                    ),
                    session.role === "leader" ||
                    session.role === "super_admin" ? (
                      <Button
                        id={`btn-delete-event-${event.id}`}
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setDeleteEventId(event.id);
                          setDeleteEventName(event.title);
                        }}
                        className="text-destructive hover:text-destructive h-7 w-7 p-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    ) : null,
                  ])}
                />
              ) : (
                <EmptyState text="No events created yet." />
              )}
            </DashCard>
          </TabsContent>

          {/* ── Requests tab — FIRST-TIMERS + Membership requests ── */}
          <TabsContent value="requests" className="mt-4">
            <DashCard>
              {/* First-timer registrations section */}
              {isPendingLoading &&
              pendingFirstTimers.length ===
                0 ? null : pendingFirstTimers.length > 0 ? (
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-1">
                    <SectionTitle
                      title="First-Timer Registrations"
                      icon={<UserPlus className="h-4 w-4 text-amber-400" />}
                    />
                    <Badge
                      className="bg-amber-500/15 text-amber-300 border-amber-500/30 -mt-4"
                      variant="outline"
                    >
                      {pendingFirstTimers.length} waiting
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mb-4">
                    These first-time visitors have registered and are waiting
                    for a leader to approve their attendance.
                  </p>
                  <div className="space-y-2">
                    {pendingFirstTimers.map((req) => (
                      <CheckInCard
                        key={req.id}
                        req={req}
                        onApprove={() => handleApproveCheckIn(req.id)}
                        onReject={() => handleRejectCheckIn(req.id)}
                        isFirstTimer
                      />
                    ))}
                  </div>
                  <div className="border-t border-border/40 my-6" />
                </div>
              ) : null}

              {/* Membership requests section */}
              <SectionTitle
                title="Membership Requests"
                icon={<UserCheck className="h-4 w-4 text-teal-400" />}
              />
              <p className="text-xs text-muted-foreground mb-4">
                Visitors applying to become full members of the church.
              </p>
              {isRequestsLoading ? (
                <SkeletonRows />
              ) : requests && requests.length > 0 ? (
                <div className="space-y-2">
                  {requests.map((request: any) => (
                    <div
                      key={request.id}
                      className="flex flex-col gap-3 rounded-xl border border-border/50 bg-card/30 p-4 sm:flex-row sm:items-center sm:justify-between hover:border-teal-500/25 transition-colors"
                    >
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-sm">
                            {request.profile?.full_name ?? "Unknown visitor"}
                          </p>
                          <Badge
                            variant="outline"
                            className="text-xs text-amber-300 border-amber-500/30"
                          >
                            Membership
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {request.reason}
                        </p>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <Button
                          id={`btn-approve-req-${request.id}`}
                          size="sm"
                          onClick={() => mutateRequest("approve", request.id)}
                          className="bg-teal-500 hover:bg-teal-400 text-white border-0 h-7 text-xs"
                        >
                          Approve
                        </Button>
                        <Button
                          id={`btn-reject-req-${request.id}`}
                          size="sm"
                          variant="outline"
                          onClick={() => mutateRequest("reject", request.id)}
                          className="h-7 text-xs"
                        >
                          Reject
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : pendingFirstTimers.length === 0 ? (
                <EmptyState text="No pending requests right now." />
              ) : (
                <p className="text-xs text-muted-foreground py-4 text-center">
                  No membership requests.
                </p>
              )}
            </DashCard>
          </TabsContent>

          {/* ── RSVPs tab ── */}
          {(session.role === "leader" || session.role === "super_admin") && (
            <TabsContent value="rsvps" className="mt-4">
              <DashCard>
                <div className="flex items-center justify-between mb-1">
                  <SectionTitle
                    title="Event RSVPs"
                    icon={<Calendar className="h-4 w-4 text-blue-400" />}
                  />
                  <Button
                    id="btn-refresh-rsvps"
                    variant="ghost"
                    size="sm"
                    onClick={fetchRsvps}
                    disabled={isRsvpsLoading}
                    className="text-muted-foreground hover:text-teal-400 -mt-4"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 mr-1 ${isRsvpsLoading ? "animate-spin" : ""}`}
                    />{" "}
                    Refresh
                  </Button>
                </div>
                <div className="mb-5">
                  <Label
                    htmlFor="event-select"
                    className="text-xs text-muted-foreground mb-1.5 block"
                  >
                    Select Event
                  </Label>
                  <select
                    id="event-select"
                    className="block w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-teal-500/50"
                    value={selectedEventId || ""}
                    onChange={(e) => setSelectedEventId(e.target.value)}
                  >
                    <option value="">Select an event…</option>
                    {events?.map((event: any) => (
                      <option key={event.id} value={event.id}>
                        {event.title} —{" "}
                        {format(new Date(event.date), "MMM d, yyyy")}
                      </option>
                    ))}
                  </select>
                </div>
                {selectedEventId && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Card className="border-green-500/20 bg-green-500/5">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm flex items-center justify-between text-green-300">
                          Going{" "}
                          <Badge className="bg-green-600/80 text-white border-0">
                            {
                              rsvps.filter((r: any) => r.status === "going")
                                .length
                            }
                          </Badge>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="pt-0">
                        {isRsvpsLoading ? (
                          <Skeleton className="h-20 w-full" />
                        ) : rsvps.filter((r: any) => r.status === "going")
                            .length > 0 ? (
                          <SimpleTable
                            headers={["Name", "Date"]}
                            rows={rsvps
                              .filter((r: any) => r.status === "going")
                              .map((rsvp: any) => [
                                rsvp.member_name,
                                format(
                                  new Date(rsvp.created_at),
                                  "MMM d HH:mm",
                                ),
                              ])}
                          />
                        ) : (
                          <EmptyState text="No responses yet." />
                        )}
                      </CardContent>
                    </Card>
                    <Card className="border-red-500/20 bg-red-500/5">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm flex items-center justify-between text-red-300">
                          Not Going{" "}
                          <Badge className="bg-red-600/80 text-white border-0">
                            {
                              rsvps.filter((r: any) => r.status === "not_going")
                                .length
                            }
                          </Badge>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="pt-0">
                        {isRsvpsLoading ? (
                          <Skeleton className="h-20 w-full" />
                        ) : rsvps.filter((r: any) => r.status === "not_going")
                            .length > 0 ? (
                          <SimpleTable
                            headers={["Name", "Date"]}
                            rows={rsvps
                              .filter((r: any) => r.status === "not_going")
                              .map((rsvp: any) => [
                                rsvp.member_name,
                                format(
                                  new Date(rsvp.created_at),
                                  "MMM d HH:mm",
                                ),
                              ])}
                          />
                        ) : (
                          <EmptyState text="No responses yet." />
                        )}
                      </CardContent>
                    </Card>
                  </div>
                )}
              </DashCard>
            </TabsContent>
          )}

          {/* ── Leaders tab ── */}
          {session.role === "super_admin" && (
            <TabsContent value="leaders" className="mt-4">
              <DashCard>
                <SectionTitle
                  title="Leader Directory"
                  icon={<Shield className="h-4 w-4 text-blue-400" />}
                />
                {isLeadersLoading ? (
                  <SkeletonRows />
                ) : leaders && leaders.length > 0 ? (
                  <div className="space-y-2.5">
                    {leaders.map((leader: any, i: number) => (
                      <div
                        key={leader.profile?.id ?? i}
                        className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4"
                      >
                        <div className="flex items-center gap-3 mb-3">
                          <div className="h-9 w-9 rounded-full bg-blue-500/20 flex items-center justify-center text-sm font-bold text-blue-300 shrink-0">
                            {leader.profile?.full_name
                              ?.charAt(0)
                              ?.toUpperCase() ?? "L"}
                          </div>
                          <div>
                            <p className="font-semibold text-sm">
                              {leader.profile?.full_name ?? "Unknown"}
                            </p>
                            <p className="text-xs text-muted-foreground capitalize">
                              {leader.profile?.role ?? "leader"}
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {[
                            {
                              key: "can_create_events",
                              label: "Create Events",
                            },
                            { key: "can_view_kpis", label: "View KPIs" },
                            { key: "can_view_members", label: "View Members" },
                            { key: "can_view_attendance", label: "Attendance" },
                          ].map(({ key, label }) => (
                            <span
                              key={key}
                              className={`text-xs px-2.5 py-0.5 rounded-full border font-medium ${
                                leader[key]
                                  ? "bg-teal-500/12 text-teal-300 border-teal-500/25"
                                  : "bg-muted/50 text-muted-foreground border-border/40"
                              }`}
                            >
                              {leader[key] ? "✓" : "✗"} {label}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-blue-500/25 p-10 text-center">
                    <ShieldAlert className="mb-3 h-8 w-8 text-blue-400/40 mx-auto" />
                    <p className="text-sm text-muted-foreground">
                      No delegated leaders yet.
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Promote a member to Leader from the Members tab.
                    </p>
                  </div>
                )}
              </DashCard>
            </TabsContent>
          )}

          {/* ── Leader PINs tab ── */}
          {session.role === "super_admin" && (
            <TabsContent value="leader-pins" className="mt-4">
              <DashCard>
                <div className="flex items-center justify-between mb-1">
                  <SectionTitle
                    title="Leader PINs"
                    icon={<Shield className="h-4 w-4 text-teal-400" />}
                  />
                  <Button
                    id="btn-refresh-pins"
                    variant="ghost"
                    size="sm"
                    onClick={fetchLeaderPins}
                    disabled={isLeaderPinsLoading}
                    className="text-muted-foreground hover:text-teal-400 -mt-4"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 mr-1 ${isLeaderPinsLoading ? "animate-spin" : ""}`}
                    />{" "}
                    Refresh
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mb-5">
                  Visible to super admins only. PINs are used for leader login
                  authentication.
                </p>
                {isLeaderPinsLoading ? (
                  <SkeletonRows />
                ) : leaderPins.length > 0 ? (
                  <div className="space-y-2">
                    {leaderPins.map((leader) => (
                      <div
                        key={leader.id}
                        className="flex items-center justify-between rounded-xl border border-border/50 bg-card/30 p-4 hover:border-teal-500/30 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 rounded-full bg-teal-500/15 flex items-center justify-center text-sm font-bold text-teal-300 shrink-0">
                            {leader.full_name?.charAt(0)?.toUpperCase() ?? "?"}
                          </div>
                          <div>
                            <p className="font-semibold text-sm">
                              {leader.full_name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {leader.phone ?? "No phone"}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm tracking-widest tabular-nums min-w-[3rem] text-right">
                            {revealedPins[leader.id]
                              ? (leader.pin_plain ?? "—")
                              : leader.pin_plain
                                ? "••••"
                                : "not set"}
                          </span>
                          <Button
                            id={`btn-reveal-pin-${leader.id}`}
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 hover:text-teal-400"
                            onClick={() => togglePinReveal(leader.id)}
                            disabled={!leader.pin_plain}
                          >
                            {revealedPins[leader.id] ? (
                              <EyeOff className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            id={`btn-set-leader-pin-${leader.id}`}
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs px-2.5 border-teal-500/30 hover:border-teal-500 hover:text-teal-300"
                            onClick={() => {
                              setSettingPinFor(leader);
                              setLeaderPinInput("");
                            }}
                          >
                            {leader.pin_plain ? "Change" : "Set PIN"}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-teal-500/20 p-10 text-center">
                    <ShieldAlert className="mb-3 h-8 w-8 text-teal-400/40 mx-auto" />
                    <p className="text-sm text-muted-foreground">
                      No leaders with PINs found.
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Leaders can set their PIN from the Admin Slots tab.
                    </p>
                  </div>
                )}
              </DashCard>
            </TabsContent>
          )}

          {/* ── Super Admin Slots tab ── */}
          {session.role === "super_admin" && (
            <TabsContent value="super-admin-slots" className="mt-4">
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
                    <div className="border-t border-border/40 pt-4">
                      <p className="text-sm font-semibold mb-1">Your PIN</p>
                      <p className="text-xs text-muted-foreground mb-3">
                        {hasPin
                          ? "PIN is set — used for leader authentication."
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
                  </div>
                )}
              </DashCard>
            </TabsContent>
          )}

          {/* ── Channel tab ── */}
          {(session.role === "leader" || session.role === "super_admin") && (
            <TabsContent value="channel" className="mt-4">
              <DashCard>
                <SectionTitle
                  title="Leader Channel"
                  icon={<Users className="h-4 w-4 text-blue-400" />}
                />
                <div className="rounded-xl border border-dashed border-blue-500/20 p-12 text-center">
                  <div className="h-14 w-14 rounded-full bg-blue-500/10 flex items-center justify-center mx-auto mb-4">
                    <Users className="h-7 w-7 text-blue-400/50" />
                  </div>
                  <p className="text-sm font-semibold text-foreground/80 mb-1">
                    Coming Soon
                  </p>
                  <p className="text-xs text-muted-foreground">
                    A private channel for leaders is on its way.
                  </p>
                </div>
              </DashCard>
            </TabsContent>
          )}
        </Tabs>
      </div>

      {/* ── Dialogs ── */}
      <Dialog
        open={showSessionQrCodeDialog}
        onOpenChange={setShowSessionQrCodeDialog}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Scan for Session Check-in</DialogTitle>
            <DialogDescription>
              Members and visitors scan this to check in tonight.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-center p-4">
            {qrCodeUrl ? (
              <QRCodeSVG value={qrCodeUrl} size={256} level="H" includeMargin />
            ) : (
              <p>Generating…</p>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setShowSessionQrCodeDialog(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deleteEventId}
        onOpenChange={(open) => !open && setDeleteEventId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Event</AlertDialogTitle>
            <AlertDialogDescription>
              Delete "{deleteEventName}"? This removes all RSVPs and cannot be
              undone.
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

      <AlertDialog
        open={!!roleConfirm}
        onOpenChange={(open) => !open && setRoleConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change Role</AlertDialogTitle>
            <AlertDialogDescription>
              Promote <strong>{roleConfirm?.profile?.full_name}</strong> to{" "}
              <strong>{roleConfirm?.targetRole.replace("_", " ")}</strong>?
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

      <AlertDialog
        open={!!deleteMemberId}
        onOpenChange={(open) => !open && setDeleteMemberId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Member</AlertDialogTitle>
            <AlertDialogDescription>
              Delete "{deleteMemberName}"? This will permanently remove this
              member from the system and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteMember}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Set PIN for a specific leader (super admin only) ── */}
      <Dialog
        open={!!settingPinFor}
        onOpenChange={(open) => {
          if (!open) {
            setSettingPinFor(null);
            setLeaderPinInput("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set PIN for {settingPinFor?.full_name}</DialogTitle>
            <DialogDescription>
              Enter a 4-digit PIN. This will be used when this leader logs in.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              id="leader-pin-input"
              type="password"
              placeholder="Enter 4-digit PIN"
              maxLength={4}
              value={leaderPinInput}
              onChange={(e) =>
                setLeaderPinInput(e.target.value.replace(/\D/g, "").slice(0, 4))
              }
              className="text-center text-2xl tracking-widest"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setSettingPinFor(null);
                setLeaderPinInput("");
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSetLeaderPin}
              disabled={leaderPinInput.length !== 4}
              className="bg-teal-500 hover:bg-teal-400 text-white border-0"
            >
              Set PIN
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showPinDialog} onOpenChange={setShowPinDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{hasPin ? "Change PIN" : "Set PIN"}</DialogTitle>
            <DialogDescription>
              {hasPin
                ? "Update your 4-digit leader PIN."
                : "Create a 4-digit PIN for leader authentication."}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              id="pin-input"
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
            <Button
              id="btn-save-pin"
              onClick={handleSavePin}
              disabled={pin.length !== 4}
              className="bg-teal-500 hover:bg-teal-400 text-white border-0"
            >
              {hasPin ? "Update PIN" : "Set PIN"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function DashCard({ children }: { children: ReactNode }) {
  return (
    <div className="p-5 border border-border/50 rounded-2xl bg-card/40 backdrop-blur-sm">
      {children}
    </div>
  );
}

function SectionTitle({ title, icon }: { title: string; icon?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      {icon}
      <h3 className="text-sm font-semibold">{title}</h3>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="py-10 text-center">
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

function SkeletonRows({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full rounded-xl" />
      ))}
    </div>
  );
}

function CheckInCard({
  req,
  onApprove,
  onReject,
  isFirstTimer = false,
}: {
  req: PendingCheckIn;
  onApprove: () => void;
  onReject: () => void;
  isFirstTimer?: boolean;
}) {
  return (
    <div
      className={`flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between transition-colors ${
        isFirstTimer
          ? "border-amber-500/40 bg-amber-500/10 dark:border-amber-500/30 dark:bg-amber-500/5 hover:border-amber-500/60"
          : "border-teal-500/40 bg-teal-500/10 dark:border-teal-500/30 dark:bg-teal-500/5 hover:border-teal-500/60"
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`h-9 w-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
            isFirstTimer
              ? "bg-amber-500/20 text-amber-700 dark:text-amber-300"
              : "bg-teal-500/20 text-teal-700 dark:text-teal-300"
          }`}
        >
          {req.name?.charAt(0)?.toUpperCase() ?? "?"}
        </div>
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-sm">{req.name}</p>
            {isFirstTimer && (
              <Badge
                variant="outline"
                className="text-xs text-amber-700 dark:text-amber-300 border-amber-500/40 bg-amber-500/15 dark:bg-amber-500/10 py-0"
              >
                First Timer
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {req.phone ?? "No phone"} ·{" "}
            {format(new Date(req.requested_at), "HH:mm")}
          </p>
        </div>
      </div>
      <div className="flex gap-2 shrink-0">
        <Button
          size="sm"
          onClick={onApprove}
          className={`h-7 text-xs border-0 text-white font-medium ${isFirstTimer ? "bg-amber-600 hover:bg-amber-500 dark:bg-amber-500 dark:hover:bg-amber-400" : "bg-teal-600 hover:bg-teal-500 dark:bg-teal-500 dark:hover:bg-teal-400"}`}
        >
          Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onReject}
          className="h-7 text-xs"
        >
          Reject
        </Button>
      </div>
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  let classes = "";
  switch (role) {
    case "super_admin":
      classes = "bg-purple-500/12 text-purple-300 border-purple-500/25";
      break;
    case "leader":
      classes = "bg-blue-500/12 text-blue-300 border-blue-500/25";
      break;
    case "member":
      classes = "bg-teal-500/12 text-teal-300 border-teal-500/25";
      break;
    default:
      classes = "bg-muted/60 text-muted-foreground border-border/50";
  }
  return (
    <Badge className={`${classes} text-xs`} variant="outline">
      {role.replace("_", " ")}
    </Badge>
  );
}

function KpiCard({
  title,
  value,
  loading,
  icon,
  lastUpdated,
  accent,
}: {
  title: string;
  value?: number;
  loading: boolean;
  icon: ReactNode;
  lastUpdated?: string | null;
  accent?: "teal" | "cyan" | "blue" | "indigo";
}) {
  const borderMap = {
    teal: "border-t-teal-500",
    cyan: "border-t-cyan-500",
    blue: "border-t-blue-500",
    indigo: "border-t-indigo-500",
  };
  return (
    <Card
      className={`border-t-2 ${borderMap[accent ?? "teal"]} bg-card/60 backdrop-blur-sm`}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-4 px-4">
        <CardTitle className="text-xs font-medium text-muted-foreground">
          {title}
        </CardTitle>
        {icon}
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {loading ? (
          <>
            <Skeleton className="h-8 w-14" />
            <Skeleton className="mt-1.5 h-2.5 w-24" />
          </>
        ) : (
          <>
            <div className="text-3xl font-bold tabular-nums">{value ?? 0}</div>
            {lastUpdated && (
              <p className="mt-1 text-xs text-muted-foreground">
                Updated {lastUpdated}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SimpleTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: (string | ReactNode)[][];
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border/50">
      <table className="w-full text-sm">
        <thead className="bg-muted/25 border-b border-border/50">
          <tr>
            {headers.map((h) => (
              <th
                key={h}
                className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground uppercase tracking-wide whitespace-nowrap"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/40">
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-muted/15 transition-colors">
              {row.map((cell, j) => (
                <td key={`${i}-${j}`} className="px-4 py-3 text-sm">
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
