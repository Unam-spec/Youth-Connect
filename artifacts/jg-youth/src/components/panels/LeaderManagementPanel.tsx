import { ShieldAlert, Users } from "lucide-react";
import { useListLeaders, getListLeadersQueryKey } from "@workspace/api-client-react";
import { DashCard, SectionTitle, SkeletonRows, SimpleTable, EmptyState } from "./shared";
import { Switch } from "@/components/ui/switch";

interface LeaderManagementPanelProps {
  handlePermissionChange: (profileId: string, key: string, value: boolean) => void;
  isUpdatingPermissions: boolean;
}

export function LeaderManagementPanel({
  handlePermissionChange,
  isUpdatingPermissions,
}: LeaderManagementPanelProps) {
  const { data: leaders, isLoading: isLeadersLoading } = useListLeaders({
    query: { queryKey: getListLeadersQueryKey() },
  });

  return (
    <DashCard>
      <SectionTitle
        title="Leader Permissions"
        icon={<ShieldAlert className="h-4 w-4 text-purple-400" />}
      />
      <p className="text-xs text-muted-foreground mb-4">
        Control what each leader can access on their dashboard.
      </p>
      {isLeadersLoading ? (
        <SkeletonRows count={3} />
      ) : leaders && leaders.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-border/50">
          <table className="w-full text-sm">
            <thead className="bg-muted/25 border-b border-border/50">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground uppercase tracking-wide">
                  Leader
                </th>
                <th className="px-4 py-2.5 text-center font-medium text-xs text-muted-foreground uppercase tracking-wide">
                  Members
                </th>
                <th className="px-4 py-2.5 text-center font-medium text-xs text-muted-foreground uppercase tracking-wide">
                  Attendance
                </th>
                <th className="px-4 py-2.5 text-center font-medium text-xs text-muted-foreground uppercase tracking-wide">
                  Events
                </th>
                <th className="px-4 py-2.5 text-center font-medium text-xs text-muted-foreground uppercase tracking-wide">
                  KPIs
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {leaders.map((l: any) => (
                <tr key={l.profile_id} className="hover:bg-muted/15 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-sm">{l.profile?.full_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {l.profile?.phone ?? "No phone"}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-center align-middle">
                    <Switch
                      checked={!!l.can_view_members}
                      disabled={isUpdatingPermissions || l.profile?.role === "super_admin"}
                      onCheckedChange={(val) =>
                        handlePermissionChange(l.profile_id, "can_view_members", val)
                      }
                      className="mx-auto"
                    />
                  </td>
                  <td className="px-4 py-3 text-center align-middle">
                    <Switch
                      checked={!!l.can_view_attendance}
                      disabled={isUpdatingPermissions || l.profile?.role === "super_admin"}
                      onCheckedChange={(val) =>
                        handlePermissionChange(l.profile_id, "can_view_attendance", val)
                      }
                      className="mx-auto"
                    />
                  </td>
                  <td className="px-4 py-3 text-center align-middle">
                    <Switch
                      checked={!!l.can_create_events}
                      disabled={isUpdatingPermissions || l.profile?.role === "super_admin"}
                      onCheckedChange={(val) =>
                        handlePermissionChange(l.profile_id, "can_create_events", val)
                      }
                      className="mx-auto"
                    />
                  </td>
                  <td className="px-4 py-3 text-center align-middle">
                    <Switch
                      checked={!!l.can_view_kpis}
                      disabled={isUpdatingPermissions || l.profile?.role === "super_admin"}
                      onCheckedChange={(val) =>
                        handlePermissionChange(l.profile_id, "can_view_kpis", val)
                      }
                      className="mx-auto"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState text="No leaders found." />
      )}
    </DashCard>
  );
}
