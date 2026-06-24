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
} from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import {
  DashboardLayout,
  useDashboardSection,
  type DashboardSectionKey,
} from "@/components/dashboard-layout";
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
  SendHorizontal,
  MessageSquare,
  BookOpen,
  Check,
  GraduationCap,
  MapPin,
  User,
  Phone
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { AttendancePanel } from "@/components/panels/AttendancePanel";
import { MemberDirectoryPanel } from "@/components/panels/MemberDirectoryPanel";
import { PinAccountsPanel } from "@/components/panels/PinAccountsPanel";
import { EventsPanel } from "@/components/panels/EventsPanel";
import { RequestsPanel } from "@/components/panels/RequestsPanel";
import { RSVPPanel } from "@/components/panels/RSVPPanel";
import { LeaderManagementPanel } from "@/components/panels/LeaderManagementPanel";
import { PinManagementPanel } from "@/components/panels/PinManagementPanel";
import { AdminSlotsPanel } from "@/components/panels/AdminSlotsPanel";
import { CheckInSchedulePanel } from "@/components/panels/CheckInSchedulePanel";
import { DeleteConfirmPanel } from "@/components/panels/DeleteConfirmPanel";
import { DialogManager } from "@/components/panels/DialogManager";
import { KpiCard } from "@/components/panels/shared";
import { Activity, Settings } from "lucide-react";

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
      const apiBase = import.meta.env.VITE_API_URL || "";
      const finalUrl = url.startsWith("/") ? `${apiBase}${url}` : url;
      return fetch(finalUrl, {
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
}

export default function Dashboard() {
  const session = getLeaderSession();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const apiFetch = useApiFetch();
  const { isLoaded, isSignedIn, getToken } = useAuth();

  // Auto-restoration effect: rebuild session if Clerk is signed in but localStorage is missing
  useEffect(() => {
    if (isLoaded && isSignedIn && !session) {
      (async () => {
        try {
          const token = await getToken();
          const response = await fetch("/api/profiles/me", {
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
          });
          if (response.ok) {
            const profile = await response.json();
            if (profile.role === "super_admin" || profile.role === "leader") {
              setLeaderSession({
                role: profile.role,
                profile_id: profile.id,
                full_name: profile.full_name,
                can_create_events: profile.role === "super_admin" ? true : profile.can_create_events,
                can_view_kpis: profile.role === "super_admin" ? true : profile.can_view_kpis,
                can_view_members: profile.role === "super_admin" ? true : profile.can_view_members,
                can_view_attendance: profile.role === "super_admin" ? true : profile.can_view_attendance,
              });
              window.location.reload();
            } else {
              // If they are a visitor or member, they shouldn't be on the dashboard.
              // Redirect them to their personal dashboard.
              window.location.href = "/my";
            }
          } else {
            // If the fetch fails (e.g., 401 due to Clerk keys mismatch), redirect to /my
            window.location.href = "/my";
          }
        } catch (e) {
          console.error("Failed to restore leader session automatically:", e);
        }
      })();
    }
  }, [isLoaded, isSignedIn, session, getToken]);

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

  const [settingPinFor, setSettingPinFor] = useState<LeaderPin | null>(null);
  const [leaderPinInput, setLeaderPinInput] = useState("");
  const [pendingCheckIns, setPendingCheckIns] = useState<PendingCheckIn[]>([]);
  const [isPendingLoading, setIsPendingLoading] = useState(false);

  // Edit Profile modal states
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editProfileId, setEditProfileId] = useState<string | null>(null);
  const [editFullName, setEditFullName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editSchool, setEditSchool] = useState("");
  const [editParentName, setEditParentName] = useState("");
  const [editParentPhone, setEditParentPhone] = useState("");
  const [editWhatsappOptIn, setEditWhatsappOptIn] = useState(false);
  const [editAge, setEditAge] = useState(18);
  const [editGender, setEditGender] = useState<"male" | "female">("male");
  const [editShowSchoolDropdown, setEditShowSchoolDropdown] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const [section, setSection] = useDashboardSection();



  function openEditDialog(profile: any) {
    setEditProfileId(profile.id);
    setEditFullName(profile.full_name ?? "");
    setEditPhone(profile.phone ?? "");
    setEditEmail(profile.email ?? "");
    setEditSchool(profile.school ?? "");
    setEditParentName(profile.parent_name ?? "");
    setEditParentPhone(profile.parent_phone ?? "");
    setEditWhatsappOptIn(!!profile.whatsapp_opt_in);
    setEditAge(profile.age ?? 18);
    setEditGender(profile.gender === "female" ? "female" : "male");
    setShowEditDialog(true);
  }

  async function handleSaveEdit() {
    if (!editProfileId) return;
    if (!editFullName.trim()) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    setIsSavingEdit(true);
    try {
      const response = await apiFetch(`/api/profiles/${editProfileId}`, {
        method: "PATCH",
        body: JSON.stringify({
          full_name: editFullName.trim(),
          phone: editPhone.trim() || null,
          email: editEmail.trim() || null,
          school: editSchool.trim() || null,
          parent_name: editParentName.trim() || null,
          parent_phone: editParentPhone.trim() || null,
          whatsapp_opt_in: editWhatsappOptIn,
          age: editAge ? parseInt(String(editAge), 10) : null,
          gender: editGender,
        }),
      });

      if (!response.ok) throw new Error();

      toast({ title: "Profile updated successfully" });
      setShowEditDialog(false);
      queryClient.invalidateQueries({ queryKey: getListProfilesQueryKey() });
    } catch {
      toast({ title: "Failed to update profile", variant: "destructive" });
    } finally {
      setIsSavingEdit(false);
    }
  }

  const [isWipingData, setIsWipingData] = useState(false);
  const [showWipeConfirm, setShowWipeConfirm] = useState(false);

  async function handleWipeData() {
    setIsWipingData(true);
    try {
      const response = await apiFetch("/api/reset-data", {
        method: "POST",
      });
      if (!response.ok) throw new Error();
      toast({ title: "Database Wiped Successfully", description: "All test data has been reset." });
      setShowWipeConfirm(false);
      window.location.reload();
    } catch {
      toast({ title: "Wipe Failed", description: "Could not reset the database.", variant: "destructive" });
    } finally {
      setIsWipingData(false);
    }
  }
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
    poster_url: "",
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

  // Refresh leader pins when the Manage section is opened (the sidebar/command
  // palette can deep-link straight here, so we can't rely on a tab click).
  useEffect(() => {
    if (section === "manage") fetchLeaderPins();
  }, [section, fetchLeaderPins]);

  // Split check-in requests by type
  const pendingMemberCheckIns = useMemo(
    () => pendingCheckIns.filter((r) => r.type === "member"),
    [pendingCheckIns],
  );
  const pendingFirstTimers = useMemo(
    () => pendingCheckIns.filter((r) => r.type === "visitor"),
    [pendingCheckIns],
  );

  // While Clerk is loading, or if signed in but session is not restored yet, show loading
  if (!session) {
    if (!isLoaded || (isSignedIn && !session)) {
      return (
        <Layout>
          <div className="max-w-md mx-auto py-12 flex flex-col items-center justify-center gap-4">
            <div className="w-8 h-8 animate-spin rounded-full border-4 border-t-primary border-r-transparent border-b-transparent border-l-transparent" />
            <p className="text-muted-foreground text-sm font-medium">Verifying leader credentials…</p>
          </div>
        </Layout>
      );
    }
    return <Redirect to="/leader-login" />;
  }

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
          poster_url: eventForm.poster_url || undefined,
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
            poster_url: "",
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
        description: `${profile.full_name} is now ${targetRole?.replace("_", " ")}`,
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

  function mutateProfileRole(action: "promote" | "demote", profileId: string) {
    if (action === "demote") {
      // "Demote to Member": strip the leader role but keep the person a member.
      // The revoke-membership endpoint downgrades member→visitor (which drops
      // them from the directory entirely) — not what demotion means. Use the
      // dedicated leaders/demote endpoint, which sets role: "member" and clears
      // the leader's PIN/session.
      void (async () => {
        try {
          const res = await apiFetch(`/api/leaders/${profileId}/demote`, {
            method: "POST",
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error ?? "Please try again.");
          }
          toast({ title: "Demoted to member" });
          refreshDashboard();
        } catch (error) {
          toast({
            title: "Profile update failed",
            description:
              error instanceof Error ? error.message : "Please try again.",
            variant: "destructive",
          });
        }
      })();
      return;
    }

    promoteToMember.mutate(
      { id: profileId },
      {
        onSuccess: () => {
          toast({ title: "Promoted to member" });
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



  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <DashboardLayout active={section}>
      <div className="space-y-5 pb-12">
        {/* ── Header ── */}
        <div className="rounded-2xl border border-border bg-card p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                </span>
                <span className="text-xs font-semibold text-primary uppercase tracking-widest">
                  Live
                </span>
              </div>
              <h1 className="font-[family-name:var(--app-font-heading)] text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
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
                  className="bg-primary hover:bg-primary/90 text-primary-foreground border-0"
                >
                  <QrCode className="h-4 w-4 mr-2" />
                  {isGeneratingQr ? "Generating…" : "Session QR"}
                </Button>
              )}
              <Badge
                className={
                  session.role === "super_admin"
                    ? "bg-primary/10 text-primary border-primary/25"
                    : "bg-blue-600/10 text-blue-700 border-blue-600/25"
                }
                variant="outline"
              >
                <Shield className="h-3 w-3 mr-1" />
                {session?.role?.replace("_", " ")}
              </Badge>
            </div>
          </div>
        </div>

        {/* ── KPI Cards ── */}
        {session.can_view_kpis && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard
              title="Total Members"
              icon={<Users className="h-4 w-4 text-primary" />}
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
              icon={<CheckCircle className="h-4 w-4 text-primary" />}
              value={kpis?.today_attendance}
              loading={isKpisLoading}
              lastUpdated={kpisUpdatedAt}
              accent="cyan"
            />
            <KpiCard
              title="New Visitors"
              icon={<UserPlus className="h-4 w-4 text-primary" />}
              value={kpis?.today_new_visitors}
              loading={isKpisLoading}
              lastUpdated={kpisUpdatedAt}
              accent="blue"
            />
            <KpiCard
              title="Upcoming Events"
              icon={<Calendar className="h-4 w-4 text-primary" />}
              value={kpis?.upcoming_events_count}
              loading={isKpisLoading}
              lastUpdated={kpisUpdatedAt}
              accent="indigo"
            />
          </div>
        )}

        {/* ── Today's Check-ins banner ── */}
        {session.can_view_attendance && (
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold text-foreground">
                  Today's Check-ins
                </span>
              </div>
              <span className="text-3xl font-bold text-primary tabular-nums">
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
                    className="text-xs px-2.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium border border-primary/20"
                  >
                    {record.profile?.full_name ?? "Unknown"}
                  </span>
                ))}
                {attendance.length > 10 && (
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
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
          value={section}
          onValueChange={(val) => setSection(val as DashboardSectionKey)}
        >
          <TabsContent value="session" className="mt-0 space-y-6">
            <AttendancePanel
              pendingCheckIns={pendingCheckIns}
              isPendingLoading={isPendingLoading}
              fetchPendingCheckIns={fetchPendingCheckIns}
              handleApproveCheckIn={handleApproveCheckIn}
              handleRejectCheckIn={handleRejectCheckIn}
            />
            <CheckInSchedulePanel />
          </TabsContent>

          <TabsContent value="members" className="mt-0 space-y-6">
            <PinAccountsPanel />
            <RequestsPanel
              pendingFirstTimers={pendingFirstTimers}
              isPendingLoading={isPendingLoading}
              handleApproveCheckIn={handleApproveCheckIn}
              handleRejectCheckIn={handleRejectCheckIn}
              mutateRequest={mutateRequest}
            />
            {canViewMembers && (
              <MemberDirectoryPanel
                sessionRole={session.role}
                sessionProfileId={session.profile_id ?? ""}
                canManageMembers={session.can_view_members}
                superAdminCount={superAdminCount}
                openEditDialog={openEditDialog}
                mutateProfileRole={mutateProfileRole}
                setRoleConfirm={setRoleConfirm}
                handlePermissionChange={handlePermissionChange}
                setDeleteMemberId={setDeleteMemberId}
                setDeleteMemberName={setDeleteMemberName}
              />
            )}
          </TabsContent>

          <TabsContent value="events" className="mt-0 space-y-6">
            <EventsPanel
              sessionRole={session.role}
              canCreateEvents={session.can_create_events || session.role === "super_admin"}
              eventForm={eventForm}
              setEventForm={setEventForm}
              handleCreateEvent={handleCreateEvent}
              setDeleteEventId={setDeleteEventId}
              setDeleteEventName={setDeleteEventName}
            />
            {(session.role === "leader" || session.role === "super_admin") && (
              <RSVPPanel
                selectedEventId={selectedEventId}
                setSelectedEventId={setSelectedEventId}
                rsvps={rsvps}
                isRsvpsLoading={isRsvpsLoading}
              />
            )}
          </TabsContent>

          <TabsContent value="manage" className="mt-0 space-y-6">
            {session.role === "super_admin" && (
              <>
                <AdminSlotsPanel
                  superAdminCount={superAdminCount}
                  hasPin={hasPin}
                  setShowPinDialog={setShowPinDialog}
                  setShowWipeConfirm={setShowWipeConfirm}
                />
                <PinManagementPanel
                  leaderPins={leaderPins}
                  isLeaderPinsLoading={isLeaderPinsLoading}
                  setSettingPinFor={setSettingPinFor}
                />
                <LeaderManagementPanel
                  handlePermissionChange={handlePermissionChange}
                  isUpdatingPermissions={isUpdatingPermissions}
                />
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* ── Dialogs ── */}
      <DeleteConfirmPanel
        deleteEventId={deleteEventId}
        setDeleteEventId={setDeleteEventId}
        deleteEventName={deleteEventName}
        handleDeleteEvent={handleDeleteEvent}
        deleteMemberId={deleteMemberId}
        setDeleteMemberId={setDeleteMemberId}
        deleteMemberName={deleteMemberName}
        handleDeleteMember={handleDeleteMember}
        roleConfirm={roleConfirm}
        setRoleConfirm={setRoleConfirm}
        handleConfirmRoleChange={handleConfirmRoleChange}
        showWipeConfirm={showWipeConfirm}
        setShowWipeConfirm={setShowWipeConfirm}
        isWipingData={isWipingData}
        handleWipeData={handleWipeData}
      />
      <DialogManager
        showSessionQrCodeDialog={showSessionQrCodeDialog}
        setShowSessionQrCodeDialog={setShowSessionQrCodeDialog}
        qrCodeUrl={qrCodeUrl}
        showEditDialog={showEditDialog}
        setShowEditDialog={setShowEditDialog}
        editFullName={editFullName}
        setEditFullName={setEditFullName}
        editPhone={editPhone}
        setEditPhone={setEditPhone}
        editEmail={editEmail}
        setEditEmail={setEditEmail}
        editGender={editGender}
        setEditGender={setEditGender}
        editAge={editAge}
        setEditAge={setEditAge}
        editSchool={editSchool}
        setEditSchool={setEditSchool}
        editShowSchoolDropdown={editShowSchoolDropdown}
        setEditShowSchoolDropdown={setEditShowSchoolDropdown}
        editParentName={editParentName}
        setEditParentName={setEditParentName}
        editParentPhone={editParentPhone}
        setEditParentPhone={setEditParentPhone}
        editWhatsappOptIn={editWhatsappOptIn}
        setEditWhatsappOptIn={setEditWhatsappOptIn}
        isSavingEdit={isSavingEdit}
        handleSaveEdit={handleSaveEdit}
        settingPinFor={settingPinFor}
        setSettingPinFor={setSettingPinFor}
        leaderPinInput={leaderPinInput}
        setLeaderPinInput={setLeaderPinInput}
        handleSetLeaderPin={handleSetLeaderPin}
        showPinDialog={showPinDialog}
        setShowPinDialog={setShowPinDialog}
        hasPin={hasPin}
        pin={pin}
        setPin={setPin}
        handleSavePin={handleSavePin}
      />
    </DashboardLayout>
  );
}

