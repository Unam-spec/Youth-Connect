import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getLeaderSession } from "@/lib/auth";
import { Redirect } from "wouter";
import { useGetDashboardKpis, getGetDashboardKpisQueryKey, useListAttendance, useListEvents, useListProfiles, useListMembershipRequests, useApproveMembershipRequest, useRejectMembershipRequest, useGetTodayAttendance } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { Users, UserPlus, CheckCircle, Calendar, ShieldAlert } from "lucide-react";

export default function Dashboard() {
  const session = getLeaderSession();

  if (!session) {
    return <Redirect to="/leader-login" />;
  }

  const { data: kpis, isLoading: isKpisLoading } = useGetDashboardKpis({ query: { enabled: true, queryKey: getGetDashboardKpisQueryKey() } });

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Leader Dashboard</h1>
          <p className="text-muted-foreground mt-1">Welcome back. Here's what's happening today.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Members</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {isKpisLoading ? <Skeleton className="h-7 w-16" /> : <div className="text-2xl font-bold">{kpis?.total_members || 0}</div>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Today's Attendance</CardTitle>
              <CheckCircle className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              {isKpisLoading ? <Skeleton className="h-7 w-16" /> : <div className="text-2xl font-bold text-primary">{kpis?.today_attendance || 0}</div>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">New Visitors Today</CardTitle>
              <UserPlus className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {isKpisLoading ? <Skeleton className="h-7 w-16" /> : <div className="text-2xl font-bold">{kpis?.today_new_visitors || 0}</div>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Upcoming Events</CardTitle>
              <Calendar className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {isKpisLoading ? <Skeleton className="h-7 w-16" /> : <div className="text-2xl font-bold">{kpis?.upcoming_events_count || 0}</div>}
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="attendance" className="mt-8">
          <TabsList className="grid grid-cols-2 md:grid-cols-5 h-auto md:h-10 gap-2 md:gap-0">
            <TabsTrigger value="attendance">Today</TabsTrigger>
            <TabsTrigger value="members">Members</TabsTrigger>
            <TabsTrigger value="events">Events</TabsTrigger>
            <TabsTrigger value="requests">Requests</TabsTrigger>
            {session.role === "super_admin" && <TabsTrigger value="leaders">Leaders</TabsTrigger>}
          </TabsList>
          
          <TabsContent value="attendance" className="p-4 border rounded-xl mt-4 bg-card">
            <h3 className="text-lg font-semibold mb-4">Today's Check-ins</h3>
            <p className="text-muted-foreground text-sm">Implementation coming in next phase.</p>
          </TabsContent>
          
          <TabsContent value="members" className="p-4 border rounded-xl mt-4 bg-card">
            <h3 className="text-lg font-semibold mb-4">Member Directory</h3>
             <p className="text-muted-foreground text-sm">Implementation coming in next phase.</p>
          </TabsContent>
          
          <TabsContent value="events" className="p-4 border rounded-xl mt-4 bg-card">
            <h3 className="text-lg font-semibold mb-4">Events Management</h3>
            <p className="text-muted-foreground text-sm">Implementation coming in next phase.</p>
          </TabsContent>

          <TabsContent value="requests" className="p-4 border rounded-xl mt-4 bg-card">
            <h3 className="text-lg font-semibold mb-4">Membership Requests</h3>
             <p className="text-muted-foreground text-sm">Implementation coming in next phase.</p>
          </TabsContent>

          {session.role === "super_admin" && (
            <TabsContent value="leaders" className="p-4 border rounded-xl mt-4 bg-card">
              <h3 className="text-lg font-semibold mb-4">Leader Management</h3>
               <p className="text-muted-foreground text-sm">Implementation coming in next phase.</p>
            </TabsContent>
          )}
        </Tabs>
      </div>
    </Layout>
  );
}
