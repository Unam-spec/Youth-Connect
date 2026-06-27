import { useState, useEffect, useRef } from "react";
import { Layout } from "@/components/layout";
import { getLeaderSession } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Label } from "@/components/ui/label";
import { WATERBERG_SCHOOLS, SA_UNIVERSITIES, NONE_SCHOOL } from "@/lib/schools";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useGetMyProfile,
  getGetMyProfileQueryKey,
  useListEvents,
  getListEventsQueryKey,
  useListMyRsvps,
  getListMyRsvpsQueryKey,
  useUpsertRsvp,
  getGetEventStatsQueryKey,
  useUpdateMyProfile,
  useGetMyAttendance,
  getGetMyAttendanceQueryKey,
} from "@workspace/api-client-react";
import { isPostServiceWindow, serviceBannerKey } from "@/lib/serviceBanner";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { CalendarIcon, Clock, GraduationCap, MapPin, CheckCircle, XCircle, Phone, QrCode, Camera, User, Upload, Check, BookOpen, Star } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@clerk/react";
import { Settings2 } from "lucide-react";
import { FeedbackModal } from "@/components/member/FeedbackModal";
import { PreferencesModal } from "@/components/member/PreferencesModal";
import { StreakWidget } from "@/components/member/StreakWidget";
import { OnboardingTour, type TourStep } from "@/components/member/OnboardingTour";

export default function MyDashboard() {
  const { isLoaded, isSignedIn } = useAuth();
  const [, setLocation] = useLocation();

  // ── Member-experience features: feedback / preferences / streak / tour ───────
  const profileSectionRef = useRef<HTMLElement>(null);
  const checkInSectionRef = useRef<HTMLElement>(null);
  const eventsSectionRef = useRef<HTMLElement>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [feedbackSettings, setFeedbackSettings] = useState<{
    enabled: boolean;
    interval_days: number;
    title: string;
    body: string;
    examples?: string[];
  } | null>(null);

  // Invitations state
  const [invitations, setInvitations] = useState<any[]>([]);

  useEffect(() => {
    if (isSignedIn) {
      fetch("/api/membership-requests/my-invitations")
        .then(r => r.ok ? r.json() : [])
        .then(data => setInvitations(data))
        .catch(() => {});
    }
  }, [isSignedIn]);

  const handleRespondToInvitation = async (id: string, action: "accept" | "decline") => {
    try {
      const res = await fetch(`/api/membership-requests/invitations/${id}/${action}`, {
        method: "POST"
      });
      if (res.ok) {
        setInvitations(prev => prev.filter(inv => inv.id !== id));
        if (action === "accept") {
          toast({ title: "Welcome!", description: "You are now a full member of JG Youth." });
          // Force a refetch of the profile to update the role
          window.location.reload();
        } else {
          toast({ title: "Invitation declined" });
        }
      }
    } catch (err) {
      toast({ title: "Error", description: "Could not respond to invitation.", variant: "destructive" });
    }
  };

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      setLocation("/sign-in", { replace: true });
    }
  }, [isLoaded, isSignedIn, setLocation]);


  const leaderSession = getLeaderSession();

  // For PIN-authenticated leaders, fetch profile directly by profile_id from session
  const [leaderProfile, setLeaderProfile] = useState<any>(null);
  const [isLeaderProfileLoading, setIsLeaderProfileLoading] = useState(false);

  useEffect(() => {
    if (leaderSession?.profile_id && !(window as any).__clerkIsSignedIn) {
      setIsLeaderProfileLoading(true);
      const sessionStr = localStorage.getItem("jg_leader_session");
      fetch(`/api/profiles/${leaderSession.profile_id}`, {
        headers: {
          "Content-Type": "application/json",
          ...(sessionStr ? { "x-leader-session": sessionStr } : {}),
        },
      })
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data) setLeaderProfile(data); })
        .catch(() => {})
        .finally(() => setIsLeaderProfileLoading(false));
    }
  }, [leaderSession?.profile_id]);

  const { data: clerkProfile, isLoading: isClerkProfileLoading, error: clerkProfileError } = useGetMyProfile({
    query: { enabled: true, queryKey: getGetMyProfileQueryKey() },
  });

  // Use Clerk profile if available, fall back to leader PIN session profile
  const profile = clerkProfile ?? leaderProfile;
  const isProfileLoading = isClerkProfileLoading || isLeaderProfileLoading;
  const { data: events, isLoading: isEventsLoading } = useListEvents(
    { upcoming: true },
    { query: { enabled: true, queryKey: getListEventsQueryKey({ upcoming: true }) } },
  );
  const { data: rsvps, isLoading: isRsvpsLoading } = useListMyRsvps({
    query: { enabled: !!profile, queryKey: getListMyRsvpsQueryKey() },
  });
  const { data: myAttendance, isLoading: isAttendanceLoading } = useGetMyAttendance({
    query: { enabled: !!profile, queryKey: getGetMyAttendanceQueryKey() },
  });

  // Fetch the editable feedback prompt config (public endpoint).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/feedbacks/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d) setFeedbackSettings(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Recurring member feedback (all roles): welcome once for a new account, then at
  // most once per `interval_days` — and only after they've checked in since the
  // last prompt. Cadence is tracked per-profile in localStorage.
  useEffect(() => {
    if (!profile || !feedbackSettings || feedbackSettings.enabled === false) return;
    const pid = profile.id;
    if (!pid) return;

    const key = `jg_feedback_last_${pid}`;
    const lastRaw = localStorage.getItem(key);
    const last = lastRaw ? parseInt(lastRaw, 10) : null;
    const intervalMs = (feedbackSettings.interval_days ?? 14) * 24 * 60 * 60 * 1000;
    const now = Date.now();

    // Most recent check-in (ms) from attendance session dates.
    const latestCheckin = (myAttendance ?? []).reduce<number>((max, a) => {
      const t = a.session_date ? new Date(a.session_date).getTime() : NaN;
      return Number.isNaN(t) ? max : Math.max(max, t);
    }, 0);

    const due =
      last == null
        ? true // first time → welcome prompt
        : now - last >= intervalMs && latestCheckin > last; // cadence + fresh check-in

    if (due) {
      localStorage.setItem(key, String(now));
      setFeedbackOpen(true);
    }
  }, [profile, feedbackSettings, myAttendance]);

  // First-time onboarding tour: deferred until (a) the feedback modal isn't in the
  // way and (b) the member has actually submitted their core profile info to the
  // DB. New accounts land here with a half-filled profile and get the
  // profile-completion prompt first; firing the tour over that prompt is the
  // "onboarding gets in the way of registration" bug. We gate on the persisted
  // profile (phone + real name) rather than the prompt's local state so the tour
  // starts on the next render after the save round-trips and `profile` refreshes.
  useEffect(() => {
    if (!profile || feedbackOpen) return;
    const profileIncomplete =
      !profile.phone ||
      !profile.full_name ||
      profile.full_name === "New Member" ||
      !profile.avatar_url ||
      profile.avatar_url.startsWith("gradient:");
    if (profileIncomplete) return;
    if (localStorage.getItem("jg_tour_completed")) return;
    const t = setTimeout(() => setTourOpen(true), 600);
    return () => clearTimeout(t);
  }, [profile, feedbackOpen]);

  const tourSteps: TourStep[] = [
    {
      target: checkInSectionRef,
      title: "Check in each week",
      body: "Tap here on session nights to check in — scan the venue QR or search your name.",
    },
    {
      target: eventsSectionRef,
      title: "Browse & RSVP to events",
      body: "See what's coming up and let us know if you're going. Your RSVPs live under this section.",
    },
    {
      target: profileSectionRef,
      title: "Your profile",
      body: "Update your details, add a photo, and manage your notification preferences here.",
    },
  ];

  function closeTour() {
    setTourOpen(false);
    localStorage.setItem("jg_tour_completed", "1");
  }

  const now = new Date();
  const [bannerDismissed, setBannerDismissed] = useState(
    () => typeof localStorage !== "undefined" && !!localStorage.getItem(serviceBannerKey(now)),
  );
  const showServiceBanner = isPostServiceWindow(now) && !bannerDismissed;

  const upsertRsvp = useUpsertRsvp();
  const updateProfile = useUpdateMyProfile();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Phone/name prompt state
  const [showProfilePrompt, setShowProfilePrompt] = useState(false);
  const [promptPhone, setPromptPhone] = useState("");
  const [promptName, setPromptName] = useState("");
  const [promptSchool, setPromptSchool] = useState("");
  const [promptGender, setPromptGender] = useState<"male" | "female">("male");
  const [promptParentName, setPromptParentName] = useState("");
  const [promptParentPhone, setPromptParentPhone] = useState("");
  const [promptWhatsappOptIn, setPromptWhatsappOptIn] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [showSchoolDropdown, setShowSchoolDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowSchoolDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Profile Picture state
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [showAvatarDialog, setShowAvatarDialog] = useState(false);
  const [isSavingAvatar, setIsSavingAvatar] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const presets = [
    "linear-gradient(135deg, #FF5E3A 0%, #FF2A68 100%)", // Sunset
    "linear-gradient(135deg, #007AFF 0%, #00C6FF 100%)", // Ocean
    "linear-gradient(135deg, #30D158 0%, #8E2DE2 100%)", // Neon
    "linear-gradient(135deg, #BF5AF2 0%, #5AC8FA 100%)", // Lavender
    "linear-gradient(135deg, #FFD60A 0%, #FF9500 100%)", // Fire
    "linear-gradient(135deg, #FF2D55 0%, #FF9500 100%)", // Coral
    "linear-gradient(135deg, #1D976C 0%, #93F9B9 100%)", // Emerald
    "linear-gradient(135deg, #111827 0%, #4B5563 100%)", // Slate
  ];

  // Active tab state — so RSVP switches tab
  const [eventsTab, setEventsTab] = useState<"upcoming" | "my-rsvps">("upcoming");

  // Show prompt if profile loaded and missing phone/name OR missing school/parent details
  const profileLoaded = !isProfileLoading && !!profile;
  const needsPhone = profileLoaded && !profile!.phone;
  const needsName = profileLoaded && (!profile!.full_name || profile!.full_name === "New Member");
  const needsSchoolOrParent = profileLoaded && (!profile!.school || !profile!.parent_phone || !(profile as any).parent_name);
  // Profile picture is compulsory — gradient-only backgrounds don't count as a real photo.
  const needsAvatar = profileLoaded && (!profile!.avatar_url || profile!.avatar_url.startsWith("gradient:"));
  
  // Prompt existing members if missing school/parent_phone, unless they dismissed it in this session
  const shouldPrompt = needsPhone || needsName || needsAvatar || (needsSchoolOrParent && !localStorage.getItem("dismissed_school_prompt"));

  // Open prompt once when profile loads and is incomplete
  if (profileLoaded && shouldPrompt && !showProfilePrompt && promptPhone === "" && promptName === "") {
    setShowProfilePrompt(true);
    setPromptPhone(profile!.phone ?? "");
    setPromptName(profile!.full_name === "New Member" ? "" : (profile!.full_name ?? ""));
    setPromptSchool((profile as any).school ?? "");
    setPromptGender(profile!.gender === "female" ? "female" : "male");
    setPromptParentName((profile as any).parent_name ?? "");
    setPromptParentPhone((profile as any).parent_phone ?? "");
    setPromptWhatsappOptIn(!!(profile as any).whatsapp_opt_in);
  }

  async function handleSaveProfile() {
    if (!promptPhone.trim() || promptPhone.trim().length < 9) {
      toast({ title: "Phone number required", description: "Please enter a valid phone number.", variant: "destructive" });
      return;
    }
    if (!promptName.trim() || promptName.trim().split(" ").length < 2) {
      toast({ title: "Full name required", description: "Please enter your first and last name.", variant: "destructive" });
      return;
    }
    setIsSavingProfile(true);
    try {
      await updateProfile.mutateAsync({
        data: {
          phone: promptPhone.trim(),
          full_name: promptName.trim(),
          school: promptSchool.trim() || "",
          gender: promptGender,
          parent_name: promptParentName.trim() || "",
          parent_phone: promptParentPhone.trim() || "",
          whatsapp_opt_in: promptWhatsappOptIn,
        },
      });
      queryClient.invalidateQueries({ queryKey: getGetMyProfileQueryKey() });
      toast({ title: "Profile updated" });
      setShowProfilePrompt(false);
      localStorage.setItem("dismissed_school_prompt", "true");
    } catch {
      toast({ title: "Failed to save profile", variant: "destructive" });
    } finally {
      setIsSavingProfile(false);
    }
  }

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 400 }, height: { ideal: 400 }, facingMode: "user" }
      });
      setCameraStream(stream);
      setIsCameraActive(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(e => console.error("Error playing video:", e));
        }
      }, 100);
    } catch (err) {
      toast({
        title: "Camera error",
        description: "Could not access camera. Please ensure permissions are granted.",
        variant: "destructive"
      });
    }
  }

  function stopCamera() {
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
      setCameraStream(null);
    }
    setIsCameraActive(false);
  }

  async function capturePhoto() {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement("canvas");
    const size = Math.min(video.videoWidth, video.videoHeight) || 300;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const sx = (video.videoWidth - size) / 2;
      const sy = (video.videoHeight - size) / 2;
      ctx.drawImage(video, sx, sy, size, size, 0, 0, size, size);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      stopCamera();
      await saveAvatar(dataUrl);
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        toast({ title: "File too large", description: "Please upload an image smaller than 2MB.", variant: "destructive" });
        return;
      }
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64String = reader.result as string;
        await saveAvatar(base64String);
      };
      reader.readAsDataURL(file);
    }
  };

  async function saveAvatar(avatarUrl: string) {
    setIsSavingAvatar(true);
    try {
      await updateProfile.mutateAsync({
        data: {
          avatar_url: avatarUrl,
        },
      });
      queryClient.invalidateQueries({ queryKey: getGetMyProfileQueryKey() });
      toast({ title: "Profile picture updated" });
      setShowAvatarDialog(false);
    } catch {
      toast({ title: "Failed to update profile picture", variant: "destructive" });
    } finally {
      setIsSavingAvatar(false);
    }
  }

  const handleRsvp = (eventId: string, status: "going" | "not_going" | "maybe") => {
    upsertRsvp.mutate(
      { eventId, data: { status } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMyRsvpsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetEventStatsQueryKey(eventId) });
          toast({ title: "RSVP updated" });
          // Switch to My RSVPs tab so they see their response
          setEventsTab("my-rsvps");
        },
        onError: () => {
          toast({ title: "Failed to update RSVP", variant: "destructive" });
        },
      },
    );
  };

  const getRsvpStatus = (eventId: string) => {
    return rsvps?.find((r) => r.event_id === eventId)?.status;
  };

  if (!isLoaded || !isSignedIn) return null;

  return (
    <Layout>
      {/* Member Invitation Modal */}
      <Dialog open={invitations.length > 0} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md rounded-2xl" onPointerDownOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
          {invitations.length > 0 && (
            <>
              <DialogHeader>
                <DialogTitle className="text-xl font-bold flex items-center gap-2">
                  <Star className="w-5 h-5 text-amber-500 fill-amber-500" /> You're Invited!
                </DialogTitle>
                <DialogDescription className="text-base text-foreground mt-3">
                  <span className="font-semibold">{invitations[0].leader_name}</span> has invited you to become a full member of Jeremiah Generation Youth.
                  As a member, you'll be able to RSVP to events and track your check-ins!
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="flex-col sm:flex-row gap-2 mt-6">
                <Button variant="outline" className="w-full sm:w-1/2 rounded-xl" onClick={() => handleRespondToInvitation(invitations[0].id, "decline")}>
                  Decline
                </Button>
                <Button className="w-full sm:w-1/2 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => handleRespondToInvitation(invitations[0].id, "accept")}>
                  Accept Invitation
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      
      <div className="max-w-4xl mx-auto space-y-10 py-6 px-4">

        {showServiceBanner && (
          <div className="rounded-2xl border border-border bg-card p-4 flex items-center justify-between gap-3 animate-fade-in">
            <p className="text-sm font-semibold text-foreground">Thanks for coming tonight! 🙌</p>
            <button
              onClick={() => {
                localStorage.setItem(serviceBannerKey(now), "1");
                setBannerDismissed(true);
              }}
              className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-lg"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Profile card */}
        <section ref={profileSectionRef}>
          {isProfileLoading ? (
            <Skeleton className="h-44 w-full max-w-md rounded-2xl" />
          ) : profile ? (
            <Card className="max-w-md border-border bg-card rounded-2xl overflow-hidden hover:border-primary/40 transition-colors duration-300">
              <div
                className="h-24 relative bg-cover bg-center bg-no-repeat"
                style={{ backgroundImage: "url('/youth-night-cover.jpg')", backgroundColor: "#10b981" }}
              >
                <div className="absolute inset-0 bg-foreground/20" />
              </div>
              <CardContent className="pt-0 relative px-6 pb-6">
                <div className="flex justify-between items-end -mt-10 mb-4">
                  <div className="relative group cursor-pointer">
                    <div 
                      onClick={() => {
                        if (profile.avatar_url && !profile.avatar_url.startsWith("gradient:")) {
                          setLightboxImage(profile.avatar_url);
                        } else {
                          setShowAvatarDialog(true);
                        }
                      }}
                      className="h-20 w-20 rounded-full border-4 border-background overflow-hidden bg-muted flex items-center justify-center shadow-lg transition-transform hover:scale-105 duration-200"
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
                        <div className="h-full w-full bg-primary flex items-center justify-center text-xl font-bold text-primary-foreground uppercase">
                          {profile.full_name?.charAt(0)?.toUpperCase() ?? <User className="w-6 h-6" />}
                        </div>
                      )}
                    </div>
                    <div 
                      onClick={() => setShowAvatarDialog(true)}
                      className="absolute inset-0 bg-black/40 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none"
                    >
                      <Camera className="w-5 h-5 text-white" />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPrefsOpen(true)}
                      aria-label="Preferences"
                      className="text-muted-foreground hover:text-primary border border-border p-1.5 rounded-full bg-card hover:bg-primary/5 transition-all"
                    >
                      <Settings2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setShowProfilePrompt(true)}
                      className="text-xs text-primary hover:underline font-semibold border border-border px-3 py-1.5 rounded-full bg-card hover:bg-primary/5 transition-all"
                    >
                      Edit Profile
                    </button>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <h3 className="font-[family-name:var(--app-font-heading)] text-2xl font-semibold tracking-tight text-foreground">{profile.full_name}</h3>
                    <div className="capitalize flex items-center gap-2 mt-1">
                      <span className="px-2.5 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-semibold uppercase tracking-wider">
                        {profile?.role?.replace("_", " ")?.replace("-", " ")}
                      </span>
                      {profile?.role === "visitor" && (
                        <Link href="/become-member" className="text-xs text-primary hover:underline font-medium">
                          Become a Member
                        </Link>
                      )}
                    </div>
                  </div>

                  <div className="text-sm text-muted-foreground space-y-2.5 pt-3.5 border-t border-border">
                    {profile.phone ? (
                      <p className="flex items-center gap-2 text-foreground/80">
                        <Phone className="h-4 w-4 shrink-0 text-muted-foreground" />
                        {profile.phone}
                      </p>
                    ) : (
                      <p className="flex items-center gap-2 text-destructive font-medium">
                        <Phone className="h-4 w-4 shrink-0" />
                        Missing phone number
                      </p>
                    )}
                    {profile.email && (
                      <p className="flex items-center gap-2 text-foreground/80">
                        <span className="text-xs text-muted-foreground w-4 text-center font-bold shrink-0">@</span>
                        {profile.email}
                      </p>
                    )}
                    {(profile as any).school && (
                      <p className="flex items-center gap-2 text-foreground/80">
                        <GraduationCap className="h-4 w-4 shrink-0 text-muted-foreground" />
                        {(profile as any).school}
                      </p>
                    )}
                    {(profile as any).parent_phone && (
                      <p className="flex items-center gap-2 text-foreground/80 text-xs">
                        <span className="font-semibold text-muted-foreground">Parent Phone:</span>
                        {(profile as any).parent_phone}
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="p-4 border border-destructive/20 bg-destructive/10 rounded-2xl text-destructive text-sm flex flex-col gap-2">
              <span className="font-semibold">Could not load profile.</span>
              {clerkProfileError && (
                <span className="text-xs opacity-80 break-words">
                  {clerkProfileError instanceof Error ? clerkProfileError.message : String(clerkProfileError)}
                </span>
              )}
            </div>
          )}
        </section>

        {/* Check-In section */}
        <section ref={checkInSectionRef}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-[family-name:var(--app-font-heading)] text-2xl font-semibold tracking-tight text-foreground">Check-In</h2>
          </div>
          <Link href="/checkin">
            <div className="rounded-2xl border border-border bg-card p-5 flex items-center gap-4 cursor-pointer hover:border-primary/40 transition-colors">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <QrCode className="w-6 h-6 text-primary" />
              </div>
              <div>
                <p className="font-semibold text-sm text-foreground">Check In</p>
                <p className="text-xs text-muted-foreground mt-0.5">Scan the venue QR or search your name</p>
              </div>
            </div>
          </Link>
          <div className="mt-4">
            <StreakWidget sessionDates={(myAttendance ?? []).map((a) => a.session_date)} />
          </div>
        </section>

        {/* My Check-ins */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-[family-name:var(--app-font-heading)] text-2xl font-semibold tracking-tight text-foreground">My Check-ins</h2>
            {myAttendance && myAttendance.length > 0 && (
              <span className="text-xs text-muted-foreground">{myAttendance.length} total</span>
            )}
          </div>
          {isAttendanceLoading ? (
            <Skeleton className="h-16 w-full rounded-2xl" />
          ) : myAttendance && myAttendance.length > 0 ? (
            <div className="space-y-2.5">
              {myAttendance.map((a) => (
                <div key={a.id} className="flex items-center justify-between rounded-2xl border border-border bg-card px-4 py-3">
                  <div>
                    <p className="font-semibold text-sm text-foreground">
                      {a.session_date ? format(new Date(a.session_date), "EEEE, MMM d, yyyy") : "Session"}
                    </p>
                    {a.event_title && <p className="text-xs text-muted-foreground mt-0.5">{a.event_title}</p>}
                  </div>
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider ${
                    a.check_in_method === "qr" ? "bg-primary/10 text-primary" :
                    a.check_in_method === "self" ? "bg-emerald-600/10 text-emerald-700" :
                    "bg-amber-600/10 text-amber-700"
                  }`}>
                    {a.check_in_method}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-6">No check-ins yet. See you on Friday! 🙌</p>
          )}
        </section>

        {/* Events */}
        <section ref={eventsSectionRef}>
          <Tabs value={eventsTab} onValueChange={(v) => setEventsTab(v as "upcoming" | "my-rsvps")}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-[family-name:var(--app-font-heading)] text-2xl font-semibold tracking-tight text-foreground">Events</h2>
              <TabsList className="rounded-xl">
                <TabsTrigger value="upcoming" className="rounded-lg text-xs">Upcoming</TabsTrigger>
                <TabsTrigger value="my-rsvps" className="rounded-lg text-xs">My RSVPs</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="upcoming" className="mt-0">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {isEventsLoading ? (
                  Array.from({ length: 2 }).map((_, i) => (
                    <Skeleton key={i} className="h-52 w-full rounded-2xl" />
                  ))
                ) : events && events.length > 0 ? (
                  events.map((event) => {
                    const status = getRsvpStatus(event.id);
                    return (
                      <Card key={event.id} className="flex flex-col rounded-2xl border-border overflow-hidden">
                        {event.poster_url && (
                          <img
                            src={event.poster_url}
                            alt={`${event.title} poster`}
                            className="w-full aspect-video object-cover"
                          />
                        )}
                        <CardHeader className="pb-3">
                          <CardTitle className="font-[family-name:var(--app-font-heading)] line-clamp-1 text-lg font-semibold tracking-tight">{event.title}</CardTitle>
                          <CardDescription className="flex items-center gap-1.5 mt-1 text-xs">
                            <CalendarIcon className="h-3.5 w-3.5" />
                            {format(new Date(event.date), "EEEE, MMM d")}
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="flex-1 pt-0">
                          <div className="space-y-1.5 text-xs text-muted-foreground mb-4">
                            <div className="flex items-center gap-2">
                              <Clock className="h-3.5 w-3.5" />
                              <span>{event.time}</span>
                            </div>
                            <div className="flex items-start gap-2">
                              <MapPin className="h-3.5 w-3.5 mt-0.5" />
                              <span className="line-clamp-1">{event.location}</span>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant={status === "going" ? "default" : "outline"}
                              className={`flex-1 rounded-xl text-xs h-9 ${status === "going" ? "bg-emerald-600 hover:bg-emerald-600/90 text-white border-0" : ""}`}
                              onClick={() => handleRsvp(event.id, "going")}
                            >
                              <CheckCircle className="w-3.5 h-3.5 mr-1.5" /> Going
                            </Button>
                            <Button
                              size="sm"
                              variant={status === "not_going" ? "destructive" : "outline"}
                              className="flex-1 rounded-xl text-xs h-9"
                              onClick={() => handleRsvp(event.id, "not_going")}
                            >
                              <XCircle className="w-3.5 h-3.5 mr-1.5" /> Can't Make It
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })
                ) : (
                  <p className="text-sm text-muted-foreground col-span-full py-6">No upcoming events.</p>
                )}
              </div>
            </TabsContent>

            <TabsContent value="my-rsvps" className="mt-0">
              <div className="space-y-3">
                {isRsvpsLoading ? (
                  <Skeleton className="h-16 w-full rounded-2xl" />
                ) : rsvps && rsvps.length > 0 ? (
                  rsvps.map((rsvp) => (
                    <Card key={rsvp.id} className="rounded-2xl border-border">
                      <CardContent className="p-4 flex items-center justify-between">
                        <div>
                          <p className="font-semibold text-sm text-foreground">{rsvp.event?.title || "Event"}</p>
                          <p className="text-xs text-muted-foreground">
                            {rsvp.event?.date ? format(new Date(rsvp.event.date), "MMM d, yyyy") : ""}
                          </p>
                        </div>
                        <div
                          className={`px-3 py-1 rounded-full text-xs font-semibold
                            ${rsvp.status === "going" ? "bg-emerald-600/10 text-emerald-700" :
                              rsvp.status === "not_going" ? "bg-red-600/10 text-red-700" :
                              "bg-amber-600/10 text-amber-700"}`}
                        >
                          {rsvp.status?.replace("_", " ")?.toUpperCase()}
                        </div>
                      </CardContent>
                    </Card>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground py-6">You haven't RSVP'd to any events yet.</p>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </section>
      </div>

      {/* Phone + name prompt dialog */}
      <Dialog open={showProfilePrompt} onOpenChange={(open) => { if (!open && !needsPhone && !needsName) { setShowProfilePrompt(false); localStorage.setItem("dismissed_school_prompt", "true"); } }}>
        <DialogContent className="sm:max-w-md rounded-2xl bg-popover border border-border text-popover-foreground shadow-xl max-h-[85vh] overflow-y-auto overflow-x-hidden">
          <DialogHeader>
            <DialogTitle className="font-[family-name:var(--app-font-heading)] text-2xl font-semibold tracking-tight">Complete your profile</DialogTitle>
            <DialogDescription>
              Your full name and phone number are required so leaders can identify you at sessions.
            </DialogDescription>
          </DialogHeader>          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="prompt-name">Full Name <span className="text-destructive">*</span></Label>
              <Input
                id="prompt-name"
                placeholder="First Last"
                value={promptName}
                onChange={(e) => setPromptName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prompt-phone">Phone Number <span className="text-destructive">*</span></Label>
              <PhoneInput
                value={promptPhone}
                onChange={setPromptPhone}
              />
            </div>
            {/* Gender Field (Male / Female Only) */}
            <div className="space-y-1.5">
              <Label htmlFor="prompt-gender">Gender <span className="text-destructive">*</span></Label>
              <select
                id="prompt-gender"
                value={promptGender}
                onChange={(e) => setPromptGender(e.target.value as "male" | "female")}
                className="w-full bg-card border border-border rounded-xl h-10 px-3 text-sm text-foreground focus:border-primary focus:ring-primary cursor-pointer"
              >
                <option value="male" className="bg-popover text-popover-foreground">Male</option>
                <option value="female" className="bg-popover text-popover-foreground">Female</option>
              </select>
            </div>
            {/* Autocomplete School / University dropdown */}
            <div className="space-y-1.5 relative" ref={dropdownRef}>
              <Label htmlFor="prompt-school">School / University <span className="text-muted-foreground text-xs font-normal">(optional)</span></Label>
              <div className="relative">
                <Input
                  id="prompt-school"
                  placeholder="Start typing school or university..."
                  value={promptSchool}
                  onFocus={() => setShowSchoolDropdown(true)}
                  onChange={(e) => {
                    setPromptSchool(e.target.value);
                    setShowSchoolDropdown(true);
                  }}
                  className="pr-10"
                />
                <div className="absolute right-3 top-2.5 text-muted-foreground">
                  <GraduationCap className="w-4 h-4" />
                </div>
              </div>
              {showSchoolDropdown && (() => {
                const query = promptSchool.toLowerCase();
                const filteredWaterberg = WATERBERG_SCHOOLS.filter(s => s.toLowerCase().includes(query));
                const filteredUni = SA_UNIVERSITIES.filter(s => s.toLowerCase().includes(query));
                const showNone = NONE_SCHOOL.toLowerCase().includes(query);

                return (
                  <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-xl shadow-xl max-h-40 overflow-y-auto">
                    {filteredWaterberg.length > 0 && (
                      <>
                        <div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider bg-muted">
                          Waterberg Schools
                        </div>
                        {filteredWaterberg.map((schoolName) => (
                          <div
                            key={schoolName}
                            onClick={() => {
                              setPromptSchool(schoolName);
                              setShowSchoolDropdown(false);
                            }}
                            className="px-4 py-2 text-sm text-foreground hover:bg-primary/10 hover:text-primary cursor-pointer flex items-center justify-between transition-colors duration-150"
                          >
                            <span className="flex items-center gap-2">
                              <BookOpen className="w-3.5 h-3.5 text-primary/60" />
                              {schoolName}
                            </span>
                            {promptSchool === schoolName && <Check className="w-3.5 h-3.5 text-primary" />}
                          </div>
                        ))}
                      </>
                    )}

                    {filteredWaterberg.length > 0 && filteredUni.length > 0 && (
                      <div className="h-px bg-border my-1" />
                    )}

                    {filteredUni.length > 0 && (
                      <>
                        <div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider bg-muted">
                          South African Universities
                        </div>
                        {filteredUni.map((schoolName) => (
                          <div
                            key={schoolName}
                            onClick={() => {
                              setPromptSchool(schoolName);
                              setShowSchoolDropdown(false);
                            }}
                            className="px-4 py-2 text-sm text-foreground hover:bg-primary/10 hover:text-primary cursor-pointer flex items-center justify-between transition-colors duration-150"
                          >
                            <span className="flex items-center gap-2">
                              <GraduationCap className="w-3.5 h-3.5 text-primary/60" />
                              {schoolName}
                            </span>
                            {promptSchool === schoolName && <Check className="w-3.5 h-3.5 text-primary" />}
                          </div>
                        ))}
                      </>
                    )}

                    {((filteredWaterberg.length > 0 || filteredUni.length > 0) && showNone) && (
                      <div className="h-px bg-border my-1" />
                    )}

                    {showNone && (
                      <div
                        onClick={() => {
                          setPromptSchool("None / Completed Schooling");
                          setShowSchoolDropdown(false);
                        }}
                        className="px-4 py-2 text-sm text-foreground hover:bg-primary/10 hover:text-primary cursor-pointer flex items-center justify-between transition-colors duration-150"
                      >
                        <span className="flex items-center gap-2 font-medium">
                          <XCircle className="w-3.5 h-3.5 text-muted-foreground" />
                          None / Completed Schooling
                        </span>
                        {promptSchool === "None / Completed Schooling" && <Check className="w-3.5 h-3.5 text-primary" />}
                      </div>
                    )}

                    {promptSchool && ![...WATERBERG_SCHOOLS, ...SA_UNIVERSITIES, NONE_SCHOOL].includes(promptSchool) && (
                      <div
                        onClick={() => setShowSchoolDropdown(false)}
                        className="px-4 py-2 text-sm text-primary hover:bg-primary/10 cursor-pointer italic flex items-center gap-2"
                      >
                        <Check className="w-3.5 h-3.5" />
                        Use Custom: "{promptSchool}"
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Parent / Guardian Isolated Details */}
            <div className="bg-muted border border-border rounded-xl p-4 space-y-3 shadow-xs">
              <div className="flex items-center gap-2 text-primary font-semibold text-xs border-b border-border pb-1.5">
                <User className="w-3.5 h-3.5" />
                Parent / Guardian Details
              </div>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="prompt-parent-name" className="text-xs text-muted-foreground">Parent/Guardian Name <span className="text-destructive">*</span></Label>
                  <Input
                    id="prompt-parent-name"
                    placeholder="Mary Doe"
                    value={promptParentName}
                    onChange={(e) => setPromptParentName(e.target.value)}
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="prompt-parent-phone" className="text-xs text-muted-foreground">Parent/Guardian Phone <span className="text-destructive">*</span></Label>
                  <PhoneInput
                    value={promptParentPhone}
                    onChange={setPromptParentPhone}
                    className="h-9 text-sm"
                  />
                </div>
              </div>
            </div>

            {/* WhatsApp Group Opt-in checkbox */}
            <div className="flex items-start space-x-3 space-y-0 rounded-xl border border-border bg-muted p-3 shadow-xs">
              <input
                type="checkbox"
                id="prompt-whatsapp-opt-in"
                checked={promptWhatsappOptIn}
                onChange={(e) => setPromptWhatsappOptIn(e.target.checked)}
                className="w-4 h-4 rounded text-primary focus:ring-primary border-border bg-card cursor-pointer mt-0.5"
              />
              <div className="space-y-1 leading-none cursor-pointer" onClick={() => setPromptWhatsappOptIn(!promptWhatsappOptIn)}>
                <Label htmlFor="prompt-whatsapp-opt-in" className="text-xs font-semibold text-foreground cursor-pointer">
                  Join JG Youth WhatsApp Group
                </Label>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Get sessions details and announcements directly on WhatsApp.
                </p>
              </div>
            </div>

            {/* Profile picture required notice */}
            {needsAvatar && (
              <div className="flex items-center gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 shadow-xs">
                <span className="text-2xl">📸</span>
                <div className="flex-1">
                  <p className="text-xs font-semibold text-amber-400">Profile picture required</p>
                  <p className="text-[10px] text-amber-400/70 mt-0.5">Please upload a clear photo of your face so we can recognise you.</p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="rounded-xl text-xs border-amber-500/30 hover:bg-amber-500/10"
                  onClick={() => setShowAvatarDialog(true)}
                >
                  Upload
                </Button>
              </div>
            )}
          </div>
          <DialogFooter className="flex gap-2">
            {needsSchoolOrParent && !needsPhone && !needsName && (
              <Button
                variant="ghost"
                onClick={() => {
                  setShowProfilePrompt(false);
                  localStorage.setItem("dismissed_school_prompt", "true");
                }}
                className="flex-1 rounded-xl"
              >
                Skip for now
              </Button>
            )}
            <Button
              onClick={handleSaveProfile}
              disabled={isSavingProfile}
              className="flex-1 rounded-xl"
            >
              {isSavingProfile ? "Saving…" : "Save Profile"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change Profile Picture Dialog */}
      <Dialog open={showAvatarDialog} onOpenChange={(open) => { setShowAvatarDialog(open); if (!open) stopCamera(); }}>
        <DialogContent className="sm:max-w-md rounded-2xl bg-popover border border-border text-popover-foreground shadow-xl">
          <DialogHeader>
            <DialogTitle className="font-[family-name:var(--app-font-heading)] text-2xl font-semibold tracking-tight">Update Profile Picture</DialogTitle>
            <DialogDescription>
              Upload a clear picture of your face so leaders and members can recognise you. Take a selfie or upload a photo — it must be you!
            </DialogDescription>
            <div className="flex items-center gap-2 mt-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <span className="text-amber-500 text-sm">📸</span>
              <p className="text-xs text-amber-400 font-medium">A profile picture is required. Please use a photo that is recognisable as you.</p>
            </div>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Presets Grid */}
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Select Preset Gradient</label>
              <div className="grid grid-cols-4 gap-3">
                {presets.map((gradient, index) => (
                  <button
                    key={index}
                    onClick={() => saveAvatar(`gradient:${gradient}`)}
                    disabled={isSavingAvatar}
                    style={{ background: gradient }}
                    className="h-12 w-full rounded-xl shadow-sm border border-black/10 hover:scale-105 duration-200 transition-transform cursor-pointer relative flex items-center justify-center group"
                  >
                    {profile?.avatar_url === `gradient:${gradient}` && (
                      <CheckCircle className="w-5 h-5 text-white drop-shadow-md" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Divider 1 */}
            <div className="relative flex items-center py-1">
              <div className="flex-grow border-t border-border" />
              <span className="flex-shrink mx-4 text-xs font-semibold text-muted-foreground uppercase tracking-widest bg-background">or</span>
              <div className="flex-grow border-t border-border" />
            </div>

            {/* Live Camera Option */}
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block">Take Live Photo</label>
              {isCameraActive ? (
                <div className="flex flex-col gap-3">
                  <div className="relative w-full aspect-square max-w-[240px] rounded-2xl overflow-hidden bg-muted border border-border mx-auto">
                    <video
                      ref={videoRef}
                      className="w-full h-full object-cover transform -scale-x-100 animate-fade-in"
                      playsInline
                      muted
                      autoPlay
                    />
                  </div>
                  <div className="flex gap-2 w-full">
                    <Button
                      onClick={capturePhoto}
                      disabled={isSavingAvatar}
                      className="flex-1 rounded-xl h-11 font-semibold"
                    >
                      Capture Snapshot
                    </Button>
                    <Button
                      variant="outline"
                      onClick={stopCamera}
                      disabled={isSavingAvatar}
                      className="rounded-xl h-11 px-4"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="outline"
                  onClick={startCamera}
                  disabled={isSavingAvatar}
                  className="w-full rounded-xl hover:bg-muted h-11 flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Camera className="w-4 h-4" />
                  Use Device Camera
                </Button>
              )}
            </div>

            {/* Divider 2 */}
            <div className="relative flex items-center py-1">
              <div className="flex-grow border-t border-border" />
              <span className="flex-shrink mx-4 text-xs font-semibold text-muted-foreground uppercase tracking-widest bg-background">or</span>
              <div className="flex-grow border-t border-border" />
            </div>

            {/* Custom Photo Upload */}
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block">Upload Custom Photo</label>
              <div className="flex items-center gap-3">
                <input
                  type="file"
                  id="avatar-upload"
                  accept="image/*"
                  onChange={handleFileChange}
                  disabled={isSavingAvatar}
                  className="hidden"
                />
                <Button
                  asChild
                  variant="outline"
                  className="flex-1 rounded-xl cursor-pointer hover:bg-muted h-11"
                  disabled={isSavingAvatar}
                >
                  <label htmlFor="avatar-upload" className="flex items-center justify-center gap-2 cursor-pointer w-full h-full">
                    <Upload className="w-4 h-4" />
                    Choose Image File
                  </label>
                </Button>
                {profile?.avatar_url && !profile.avatar_url.startsWith("gradient:") && (
                  <Button
                    variant="destructive"
                    size="sm"
                    className="rounded-xl h-11 px-4"
                    onClick={() => saveAvatar("")}
                    disabled={isSavingAvatar}
                  >
                    Remove
                  </Button>
                )}
              </div>
              <p className="text-2xs text-muted-foreground mt-1">Supports PNG, JPG, or WEBP up to 2MB. Image will be saved directly in your profile.</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={!!lightboxImage} onOpenChange={(open) => !open && setLightboxImage(null)}>
        <DialogContent className="max-w-2xl bg-transparent border-0 shadow-none p-0 flex flex-col items-center justify-center">
          {lightboxImage && (
            <img src={lightboxImage} alt="Profile" className="max-h-[85vh] max-w-full rounded-xl object-contain shadow-2xl" />
          )}
          <Button onClick={() => { setLightboxImage(null); setShowAvatarDialog(true); }} className="mt-4">
            <Camera className="w-4 h-4 mr-2" /> Change Photo
          </Button>
        </DialogContent>
      </Dialog>

      {/* Member-experience features */}
      <FeedbackModal
        open={feedbackOpen}
        onOpenChange={setFeedbackOpen}
        userId={profile?.id}
        title={feedbackSettings?.title}
        body={feedbackSettings?.body}
        examples={feedbackSettings?.examples}
      />
      <PreferencesModal
        open={prefsOpen}
        onOpenChange={setPrefsOpen}
        whatsappOptIn={!!(profile as any)?.whatsapp_opt_in}
      />
      <OnboardingTour steps={tourSteps} open={tourOpen} onClose={closeTour} />
    </Layout>
  );
}
