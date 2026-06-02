import { Calendar, Users } from "lucide-react";
import { useListEvents, getListEventsQueryKey } from "@workspace/api-client-react";
import { DashCard, SectionTitle, SkeletonRows, SimpleTable, EmptyState } from "./shared";

interface RSVPPanelProps {
  selectedEventId: string | null;
  setSelectedEventId: (id: string) => void;
  rsvps: any[];
  isRsvpsLoading: boolean;
}

export function RSVPPanel({
  selectedEventId,
  setSelectedEventId,
  rsvps,
  isRsvpsLoading,
}: RSVPPanelProps) {
  const { data: events, isLoading: isEventsLoading } = useListEvents(undefined, {
    query: { queryKey: getListEventsQueryKey() },
  });

  return (
    <DashCard>
      <SectionTitle
        title="Event RSVPs"
        icon={<Users className="h-4 w-4 text-primary" />}
      />
      {isEventsLoading ? (
        <SkeletonRows count={1} />
      ) : events && events.length > 0 ? (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <select
              value={selectedEventId || ""}
              onChange={(e) => setSelectedEventId(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:max-w-xs"
            >
              {events
                .slice()
                .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())
                .map((event: any) => (
                  <option key={event.id} value={event.id}>
                    {event.title} ({new Date(event.date).toLocaleDateString()})
                  </option>
                ))}
            </select>
          </div>
          {isRsvpsLoading ? (
            <SkeletonRows />
          ) : rsvps.length > 0 ? (
            <>
              <div className="text-sm font-medium mb-2 text-primary">
                Total RSVPs: {rsvps.length}
              </div>
              <SimpleTable
                headers={["Name", "Role", "Phone", "Age"]}
                rows={rsvps.map((r) => [
                  r.profile?.full_name ?? "Unknown",
                  r.profile?.role ?? "-",
                  r.profile?.phone ?? "-",
                  r.profile?.age?.toString() ?? "-",
                ])}
              />
            </>
          ) : (
            <EmptyState text="No RSVPs for this event yet." />
          )}
        </div>
      ) : (
        <EmptyState text="No events found. Create an event first to see RSVPs." />
      )}
    </DashCard>
  );
}
