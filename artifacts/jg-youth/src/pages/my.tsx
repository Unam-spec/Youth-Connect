import { useState } from "react";
import { Layout } from "@/components/layout";
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
import { CalendarIcon, Clock, MapPin, CheckCircle, XCircle, QrCode } from "lucide-react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function MyDashboard() {
  const { data: profile, isLoading: isProfileLoading } = useGetMyProfile({
    query: { enabled: true, queryKey: getGetMyProfileQueryKey() },
  });
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
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  // Active tab state — so RSVP switches tab
  const [eventsTab, setEventsTab] = useState<"upcoming" | "my-rsvps">("upcoming");

  // Show prompt if profile loaded and missing phone or has default name
  const profileLoaded = !isProfileLoading && !!profile;
  const needsPhone = profileLoaded && !profile!.phone;
  const needsName = profileLoaded && (!profile!.full_name || profile!.full_name === "New Member");
  const shouldPrompt = needsPhone || needsName;

  // Open prompt once when profile loads and is incomplete
  if (profileLoaded && shouldPrompt && !showProfilePrompt && promptPhone === "" && promptName === "") {
    setShowProfilePrompt(true);
    setPromptPhone(profile!.phone ?? "");
    setPromptName(profile!.full_name === "New Member" ? "" : (profile!.full_name ?? ""));
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
      await updateProfile.mutateAsync({ data: { phone: promptPhone.trim(), full_name: promptName.trim() } });
      queryClient.invalidateQueries({ queryKey: getGetMyProfileQueryKey() });
      toast({ title: "Profile updated" });
      setShowProfilePrompt(false);
    } catch {
      toast({ title: "Failed to save profile", variant: "destructive" });
    } finally {
      setIsSavingProfile(false);
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
            <Skeleton className="h-36 w-full max-w-md rounded-2xl" />
          ) : profile ? (
            <Card className="max-w-md border-primary/20 bg-card/50 backdrop-blur rounded-2xl">
              <CardHeader className="pb-2">
                <CardTitle className="text-2xl">{profile.full_name}</CardTitle>
                <CardDescription className="capitalize flex items-center gap-2 mt-1">
                  <span className="px-2.5 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-semibold">
                    {profile.role}
                  </span>
                  {profile.role === "visitor" && (
                    <Link href="/become-member" className="text-xs text-primary hover:underline">
                      Become a Member
                    </Link>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-sm text-muted-foreground space-y-1 mt-2">
                  {profile.phone ? (
                    <p>Phone: {profile.phone}</p>
                  ) : (
                    <button
                      onClick={() => setShowProfilePrompt(true)}
                      className="text-primary text-xs underline underline-offset-2"
                    >
                      + Add phone number
                    </button>
                  )}
                  {profile.email && <p>Email: {profile.email}</p>}
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="p-4 border border-destructive/20 bg-destructive/10 rounded-2xl text-destructive text-sm">
              Could not load profile.
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
      <Dialog open={showProfilePrompt} onOpenChange={(open) => { if (!open && !needsPhone && !needsName) setShowProfilePrompt(false); }}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>Complete your profile</DialogTitle>
            <DialogDescription>
              Your full name and phone number are required so leaders can identify you at sessions.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
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
          </div>
          <DialogFooter>
            <Button
              onClick={handleSaveProfile}
              disabled={isSavingProfile}
              className="w-full"
            >
              {isSavingProfile ? "Saving…" : "Save Profile"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
