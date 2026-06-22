import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Users, Star, MapPin, User, Search, RefreshCw, AlertCircle, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useListProfiles, getListProfilesQueryKey, useMergeProfiles } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useDebouncedValue } from "@/lib/useDebounce";
import { DashCard, SectionTitle, SkeletonRows, RoleBadge, EmptyState } from "./shared";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { MoreVertical } from "lucide-react";
import { format } from "date-fns";

interface MemberDirectoryPanelProps {
  sessionRole: string;
  sessionProfileId: string;
  canManageMembers?: boolean;
  superAdminCount: number;
  openEditDialog: (profile: any) => void;
  mutateProfileRole: (action: "promote" | "demote", profileId: string) => void;
  setRoleConfirm: (confirm: { profile: any; targetRole: "leader" | "super_admin" }) => void;
  handlePermissionChange: (profileId: string, key: string, value: boolean) => void;
  setDeleteMemberId: (id: string) => void;
  setDeleteMemberName: (name: string) => void;
}

export function MemberDirectoryPanel({
  sessionRole,
  sessionProfileId,
  canManageMembers = false,
  superAdminCount,
  openEditDialog,
  mutateProfileRole,
  setRoleConfirm,
  handlePermissionChange,
  setDeleteMemberId,
  setDeleteMemberName,
}: MemberDirectoryPanelProps) {
  const [search, setSearch] = useState("");
  // Debounce so each keystroke doesn't fire a profiles request (300ms idle).
  const debouncedSearch = useDebouncedValue(search, 300);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const {
    data: profiles,
    isLoading: isProfilesLoading,
    isError: isProfilesError,
    refetch: refetchProfiles,
  } = useListProfiles(debouncedSearch ? { search: debouncedSearch } : undefined, {
    query: {
      queryKey: getListProfilesQueryKey(
        debouncedSearch ? { search: debouncedSearch } : undefined,
      ),
    },
  });

  const [demoteAlert, setDemoteAlert] = useState<{ isOpen: boolean; profile: any | null }>({ isOpen: false, profile: null });

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const mergeMutation = useMergeProfiles();
  const [viewAttendanceFor, setViewAttendanceFor] = useState<any | null>(null);
  const [attendanceRows, setAttendanceRows] = useState<any[]>([]);
  const [mergeKeep, setMergeKeep] = useState<any | null>(null);
  const [mergeFromId, setMergeFromId] = useState<string>("");

  return (
    <DashCard>
      {sessionRole === "super_admin" && (
        <div className="mb-5 flex items-center justify-between rounded-xl bg-primary/5 border border-primary/20 px-4 py-3">
          <div className="flex items-center gap-2">
            <Star className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold text-primary">
              Super Admin Slots: {superAdminCount} / 4
            </span>
          </div>
          <span className="text-xs text-primary/80 font-medium">Max 4 allowed</span>
        </div>
      )}
      
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SectionTitle
          title="Member Directory"
          icon={<Users className="h-4 w-4 text-primary" />}
        />
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or phone…"
            className="pl-9 bg-card"
          />
        </div>
      </div>

      {isProfilesLoading ? (
        <SkeletonRows count={4} />
      ) : isProfilesError ? (
        <div
          onClick={() => refetchProfiles()}
          className="flex flex-col items-center justify-center p-8 border border-dashed border-destructive/30 rounded-xl cursor-pointer hover:bg-muted/20 transition-colors"
        >
          <AlertCircle className="w-8 h-8 text-destructive/60 mb-2" />
          <p className="text-sm text-destructive font-medium">Could not load members — tap to retry</p>
        </div>
      ) : profiles && profiles.length > 0 ? (
        <div className="space-y-2.5">
          {profiles.map((profile: any) => {
            const isSelf = profile.id === sessionProfileId || profile.clerk_id === sessionProfileId;
            const targetRole = profile.role;
            
            let showMenu = false;
            if (!isSelf) {
              if (sessionRole === 'super_admin') {
                showMenu = true;
              } else if (sessionRole === 'leader' && canManageMembers && targetRole === 'member') {
                showMenu = true;
              }
            }

            return (
              <div
                key={profile.id}
                className="flex items-center justify-between rounded-xl border border-border bg-card p-4 hover:border-primary/30 hover:bg-muted/40 transition-all"
              >
                <div className="flex items-center gap-4">
                  <div 
                    onClick={() => {
                      if (profile.avatar_url && !profile.avatar_url.startsWith("gradient:")) {
                        setLightboxImage(profile.avatar_url);
                      }
                    }}
                    className={`h-12 w-12 rounded-full overflow-hidden flex items-center justify-center shrink-0 text-lg font-bold border ${profile.avatar_url ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''} ${
                    targetRole === "super_admin" ? "bg-primary/10 text-primary border-primary/20" :
                    targetRole === "leader" ? "bg-blue-600/10 text-blue-700 border-blue-600/20" :
                    targetRole === "member" ? "bg-muted text-foreground border-border" :
                    "bg-muted text-muted-foreground border-border"
                  }`}>
                    {profile.avatar_url ? (
                      profile.avatar_url.startsWith("gradient:") ? (
                        <div
                          className="h-full w-full"
                          style={{ background: profile.avatar_url.replace("gradient:", "") }}
                        />
                      ) : (
                        <img
                          src={profile.avatar_url}
                          alt={profile.full_name}
                          className="h-full w-full object-cover"
                        />
                      )
                    ) : (
                      profile.full_name?.split(" ").map((n: string) => n[0]).join("").substring(0, 2).toUpperCase() || "?"
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-base leading-tight">{profile.full_name}</p>
                      <RoleBadge role={targetRole} />
                      {(!profile.full_name || profile.full_name === "New Member" || !profile.phone) && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-amber-500/15 text-amber-500 border border-amber-500/25">
                          Incomplete
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {profile.created_at ? format(new Date(profile.created_at), "'Joined' MMM yyyy") : "Join date unknown"}
                    </p>
                  </div>
                </div>

                {showMenu && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem onClick={() => openEditDialog(profile)}>
                        View Profile
                      </DropdownMenuItem>

                      {sessionRole === 'super_admin' && (
                        <>
                          <DropdownMenuItem
                            onClick={async () => {
                              setViewAttendanceFor(profile);
                              setAttendanceRows([]);
                              const sessionStr = localStorage.getItem("jg_leader_session") ?? "";
                              const r = await fetch(`/api/attendance?profile_id=${profile.id}`, {
                                headers: { "x-leader-session": sessionStr },
                              });
                              if (r.ok) setAttendanceRows(await r.json());
                            }}
                          >
                            View Check-ins
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => { setMergeKeep(profile); setMergeFromId(""); }}>
                            Merge Duplicate Into This
                          </DropdownMenuItem>
                        </>
                      )}

                      {sessionRole === 'super_admin' && targetRole === 'member' && (
                        <>
                          <DropdownMenuItem onClick={() => setRoleConfirm({ profile, targetRole: "leader" })}>
                            Promote to Leader
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setRoleConfirm({ profile, targetRole: "super_admin" })}>
                            Make Super Admin
                          </DropdownMenuItem>
                        </>
                      )}

                      {sessionRole === 'super_admin' && targetRole === 'leader' && (
                        <>
                          <DropdownMenuItem onClick={() => setDemoteAlert({ isOpen: true, profile })}>
                            Demote to Member
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setRoleConfirm({ profile, targetRole: "super_admin" })}>
                            Make Super Admin
                          </DropdownMenuItem>
                        </>
                      )}

                      {sessionRole === 'leader' && targetRole === 'member' && (
                        <DropdownMenuItem onClick={() => setRoleConfirm({ profile, targetRole: "leader" })}>
                          Promote to Leader
                        </DropdownMenuItem>
                      )}

                      <DropdownMenuSeparator />
                      
                      <DropdownMenuItem 
                        className="text-red-600 focus:text-red-600 focus:bg-red-50 dark:focus:bg-red-950/50"
                        onClick={() => {
                          setDeleteMemberId(profile.id);
                          setDeleteMemberName(profile.full_name || "Unknown");
                        }}
                      >
                        Remove Member
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState text="No members found matching your search." />
      )}
      <Dialog open={!!lightboxImage} onOpenChange={(open) => !open && setLightboxImage(null)}>
        <DialogContent className="max-w-2xl bg-transparent border-0 shadow-none p-0 flex items-center justify-center">
          {lightboxImage && (
            <img src={lightboxImage} alt="Profile" className="max-h-[85vh] max-w-full rounded-xl object-contain shadow-2xl" />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewAttendanceFor} onOpenChange={(o) => !o && setViewAttendanceFor(null)}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <h3 className="font-bold text-lg mb-1">{viewAttendanceFor?.full_name}</h3>
          <p className="text-xs text-muted-foreground mb-4">Check-in history</p>
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {attendanceRows.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No check-ins recorded.</p>
            ) : (
              attendanceRows.map((a) => (
                <div key={a.id} className="flex items-center justify-between rounded-xl border border-border/50 px-3 py-2">
                  <span className="text-sm">{a.session_date ? format(new Date(a.session_date), "MMM d, yyyy") : "Session"}</span>
                  <span className="text-[10px] uppercase font-semibold text-muted-foreground">{a.check_in_method}</span>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!mergeKeep} onOpenChange={(o) => !o && setMergeKeep(null)}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <h3 className="font-bold text-lg mb-1">Merge duplicate</h3>
          <p className="text-xs text-muted-foreground mb-4">
            Keep <strong>{mergeKeep?.full_name}</strong> and merge another profile's history into it. The other profile is deleted. This cannot be undone.
          </p>
          <select
            value={mergeFromId}
            onChange={(e) => setMergeFromId(e.target.value)}
            className="w-full bg-card border border-border rounded-xl h-10 px-3 text-sm mb-4"
          >
            <option value="">Select profile to merge from…</option>
            {(profiles ?? []).filter((p: any) => p.id !== mergeKeep?.id).map((p: any) => (
              <option key={p.id} value={p.id}>{p.full_name} {p.phone ? `(${p.phone})` : ""}</option>
            ))}
          </select>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setMergeKeep(null)}>Cancel</Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white border-0"
              disabled={!mergeFromId || mergeMutation.isPending}
              onClick={() => {
                if (!mergeKeep || !mergeFromId) return;
                mergeMutation.mutate(
                  { data: { keepId: mergeKeep.id, mergeId: mergeFromId } },
                  {
                    onSuccess: () => {
                      toast({ title: "Profiles merged" });
                      queryClient.invalidateQueries({ queryKey: getListProfilesQueryKey() });
                      setMergeKeep(null);
                    },
                    onError: () => toast({ title: "Merge failed", variant: "destructive" }),
                  },
                );
              }}
            >
              {mergeMutation.isPending ? "Merging…" : "Merge"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={demoteAlert.isOpen}
        onOpenChange={(isOpen) => setDemoteAlert(prev => ({ ...prev, isOpen }))}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Demote {demoteAlert.profile?.full_name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This user will lose their leader privileges and be reverted to a standard member. They will no longer be able to manage events or access the leader dashboard.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              className="bg-red-600 hover:bg-red-700 text-white border-0"
              onClick={() => {
                if (demoteAlert.profile) {
                  mutateProfileRole("demote", demoteAlert.profile.id);
                }
              }}
            >
              Demote
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashCard>
  );
}
