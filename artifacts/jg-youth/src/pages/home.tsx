import { useState } from "react";
import { useUser } from "@clerk/react";
import { Link, useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useGetDashboardKpis, getGetDashboardKpisQueryKey, useListEvents, getListEventsQueryKey } from "@workspace/api-client-react";
import { format } from "date-fns";
import { Calendar as CalendarIcon, MapPin, Clock, UserPlus, LogIn, Users, UserCheck } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Redirect } from "wouter";

function PublicHome() {
  const [, setLocation] = useLocation();
  const [showLoginChoice, setShowLoginChoice] = useState(false);

  const { data: kpis, isLoading: isKpisLoading } = useGetDashboardKpis({
    query: { enabled: true, queryKey: getGetDashboardKpisQueryKey() },
  });
  const { data: events, isLoading: isEventsLoading } = useListEvents(
    { public_only: true, upcoming: true },
    { query: { enabled: true, queryKey: getListEventsQueryKey({ public_only: true, upcoming: true }) } },
  );

  return (
    <Layout>
      <div className="flex flex-col gap-16 pb-16">
        {/* Hero */}
        <section className="pt-16 pb-12 flex flex-col items-center text-center max-w-3xl mx-auto">
          <div className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold bg-primary/15 text-primary border-transparent mb-6">
            Jeremiah Generation AFM
          </div>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight mb-4">
<<<<<<< HEAD
            Don’t be the one we ask <span className="text-primary">‘where were you?’</span>
=======
            Don&apos;t be the one we ask{" "}
            <span className="text-primary">&apos;where were you?&apos;</span>
>>>>>>> 52162a5949a949c576f91a9d8e39deb1277f2ea5
          </h1>
          <p className="text-lg sm:text-xl text-muted-foreground mb-10 max-w-2xl">
            Register, show up, be part of it.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
            <Link href="/register">
              <Button size="lg" className="w-full sm:w-auto h-12 px-8 text-base">
                <UserPlus className="mr-2 h-5 w-5" />
                Register as First Timer
              </Button>
            </Link>

            <Button
              size="lg"
              variant="outline"
              className="w-full sm:w-auto h-12 px-8 text-base"
              onClick={() => setShowLoginChoice(true)}
            >
              <LogIn className="mr-2 h-5 w-5" />
              Login
            </Button>
          </div>
        </section>

        {/* KPIs */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="bg-card/50 backdrop-blur">
            <CardHeader className="pb-2">
              <CardDescription>Total Members</CardDescription>
            </CardHeader>
            <CardContent>
              {isKpisLoading ? (
                <Skeleton className="h-10 w-24" />
              ) : (
                <div className="text-4xl font-bold">{kpis?.total_members || 0}</div>
              )}
            </CardContent>
          </Card>
          <Card className="bg-card/50 backdrop-blur border-primary/20">
            <CardHeader className="pb-2">
              <CardDescription className="text-primary font-medium">Today's Visitors</CardDescription>
            </CardHeader>
            <CardContent>
              {isKpisLoading ? (
                <Skeleton className="h-10 w-24" />
              ) : (
                <div className="text-4xl font-bold text-primary">{kpis?.today_new_visitors || 0}</div>
              )}
            </CardContent>
          </Card>
          <Card className="bg-card/50 backdrop-blur">
            <CardHeader className="pb-2">
              <CardDescription>Today's Attendance</CardDescription>
            </CardHeader>
            <CardContent>
              {isKpisLoading ? (
                <Skeleton className="h-10 w-24" />
              ) : (
                <div className="text-4xl font-bold">{kpis?.today_attendance || 0}</div>
              )}
            </CardContent>
          </Card>
        </section>

        {/* Events */}
        <section>
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-2xl font-bold tracking-tight">Upcoming Public Events</h2>
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
                <Card key={event.id} className="flex flex-col">
                  <CardHeader>
                    <CardTitle className="line-clamp-1 text-xl">{event.title}</CardTitle>
                    <CardDescription className="flex items-center gap-1.5 mt-2 text-foreground/80">
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
              <div className="col-span-full py-12 text-center border rounded-xl border-dashed">
                <CalendarIcon className="h-10 w-10 mx-auto text-muted-foreground mb-4 opacity-50" />
                <h3 className="text-lg font-medium text-foreground mb-1">No upcoming events</h3>
                <p className="text-muted-foreground">Check back later for new events.</p>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Login choice dialog */}
      <Dialog open={showLoginChoice} onOpenChange={setShowLoginChoice}>
        <DialogContent className="rounded-2xl max-w-sm">
          <DialogHeader>
            <DialogTitle>Welcome back!</DialogTitle>
            <DialogDescription>
              Are you an existing member or visiting for the first time?
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 pt-2">
            <Button
              className="w-full h-12 rounded-xl bg-gradient-to-r from-[#0A84FF] to-[#32ADE6] hover:opacity-90 border-0"
              onClick={() => { setShowLoginChoice(false); setLocation("/sign-in"); }}
            >
              <UserCheck className="w-4 h-4 mr-2" />
              I'm a Member — Sign In
            </Button>
            <Button
              variant="outline"
              className="w-full h-12 rounded-xl"
              onClick={() => { setShowLoginChoice(false); setLocation("/register"); }}
            >
              <Users className="w-4 h-4 mr-2" />
              First Timer — Register
            </Button>
          </div>
        </DialogContent>
      </Dialog>
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
