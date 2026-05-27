import { useState } from "react";
import { useUser } from "@clerk/react";
import { Link, useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useGetDashboardKpis, getGetDashboardKpisQueryKey, useListEvents, getListEventsQueryKey } from "@workspace/api-client-react";
import { format } from "date-fns";
import { Calendar as CalendarIcon, MapPin, Clock, ArrowRight, UserPlus, LogIn, ClipboardCheck, Users } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Redirect } from "wouter";

function PublicHome() {
  const { data: kpis, isLoading: isKpisLoading } = useGetDashboardKpis({ query: { enabled: true, queryKey: getGetDashboardKpisQueryKey() } });
  const { data: events, isLoading: isEventsLoading } = useListEvents({ public_only: true, upcoming: true }, { query: { enabled: true, queryKey: getListEventsQueryKey({ public_only: true, upcoming: true }) } });
  const [showLoginDialog, setShowLoginDialog] = useState(false);
  const [, setLocation] = useLocation();

  return (
    <Layout>
      <div className="flex flex-col gap-16 pb-16">
        <section className="pt-16 pb-12 flex flex-col items-center text-center max-w-3xl mx-auto">
          <div className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent bg-primary/15 text-primary hover:bg-primary/20 mb-6">
            Jeremiah Generation AFM
          </div>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight mb-4">
            Register. Show up. <span className="text-primary">Be counted.</span>
          </h1>
          <p className="text-lg sm:text-xl text-muted-foreground mb-10 max-w-2xl">
            Welcome to the JG Youth portal. Connect with the community, keep track of events, and manage your membership.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
            <Link href="/register">
              <Button size="lg" className="w-full sm:w-auto h-12 px-8 text-base">
                <UserPlus className="mr-2 h-5 w-5" />
                Register as First Timer
              </Button>
            </Link>
            <Link href="/checkin">
              <Button size="lg" variant="secondary" className="w-full sm:w-auto h-12 px-8 text-base">
                <ClipboardCheck className="mr-2 h-5 w-5" />
                Self Check-In
              </Button>
            </Link>
            <Button
              size="lg"
              variant="outline"
              className="w-full sm:w-auto h-12 px-8 text-base"
              onClick={() => setShowLoginDialog(true)}
            >
              <LogIn className="mr-2 h-5 w-5" />
              Login
            </Button>
          </div>
        </section>

        {/* Stats */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="bg-card/50 backdrop-blur">
            <CardHeader className="pb-2">
              <CardDescription>Community Members</CardDescription>
              <CardTitle className="text-4xl">
                {isKpisLoading ? <Skeleton className="h-9 w-16" /> : (kpis?.total_members ?? 0)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">Growing every Friday</p>
            </CardContent>
          </Card>
          <Card className="bg-card/50 backdrop-blur">
            <CardHeader className="pb-2">
              <CardDescription>Upcoming Events</CardDescription>
              <CardTitle className="text-4xl">
                {isKpisLoading ? <Skeleton className="h-9 w-16" /> : (kpis?.upcoming_events_count ?? 0)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">Don't miss out</p>
            </CardContent>
          </Card>
          <Card className="bg-card/50 backdrop-blur">
            <CardHeader className="pb-2">
              <CardDescription>This Week's Attendance</CardDescription>
              <CardTitle className="text-4xl">
                {isKpisLoading ? <Skeleton className="h-9 w-16" /> : (kpis?.today_attendance ?? 0)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">Checked in this session</p>
            </CardContent>
          </Card>
        </section>

        {/* Upcoming Events */}
        {!isEventsLoading && events && events.length > 0 && (
          <section>
            <h2 className="text-2xl font-bold tracking-tight mb-6">Upcoming Events</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {events.slice(0, 3).map((event) => (
                <Card key={event.id} className="flex flex-col bg-card/50 backdrop-blur">
                  <CardHeader>
                    <CardTitle className="line-clamp-1">{event.title}</CardTitle>
                    <CardDescription className="flex items-center gap-1.5 mt-1">
                      <CalendarIcon className="h-4 w-4" />
                      {format(new Date(event.date), "EEEE, MMM d")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex-1 space-y-2 text-sm text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4" />
                      <span>{event.time}</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <MapPin className="h-4 w-4 mt-0.5" />
                      <span className="line-clamp-1">{event.location}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Member / First-Timer login dialog */}
      <Dialog open={showLoginDialog} onOpenChange={setShowLoginDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl">Welcome back!</DialogTitle>
            <DialogDescription>
              Are you an existing member or a first-timer?
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 mt-2">
            <Button
              size="lg"
              className="w-full h-14 text-base"
              onClick={() => {
                setShowLoginDialog(false);
                setLocation("/sign-in");
              }}
            >
              <Users className="mr-2 h-5 w-5" />
              I'm a Member
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="w-full h-14 text-base"
              onClick={() => {
                setShowLoginDialog(false);
                setLocation("/register");
              }}
            >
              <UserPlus className="mr-2 h-5 w-5" />
              I'm a First-Timer
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}

export default function Home() {
  const { isLoaded, isSignedIn } = useUser();
  if (!isLoaded) return null;
  if (isSignedIn) return <Redirect to="/my" />;
  return <PublicHome />;
}
