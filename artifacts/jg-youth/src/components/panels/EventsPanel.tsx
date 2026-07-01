import { useState, useEffect } from "react";
import { format } from "date-fns";
import { Calendar, Trash2, MapPin, Users, Globe, ImagePlus, X } from "lucide-react";
import { useAuth } from "@clerk/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useListEvents, getListEventsQueryKey } from "@workspace/api-client-react";
import { DashCard, SectionTitle, SkeletonRows, EmptyState } from "./shared";

interface GenderCounts {
  male: number;
  female: number;
  other: number;
  unspecified: number;
  total: number;
}

interface EventsPanelProps {
  sessionRole: string;
  canCreateEvents: boolean;
  eventForm: any;
  setEventForm: (form: any) => void;
  handleCreateEvent: () => void;
  setDeleteEventId: (id: string) => void;
  setDeleteEventName: (name: string) => void;
}

export function EventsPanel({
  sessionRole,
  canCreateEvents,
  eventForm,
  setEventForm,
  handleCreateEvent,
  setDeleteEventId,
  setDeleteEventName,
}: EventsPanelProps) {
  const { toast } = useToast();
  const { getToken } = useAuth();
  const { data: events, isLoading: isEventsLoading } = useListEvents(undefined, {
    query: { queryKey: getListEventsQueryKey() },
  });

  // Member counts per gender, for the "who will this reach?" preview.
  const [genderCounts, setGenderCounts] = useState<GenderCounts | null>(null);
  useEffect(() => {
    if (!canCreateEvents) return;
    (async () => {
      try {
        const headers: Record<string, string> = {};
        try {
          const t = await getToken();
          if (t) headers["Authorization"] = `Bearer ${t}`;
        } catch {}
        try {
          const s = localStorage.getItem("jg_leader_session");
          if (s) {
            const p = JSON.parse(s);
            if (Date.now() < p.expires_at) headers["x-leader-session"] = s;
          }
        } catch {}
        const apiBase = import.meta.env.VITE_API_URL || "";
        const res = await fetch(`${apiBase}/api/dashboard/gender-counts`, { headers });
        if (res.ok) setGenderCounts(await res.json());
      } catch {}
    })();
  }, [canCreateEvents, getToken]);

  const handlePosterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast({
        title: "Image too large",
        description: "Please choose a poster under 2MB.",
        variant: "destructive",
      });
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      setEventForm({ ...eventForm, poster_url: reader.result as string });
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-6">
      <DashCard>
        <SectionTitle
          title="Upcoming Events"
          icon={<Calendar className="h-4 w-4 text-primary" />}
        />
        {isEventsLoading ? (
          <SkeletonRows count={3} />
        ) : events && events.length > 0 ? (
          <div className="space-y-3">
            {events.map((event: any) => (
              <div
                key={event.id}
                className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/30 hover:bg-muted/40"
              >
                {event.poster_url && (
                  <img
                    src={event.poster_url}
                    alt={`${event.title} poster`}
                    className="mb-3 w-full max-h-56 rounded-lg object-cover border border-border"
                  />
                )}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h4 className="font-semibold text-base text-foreground flex items-center gap-2">
                      {event.title}
                      {event.is_public ? (
                        <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/20 py-0 h-4">
                          <Globe className="w-2.5 h-2.5 mr-1" /> Public
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] bg-muted text-muted-foreground border-border py-0 h-4">
                          Internal
                        </Badge>
                      )}
                      {event.target_gender && (
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px] py-0 h-4 border",
                            event.target_gender === "male"
                              ? "bg-blue-500/10 text-blue-500 border-blue-500/20"
                              : "bg-rose-500/10 text-rose-500 border-rose-500/20",
                          )}
                        >
                          {event.target_gender === "male" ? "Guys only" : "Girls only"}
                        </Badge>
                      )}
                    </h4>
                    {event.description && (
                      <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                        {event.description}
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1.5 font-medium text-primary">
                        <Calendar className="h-3.5 w-3.5" />
                        {format(new Date(event.date), "EEE, d MMM yyyy")} • {event.time}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5" />
                        {event.location}
                      </span>
                      {(event.age_min || event.age_max) && (
                        <span className="flex items-center gap-1.5">
                          <Users className="h-3.5 w-3.5" />
                          Ages: {event.age_min || 0} - {event.age_max || "100+"}
                        </span>
                      )}
                    </div>
                  </div>
                  {sessionRole === "super_admin" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setDeleteEventId(event.id);
                        setDeleteEventName(event.title);
                      }}
                      className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0 h-8"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState text="No upcoming events scheduled." />
        )}
      </DashCard>

      {canCreateEvents && (
        <DashCard>
          <SectionTitle
            title="Create Event"
            icon={<Calendar className="h-4 w-4 text-primary" />}
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-4">
            <div className="space-y-2">
              <Label htmlFor="event-title" className="text-xs text-muted-foreground">Event Title *</Label>
              <Input
                id="event-title"
                value={eventForm.title}
                onChange={(e) => setEventForm({ ...eventForm, title: e.target.value })}
                placeholder="Youth Night Live"
                className="bg-card border-border"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="event-date" className="text-xs text-muted-foreground">Date *</Label>
                <Input
                  id="event-date"
                  type="date"
                  value={eventForm.date}
                  onChange={(e) => setEventForm({ ...eventForm, date: e.target.value })}
                  className="bg-card border-border"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="event-time" className="text-xs text-muted-foreground">Time *</Label>
                <Input
                  id="event-time"
                  type="time"
                  value={eventForm.time}
                  onChange={(e) => setEventForm({ ...eventForm, time: e.target.value })}
                  className="bg-card border-border"
                />
              </div>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="event-desc" className="text-xs text-muted-foreground">Description</Label>
              <Textarea
                id="event-desc"
                value={eventForm.description}
                onChange={(e) => setEventForm({ ...eventForm, description: e.target.value })}
                placeholder="What's happening at this event?"
                className="bg-card border-border resize-none h-20"
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="event-location" className="text-xs text-muted-foreground">Location *</Label>
              <Input
                id="event-location"
                value={eventForm.location}
                onChange={(e) => setEventForm({ ...eventForm, location: e.target.value })}
                placeholder="Main Auditorium"
                className="bg-card border-border"
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label className="text-xs text-muted-foreground">Event Poster</Label>
              <p className="text-[11px] text-muted-foreground -mt-1">
                Shown on the landing page and members' events. Optional, max 2MB.
              </p>
              {eventForm.poster_url ? (
                <div className="relative w-full overflow-hidden rounded-xl border border-border">
                  <img
                    src={eventForm.poster_url}
                    alt="Event poster preview"
                    className="w-full max-h-56 object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => setEventForm({ ...eventForm, poster_url: "" })}
                    className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                    aria-label="Remove poster"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <label
                  htmlFor="event-poster"
                  className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card px-4 py-8 text-center text-muted-foreground transition-colors hover:border-primary/40 hover:bg-muted/40"
                >
                  <ImagePlus className="h-6 w-6 text-primary/70" />
                  <span className="text-sm font-medium">Upload a poster image</span>
                  <span className="text-[11px]">PNG or JPG, up to 2MB</span>
                </label>
              )}
              <input
                id="event-poster"
                type="file"
                accept="image/*"
                onChange={handlePosterChange}
                className="hidden"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="event-age-min" className="text-xs text-muted-foreground">Min Age</Label>
                <Input
                  id="event-age-min"
                  type="number"
                  value={eventForm.age_min}
                  onChange={(e) => setEventForm({ ...eventForm, age_min: e.target.value })}
                  placeholder="16"
                  className="bg-card border-border"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="event-age-max" className="text-xs text-muted-foreground">Max Age</Label>
                <Input
                  id="event-age-max"
                  type="number"
                  value={eventForm.age_max}
                  onChange={(e) => setEventForm({ ...eventForm, age_max: e.target.value })}
                  placeholder="30"
                  className="bg-card border-border"
                />
              </div>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label className="text-xs text-muted-foreground">Who is this for?</Label>
              <div className="flex gap-2">
                {[
                  { value: "", label: "Everyone" },
                  { value: "male", label: "Guys only" },
                  { value: "female", label: "Girls only" },
                ].map((opt) => (
                  <button
                    key={opt.value || "all"}
                    type="button"
                    onClick={() => setEventForm({ ...eventForm, target_gender: opt.value })}
                    className={cn(
                      "flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                      (eventForm.target_gender || "") === opt.value
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-card text-muted-foreground hover:border-primary/40",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {eventForm.target_gender && genderCounts && (
                <p className="text-[11px] text-muted-foreground">
                  Reaches{" "}
                  <span className="font-semibold text-foreground">
                    {eventForm.target_gender === "male" ? genderCounts.male : genderCounts.female}
                  </span>{" "}
                  of {genderCounts.total} members
                  {genderCounts.unspecified > 0 &&
                    ` · ${genderCounts.unspecified} have no gender set (won't receive it)`}
                  . Leaders are always notified.
                </p>
              )}
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl border border-border bg-muted/40 md:col-span-2">
              <div className="space-y-0.5">
                <Label className="text-sm">Public Event</Label>
                <p className="text-xs text-muted-foreground">
                  Allow non-members to RSVP and see this event.
                </p>
              </div>
              <Switch
                checked={eventForm.is_public}
                onCheckedChange={(checked) => setEventForm({ ...eventForm, is_public: checked })}
              />
            </div>
            <div className="md:col-span-2 pt-2">
              <Button
                onClick={handleCreateEvent}
                className="w-full sm:w-auto bg-primary hover:bg-primary/90 text-primary-foreground border-0 px-8"
              >
                Schedule Event
              </Button>
            </div>
          </div>
        </DashCard>
      )}
    </div>
  );
}
