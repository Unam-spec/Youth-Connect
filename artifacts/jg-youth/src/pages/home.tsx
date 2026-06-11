import { useUser } from "@clerk/react";
import { useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useGetDashboardKpis, getGetDashboardKpisQueryKey, useListEvents, getListEventsQueryKey } from "@workspace/api-client-react";
import { format } from "date-fns";
import { Calendar as CalendarIcon, MapPin, Clock, UserPlus, LogIn } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Redirect } from "wouter";

function PublicHome() {
  const [, setLocation] = useLocation();

  const { data: kpis, isLoading: isKpisLoading } = useGetDashboardKpis({
    query: { enabled: true, queryKey: getGetDashboardKpisQueryKey() },
  });
  const { data: events, isLoading: isEventsLoading } = useListEvents(
    { public_only: true, upcoming: true },
    { query: { enabled: true, queryKey: getListEventsQueryKey({ public_only: true, upcoming: true }) } },
  );

  return (
    <Layout>
      <div className="flex flex-col gap-20 pb-24">
        {/* Hero */}
        <section className="pt-16 md:pt-24 grid grid-cols-1 lg:grid-cols-12 gap-10 items-end">
          <div className="lg:col-span-9">
            <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary mb-8">
              <span className="h-px w-8 bg-primary" />
              Jeremiah Generation AFM
            </div>
            <h1 className="font-[family-name:var(--app-font-heading)] text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-semibold tracking-tight leading-[0.95] text-foreground">
              Don&apos;t be the one
              <br />
              we ask{" "}
              <span className="text-primary italic">&apos;where were you?&apos;</span>
            </h1>
          </div>
          <div className="lg:col-span-3 lg:pb-2">
            <p className="text-lg text-muted-foreground mb-7 max-w-sm">
              Register, show up, be part of it.
            </p>
            <div className="flex flex-col sm:flex-row lg:flex-col gap-3">
              <Button
                size="lg"
                className="w-full h-12 px-8 text-base"
                onClick={() => setLocation("/sign-up")}
              >
                <UserPlus className="mr-2 h-5 w-5" />
                Register as First Timer
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="w-full h-12 px-8 text-base"
                onClick={() => setLocation("/sign-in")}
              >
                <LogIn className="mr-2 h-5 w-5" />
                Login
              </Button>
              <Button
                size="lg"
                variant="ghost"
                className="w-full h-12 px-8 text-base"
                onClick={() => setLocation("/pin-signup")}
              >
                No email? Use a username
              </Button>
            </div>
          </div>
        </section>

        {/* KPIs */}
        <section className="border-t border-border pt-12">
          <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border">
            <div className="px-0 sm:px-8 first:pl-0 py-6 sm:py-0">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground mb-3">Total Members</p>
              {isKpisLoading ? (
                <Skeleton className="h-12 w-24" />
              ) : (
                <div className="font-[family-name:var(--app-font-heading)] text-5xl md:text-6xl font-semibold tracking-tight text-foreground">
                  {kpis?.total_members || 0}
                </div>
              )}
            </div>
            <div className="px-0 sm:px-8 py-6 sm:py-0">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary mb-3">Today&apos;s Visitors</p>
              {isKpisLoading ? (
                <Skeleton className="h-12 w-24" />
              ) : (
                <div className="font-[family-name:var(--app-font-heading)] text-5xl md:text-6xl font-semibold tracking-tight text-primary">
                  {kpis?.today_new_visitors || 0}
                </div>
              )}
            </div>
            <div className="px-0 sm:px-8 py-6 sm:py-0">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground mb-3">Today&apos;s Attendance</p>
              {isKpisLoading ? (
                <Skeleton className="h-12 w-24" />
              ) : (
                <div className="font-[family-name:var(--app-font-heading)] text-5xl md:text-6xl font-semibold tracking-tight text-foreground">
                  {kpis?.today_attendance || 0}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Events */}
        <section className="border-t border-border pt-12">
          <div className="flex items-end justify-between mb-10">
            <h2 className="font-[family-name:var(--app-font-heading)] text-3xl md:text-4xl font-semibold tracking-tight text-foreground">
              Upcoming Public Events
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {isEventsLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <Card key={i} className="overflow-hidden">
                  <CardHeader>
                    <Skeleton className="h-6 w-2/3 mb-2" />
                    <Skeleton className="h-4 w-1/3" />
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-4/5" />
                    </div>
                  </CardContent>
                </Card>
              ))
            ) : events && events.length > 0 ? (
              events.map((event) => (
                <Card key={event.id} className="flex flex-col overflow-hidden">
                  {event.poster_url && (
                    <img
                      src={event.poster_url}
                      alt={`${event.title} poster`}
                      className="w-full aspect-video object-cover"
                    />
                  )}
                  <CardHeader>
                    <CardTitle className="font-[family-name:var(--app-font-heading)] line-clamp-1 text-2xl font-semibold tracking-tight">
                      {event.title}
                    </CardTitle>
                    <CardDescription className="flex items-center gap-1.5 mt-2 text-primary font-medium">
                      <CalendarIcon className="h-4 w-4" />
                      {format(new Date(event.date), "EEEE, MMMM d, yyyy")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex-1">
                    <div className="space-y-3 text-sm text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 shrink-0" />
                        <span>{event.time}</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <MapPin className="h-4 w-4 shrink-0 mt-0.5" />
                        <span className="line-clamp-2">{event.location}</span>
                      </div>
                      {event.description && (
                        <p className="line-clamp-3 mt-4 text-foreground/70">{event.description}</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))
            ) : (
              <div className="col-span-full py-16 text-center border border-dashed border-border rounded-2xl bg-card">
                <CalendarIcon className="h-10 w-10 mx-auto text-muted-foreground mb-4 opacity-50" />
                <h3 className="font-[family-name:var(--app-font-heading)] text-xl font-semibold text-foreground mb-1">No upcoming events</h3>
                <p className="text-muted-foreground">Check back later for new events.</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </Layout>
  );
}

export default function Home() {
  const { user, isLoaded } = useUser();

  if (!isLoaded) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[50vh]">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </Layout>
    );
  }

  if (user) {
    return <Redirect to="/my" />;
  }

  return <PublicHome />;
}
