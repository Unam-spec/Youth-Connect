import { useState } from "react";
import { format } from "date-fns";
import { Calendar, Trash2, MapPin, Users, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useListEvents, getListEventsQueryKey } from "@workspace/api-client-react";
import { DashCard, SectionTitle, SkeletonRows, EmptyState } from "./shared";

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
  const { data: events, isLoading: isEventsLoading } = useListEvents(undefined, {
    query: { queryKey: getListEventsQueryKey() },
  });

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
