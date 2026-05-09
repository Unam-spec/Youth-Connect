import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useGetMyProfile, getGetMyProfileQueryKey, useListEvents, getListEventsQueryKey, useListMyRsvps, getListMyRsvpsQueryKey, useUpsertRsvp, getGetEventStatsQueryKey } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { CalendarIcon, Clock, MapPin, CheckCircle, XCircle, HelpCircle } from "lucide-react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function MyDashboard() {
  const { data: profile, isLoading: isProfileLoading } = useGetMyProfile({ query: { enabled: true, queryKey: getGetMyProfileQueryKey() } });
  const { data: events, isLoading: isEventsLoading } = useListEvents({ upcoming: true }, { query: { enabled: true, queryKey: getListEventsQueryKey({ upcoming: true }) } });
  const { data: rsvps, isLoading: isRsvpsLoading } = useListMyRsvps({ query: { enabled: !!profile, queryKey: getListMyRsvpsQueryKey() } });
  
  const upsertRsvp = useUpsertRsvp();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleRsvp = (eventId: string, status: "going" | "not_going" | "maybe") => {
    upsertRsvp.mutate(
      { eventId, data: { status } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMyRsvpsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetEventStatsQueryKey(eventId) });
          toast({ title: "RSVP updated" });
        },
        onError: () => {
          toast({ title: "Failed to update RSVP", variant: "destructive" });
        }
      }
    );
  };

  const getRsvpStatus = (eventId: string) => {
    return rsvps?.find(r => r.event_id === eventId)?.status;
  };

  return (
    <Layout>
      <div className="space-y-8">
        <section>
          {isProfileLoading ? (
            <Skeleton className="h-32 w-full max-w-md rounded-xl" />
          ) : profile ? (
            <Card className="max-w-md border-primary/20 bg-card/50 backdrop-blur">
              <CardHeader className="pb-2">
                <CardTitle className="text-2xl">{profile.full_name}</CardTitle>
                <CardDescription className="capitalize flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-semibold">
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
                  <p>Phone: {profile.phone || "Not provided"}</p>
                  {profile.email && <p>Email: {profile.email}</p>}
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="p-4 border border-destructive/20 bg-destructive/10 rounded-lg text-destructive">
              Could not load profile.
            </div>
          )}
        </section>

        <section>
          <Tabs defaultValue="upcoming">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold tracking-tight">Events</h2>
              <TabsList>
                <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
                <TabsTrigger value="my-rsvps">My RSVPs</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="upcoming" className="mt-0">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {isEventsLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-64 w-full rounded-xl" />
                  ))
                ) : events && events.length > 0 ? (
                  events.map((event) => {
                    const status = getRsvpStatus(event.id);
                    return (
                      <Card key={event.id} className="flex flex-col">
                        <CardHeader>
                          <CardTitle className="line-clamp-1">{event.title}</CardTitle>
                          <CardDescription className="flex items-center gap-1.5 mt-2">
                            <CalendarIcon className="h-4 w-4" />
                            {format(new Date(event.date), "EEEE, MMM d")}
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="flex-1">
                          <div className="space-y-2 text-sm text-muted-foreground mb-4">
                            <div className="flex items-center gap-2">
                              <Clock className="h-4 w-4" />
                              <span>{event.time}</span>
                            </div>
                            <div className="flex items-start gap-2">
                              <MapPin className="h-4 w-4 mt-0.5" />
                              <span className="line-clamp-1">{event.location}</span>
                            </div>
                          </div>
                          <div className="flex gap-2 mt-auto">
                            <Button 
                              size="sm" 
                              variant={status === "going" ? "default" : "outline"}
                              className="flex-1"
                              onClick={() => handleRsvp(event.id, "going")}
                            >
                              <CheckCircle className="w-4 h-4 mr-1.5" /> Going
                            </Button>
                            <Button 
                              size="sm" 
                              variant={status === "not_going" ? "destructive" : "outline"}
                              className="flex-1"
                              onClick={() => handleRsvp(event.id, "not_going")}
                            >
                              <XCircle className="w-4 h-4 mr-1.5" /> No
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })
                ) : (
                  <p className="text-muted-foreground">No upcoming events.</p>
                )}
              </div>
            </TabsContent>

            <TabsContent value="my-rsvps" className="mt-0">
              <div className="space-y-4">
                {isRsvpsLoading ? (
                  <Skeleton className="h-20 w-full rounded-lg" />
                ) : rsvps && rsvps.length > 0 ? (
                  rsvps.map((rsvp) => (
                    <Card key={rsvp.id}>
                      <CardContent className="p-4 flex items-center justify-between">
                        <div>
                          <p className="font-semibold">{rsvp.event?.title || "Unknown Event"}</p>
                          <p className="text-sm text-muted-foreground">
                            {rsvp.event ? format(new Date(rsvp.event.date), "MMM d, yyyy") : ""}
                          </p>
                        </div>
                        <div className={`px-3 py-1 rounded-full text-xs font-semibold
                          ${rsvp.status === 'going' ? 'bg-green-500/10 text-green-500' : 
                            rsvp.status === 'not_going' ? 'bg-red-500/10 text-red-500' : 'bg-yellow-500/10 text-yellow-500'}`}>
                          {rsvp.status.replace("_", " ").toUpperCase()}
                        </div>
                      </CardContent>
                    </Card>
                  ))
                ) : (
                  <p className="text-muted-foreground">You haven't RSVP'd to any events yet.</p>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </section>
      </div>
    </Layout>
  );
}
