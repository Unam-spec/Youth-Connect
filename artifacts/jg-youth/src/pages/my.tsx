import { useState, useEffect, useRef } from "react";
import { Layout } from "@/components/layout";
import { getLeaderSession } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { CalendarIcon, Clock, GraduationCap, MapPin, CheckCircle, XCircle, Phone, QrCode, Camera, User, Upload, Check, BookOpen } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@clerk/react";

export default function MyDashboard() {
  const { isLoaded, isSignedIn } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      setLocation("/sign-in", { replace: true });
    }
  }, [isLoaded, isSignedIn, setLocation]);

  if (!isLoaded || !isSignedIn) return null;

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
  
  // Prompt existing members if missing school/parent_phone, unless they dismissed it in this session
  const shouldPrompt = needsPhone || needsName || (needsSchoolOrParent && !localStorage.getItem("dismissed_school_prompt"));

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

  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-10 py-6 px-4">

        {/* Profile card */}
        <section>
          {isProfileLoading ? (
            <Skeleton className="h-44 w-full max-w-md rounded-2xl" />
          ) : profile ? (
            <Card className="max-w-md border-primary/20 bg-card/50 backdrop-blur rounded-2xl overflow-hidden shadow-lg hover:border-primary/45 transition-colors duration-300">
              <div className="h-24 bg-gradient-to-r from-primary/30 to-teal-500/20 relative">
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/20 via-transparent to-transparent" />
              </div>
              <CardContent className="pt-0 relative px-6 pb-6">
                <div className="flex justify-between items-end -mt-10 mb-4">
                  <div className="relative group cursor-pointer" onClick={() => setShowAvatarDialog(true)}>
                    <div className="h-20 w-20 rounded-full border-4 border-background overflow-hidden bg-muted flex items-center justify-center shadow-lg transition-transform hover:scale-105 duration-200">
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
                        <div className="h-full w-full bg-gradient-to-br from-primary/40 to-teal-500/30 flex items-center justify-center text-xl font-bold text-white uppercase">
                          {profile.full_name?.charAt(0)?.toUpperCase() ?? <User className="w-6 h-6" />}
                        </div>
                      )}
                    </div>
                    <div className="absolute inset-0 bg-black/40 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                      <Camera className="w-5 h-5 text-white" />
                    </div>
                  </div>
                  <button
                    onClick={() => setShowProfilePrompt(true)}
                    className="text-xs text-primary hover:underline font-semibold border border-primary/25 px-3 py-1.5 rounded-full bg-background/80 backdrop-blur shadow-sm hover:bg-primary/5 transition-all"
                  >
                    Edit Profile
                  </button>
                </div>

                <div className="space-y-4">
                  <div>
                    <h3 className="text-xl font-bold tracking-tight">{profile.full_name}</h3>
                    <div className="capitalize flex items-center gap-2 mt-1">
                      <span className="px-2.5 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-semibold uppercase tracking-wider">
                        {profile.role.replace("_", " ").replace("-", " ")}
                      </span>
                      {profile.role === "visitor" && (
                        <Link href="/become-member" className="text-xs text-primary hover:underline font-medium">
                          Become a Member
                        </Link>
                      )}
                    </div>
                  </div>

                  <div className="text-sm text-muted-foreground space-y-2.5 pt-3.5 border-t border-border/40">
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
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold tracking-tight">Check-In</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Link href="/checkin">
              <div className="rounded-2xl border border-[#0A84FF]/30 bg-gradient-to-br from-[#0A84FF]/10 to-[#32ADE6]/5 p-5 flex items-center gap-4 cursor-pointer hover:border-[#0A84FF]/50 transition-colors">
                <div className="w-12 h-12 rounded-full bg-[#0A84FF]/15 flex items-center justify-center flex-shrink-0">
                  <QrCode className="w-6 h-6 text-[#0A84FF]" />
                </div>
                <div>
                  <p className="font-semibold text-sm">Scan QR Check-In</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Scan the venue QR to check in</p>
                </div>
              </div>
            </Link>
            <Link href="/checkin">
              <div className="rounded-2xl border border-[#30D158]/30 bg-gradient-to-br from-[#30D158]/10 to-[#30D158]/5 p-5 flex items-center gap-4 cursor-pointer hover:border-[#30D158]/50 transition-colors">
                <div className="w-12 h-12 rounded-full bg-[#30D158]/15 flex items-center justify-center flex-shrink-0">
                  <CheckCircle className="w-6 h-6 text-[#30D158]" />
                </div>
                <div>
                  <p className="font-semibold text-sm">Self Check-In</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Search your name to check in</p>
                </div>
              </div>
            </Link>
          </div>
        </section>

        {/* Events */}
        <section>
          <Tabs value={eventsTab} onValueChange={(v) => setEventsTab(v as "upcoming" | "my-rsvps")}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-bold tracking-tight">Events</h2>
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
                      <Card key={event.id} className="flex flex-col rounded-2xl border-border/60">
                        <CardHeader className="pb-3">
                          <CardTitle className="line-clamp-1 text-base">{event.title}</CardTitle>
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
                              className={`flex-1 rounded-xl text-xs h-9 ${status === "going" ? "bg-[#30D158] hover:bg-[#30D158]/90 border-0" : ""}`}
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
                    <Card key={rsvp.id} className="rounded-2xl border-border/60">
                      <CardContent className="p-4 flex items-center justify-between">
                        <div>
                          <p className="font-semibold text-sm">{rsvp.event?.title || "Event"}</p>
                          <p className="text-xs text-muted-foreground">
                            {rsvp.event?.date ? format(new Date(rsvp.event.date), "MMM d, yyyy") : ""}
                          </p>
                        </div>
                        <div
                          className={`px-3 py-1 rounded-full text-xs font-semibold
                            ${rsvp.status === "going" ? "bg-[#30D158]/10 text-[#30D158]" :
                              rsvp.status === "not_going" ? "bg-red-500/10 text-red-500" :
                              "bg-yellow-500/10 text-yellow-500"}`}
                        >
                          {rsvp.status.replace("_", " ").toUpperCase()}
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
        <DialogContent className="sm:max-w-md rounded-2xl bg-slate-800/95 border-slate-700 text-white shadow-2xl backdrop-blur-sm">
          <DialogHeader>
            <DialogTitle>Complete your profile</DialogTitle>
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
              <Input
                id="prompt-phone"
                type="tel"
                placeholder="082 123 4567"
                value={promptPhone}
                onChange={(e) => setPromptPhone(e.target.value)}
              />
            </div>
            {/* Gender Field (Male / Female Only) */}
            <div className="space-y-1.5">
              <Label htmlFor="prompt-gender">Gender <span className="text-destructive">*</span></Label>
              <select
                id="prompt-gender"
                value={promptGender}
                onChange={(e) => setPromptGender(e.target.value as "male" | "female")}
                className="w-full bg-slate-950/50 border border-slate-700 rounded-xl h-10 px-3 text-sm text-white focus:border-teal-500 focus:ring-teal-500 cursor-pointer"
              >
                <option value="male" className="bg-slate-800 text-white">Male</option>
                <option value="female" className="bg-slate-800 text-white">Female</option>
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
                <div className="absolute right-3 top-2.5 text-slate-400">
                  <GraduationCap className="w-4 h-4" />
                </div>
              </div>
              {showSchoolDropdown && (() => {
                const query = promptSchool.toLowerCase();
                const filteredWaterberg = [
                  "Paresis Secondary",
                  "Otjiwarongo Secondary",
                  "Waterberg High",
                  "Edugate Academy"
                ].filter(s => s.toLowerCase().includes(query));
                const filteredUni = [
                  "UP", "UCT", "Wits", "Stellenbosch", "UJ", "UNISA", "DUT", "UKZN", "NWU", "UFS", "WSU", "MUT", "CUT", "UFH", "UWC", "RU", "SMU", "VUT", "TUT", "CPUT", "NMU"
                ].filter(s => s.toLowerCase().includes(query));
                const showNone = "None / Completed Schooling".toLowerCase().includes(query);

                return (
                  <div className="absolute z-50 w-full mt-1 bg-slate-800/95 border border-slate-700 rounded-xl shadow-xl max-h-40 overflow-y-auto backdrop-blur-md">
                    {filteredWaterberg.length > 0 && (
                      <>
                        <div className="px-3 py-1.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider bg-slate-950/20">
                          Waterberg Schools
                        </div>
                        {filteredWaterberg.map((schoolName) => (
                          <div
                            key={schoolName}
                            onClick={() => {
                              setPromptSchool(schoolName);
                              setShowSchoolDropdown(false);
                            }}
                            className="px-4 py-2 text-sm text-slate-200 hover:bg-teal-500/20 hover:text-teal-400 cursor-pointer flex items-center justify-between transition-colors duration-150"
                          >
                            <span className="flex items-center gap-2">
                              <BookOpen className="w-3.5 h-3.5 text-teal-500/60" />
                              {schoolName}
                            </span>
                            {promptSchool === schoolName && <Check className="w-3.5 h-3.5 text-teal-400" />}
                          </div>
                        ))}
                      </>
                    )}

                    {filteredWaterberg.length > 0 && filteredUni.length > 0 && (
                      <div className="h-px bg-slate-800 my-1" />
                    )}

                    {filteredUni.length > 0 && (
                      <>
                        <div className="px-3 py-1.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider bg-slate-950/20">
                          South African Universities
                        </div>
                        {filteredUni.map((schoolName) => (
                          <div
                            key={schoolName}
                            onClick={() => {
                              setPromptSchool(schoolName);
                              setShowSchoolDropdown(false);
                            }}
                            className="px-4 py-2 text-sm text-slate-200 hover:bg-teal-500/20 hover:text-teal-400 cursor-pointer flex items-center justify-between transition-colors duration-150"
                          >
                            <span className="flex items-center gap-2">
                              <GraduationCap className="w-3.5 h-3.5 text-teal-550/60" />
                              {schoolName}
                            </span>
                            {promptSchool === schoolName && <Check className="w-3.5 h-3.5 text-teal-400" />}
                          </div>
                        ))}
                      </>
                    )}

                    {((filteredWaterberg.length > 0 || filteredUni.length > 0) && showNone) && (
                      <div className="h-px bg-slate-800 my-1" />
                    )}

                    {showNone && (
                      <div
                        onClick={() => {
                          setPromptSchool("None / Completed Schooling");
                          setShowSchoolDropdown(false);
                        }}
                        className="px-4 py-2 text-sm text-slate-300 hover:bg-teal-500/20 hover:text-teal-400 cursor-pointer flex items-center justify-between transition-colors duration-150"
                      >
                        <span className="flex items-center gap-2 font-medium">
                          <XCircle className="w-3.5 h-3.5 text-slate-500/65" />
                          None / Completed Schooling
                        </span>
                        {promptSchool === "None / Completed Schooling" && <Check className="w-3.5 h-3.5 text-teal-400" />}
                      </div>
                    )}

                    {promptSchool && ![
                      "Paresis Secondary",
                      "Otjiwarongo Secondary",
                      "Waterberg High",
                      "Edugate Academy",
                      "UP", "UCT", "Wits", "Stellenbosch", "UJ", "UNISA", "DUT", "UKZN", "NWU", "UFS", "WSU", "MUT", "CUT", "UFH", "UWC", "RU", "SMU", "VUT", "TUT", "CPUT", "NMU",
                      "None / Completed Schooling"
                    ].includes(promptSchool) && (
                      <div
                        onClick={() => setShowSchoolDropdown(false)}
                        className="px-4 py-2 text-sm text-teal-400 hover:bg-teal-500/10 cursor-pointer italic flex items-center gap-2"
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
            <div className="bg-slate-950/40 border border-slate-800/80 rounded-xl p-4 space-y-3 shadow-xs">
              <div className="flex items-center gap-2 text-teal-400 font-semibold text-xs border-b border-slate-800/60 pb-1.5">
                <User className="w-3.5 h-3.5" />
                Parent / Guardian Details
              </div>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="prompt-parent-name" className="text-xs text-slate-300">Parent/Guardian Name <span className="text-destructive">*</span></Label>
                  <Input
                    id="prompt-parent-name"
                    placeholder="Mary Doe"
                    value={promptParentName}
                    onChange={(e) => setPromptParentName(e.target.value)}
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="prompt-parent-phone" className="text-xs text-slate-300">Parent/Guardian Phone <span className="text-destructive">*</span></Label>
                  <Input
                    id="prompt-parent-phone"
                    type="tel"
                    placeholder="e.g. 081 123 4567"
                    value={promptParentPhone}
                    onChange={(e) => setPromptParentPhone(e.target.value)}
                    className="h-9 text-sm"
                  />
                </div>
              </div>
            </div>

            {/* WhatsApp Group Opt-in checkbox */}
            <div className="flex items-start space-x-3 space-y-0 rounded-xl border border-slate-850 bg-slate-950/30 p-3 shadow-xs">
              <input
                type="checkbox"
                id="prompt-whatsapp-opt-in"
                checked={promptWhatsappOptIn}
                onChange={(e) => setPromptWhatsappOptIn(e.target.checked)}
                className="w-4 h-4 rounded text-teal-600 focus:ring-teal-500 border-slate-700 bg-slate-950/50 cursor-pointer mt-0.5"
              />
              <div className="space-y-1 leading-none cursor-pointer" onClick={() => setPromptWhatsappOptIn(!promptWhatsappOptIn)}>
                <Label htmlFor="prompt-whatsapp-opt-in" className="text-xs font-semibold text-slate-200 cursor-pointer">
                  Join JG Youth WhatsApp Group
                </Label>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  Get sessions details and announcements directly on WhatsApp.
                </p>
              </div>
            </div>
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
              className="flex-1 rounded-xl bg-gradient-to-r from-primary to-teal-500 border-0"
            >
              {isSavingProfile ? "Saving…" : "Save Profile"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change Profile Picture Dialog */}
      <Dialog open={showAvatarDialog} onOpenChange={(open) => { setShowAvatarDialog(open); if (!open) stopCamera(); }}>
        <DialogContent className="sm:max-w-md rounded-2xl bg-slate-800/95 border-slate-700 text-white shadow-2xl backdrop-blur-sm">
          <DialogHeader>
            <DialogTitle>Update Profile Picture</DialogTitle>
            <DialogDescription>
              Choose a stunning custom background gradient preset, upload your own photo, or take a live picture.
            </DialogDescription>
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
                  <div className="relative w-full aspect-square max-w-[240px] rounded-2xl overflow-hidden bg-slate-950/50 border border-slate-700 mx-auto">
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
                      className="flex-1 rounded-xl h-11 bg-teal-500 hover:bg-teal-400 text-white font-semibold shadow-md border-0"
                    >
                      Capture Snapshot
                    </Button>
                    <Button
                      variant="outline"
                      onClick={stopCamera}
                      disabled={isSavingAvatar}
                      className="rounded-xl h-11 px-4 border-border/80"
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
                  className="w-full rounded-xl hover:bg-muted/10 h-11 flex items-center justify-center gap-2 cursor-pointer border-border/80"
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
                  className="flex-1 rounded-xl cursor-pointer hover:bg-muted/10 h-11 border-border/80"
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
    </Layout>
  );
}
