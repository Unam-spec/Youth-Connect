import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Users, Star, MapPin, User, Search, RefreshCw, AlertCircle, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useListProfiles, getListProfilesQueryKey } from "@workspace/api-client-react";
import { DashCard, SectionTitle, SkeletonRows, RoleBadge, EmptyState } from "./shared";

interface MemberDirectoryPanelProps {
  sessionRole: string;
  superAdminCount: number;
  openEditDialog: (profile: any) => void;
  mutateProfileRole: (action: "promote" | "revoke", profileId: string) => void;
  setRoleConfirm: (confirm: { profile: any; targetRole: "leader" | "super_admin" }) => void;
  handlePermissionChange: (profileId: string, key: string, value: boolean) => void;
  setDeleteMemberId: (id: string) => void;
  setDeleteMemberName: (name: string) => void;
}

export function MemberDirectoryPanel({
  sessionRole,
  superAdminCount,
  openEditDialog,
  mutateProfileRole,
  setRoleConfirm,
  handlePermissionChange,
  setDeleteMemberId,
  setDeleteMemberName,
}: MemberDirectoryPanelProps) {
  const [search, setSearch] = useState("");
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const {
    data: profiles,
    isLoading: isProfilesLoading,
    isError: isProfilesError,
    refetch: refetchProfiles,
  } = useListProfiles(search ? { search } : undefined, {
    query: {
      queryKey: getListProfilesQueryKey(search ? { search } : undefined),
    },
  });

  return (
    <DashCard>
      {sessionRole === "super_admin" && (
        <div className="mb-5 flex items-center justify-between rounded-xl bg-purple-500/10 border border-purple-500/20 px-4 py-3">
          <div className="flex items-center gap-2">
            <Star className="h-4 w-4 text-purple-400" />
            <span className="text-sm font-semibold text-purple-300">
              Super Admin Slots: {superAdminCount} / 4
            </span>
          </div>
          <span className="text-xs text-purple-400 font-medium">Max 4 allowed</span>
        </div>
      )}
      
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SectionTitle
          title="Member Directory"
          icon={<Users className="h-4 w-4 text-teal-400" />}
        />
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or phone…"
            className="pl-9 border-teal-500/20 focus-visible:ring-teal-500/40 bg-card/50"
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
          {profiles.map((profile: any) => (
            <div
              key={profile.id}
              className="flex flex-col gap-3 rounded-xl border border-border/50 bg-card/30 p-4 sm:flex-row sm:items-start sm:justify-between hover:border-teal-500/30 hover:bg-teal-500/3 transition-all"
            >
              <div className="flex items-start gap-3">
                <div
                  onClick={() => {
                    if (profile.avatar_url && !profile.avatar_url.startsWith("gradient:")) {
                      setLightboxImage(profile.avatar_url);
                    }
                  }}
                  className={`h-10 w-10 rounded-full overflow-hidden flex items-center justify-center shrink-0 text-sm font-bold cursor-pointer hover:opacity-80 transition-opacity ${
                    profile.role === "super_admin"
                      ? "bg-purple-500/20 text-purple-300"
                      : profile.role === "leader"
                        ? "bg-blue-500/20 text-blue-300"
                        : profile.role === "member"
                          ? "bg-teal-500/20 text-teal-300"
                          : "bg-muted text-muted-foreground"
                  }`}
                >
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
                    profile.full_name?.charAt(0)?.toUpperCase() ?? "?"
                  )}
                </div>
                <div>
                  <p className="font-semibold text-sm leading-tight">{profile.full_name}</p>
                  <div className="text-xs text-muted-foreground mt-0.5 flex flex-col gap-0.5">
                    <span>{profile.phone || "No phone"}</span>
                    {profile.school && (
                      <span className="text-[10px] text-teal-400 font-medium flex items-center gap-1">
                        School: {profile.school}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex items-center gap-1.5">
                    <RoleBadge role={profile.role} />
                    {profile.whatsapp_opt_in ? (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        WA <Check className="w-2.5 h-2.5 ml-0.5" />
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-slate-500/10 text-slate-450 border border-slate-500/10">
                        WA <X className="w-2.5 h-2.5 ml-0.5" />
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-2 flex-wrap sm:flex-col sm:items-end sm:shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openEditDialog(profile)}
                  className="h-7 text-xs px-3 border-teal-500/20 hover:border-teal-500 hover:text-teal-300 transition-colors"
                >
                  Edit Details
                </Button>
                {sessionRole === "super_admin" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setDeleteMemberId(profile.id);
                      setDeleteMemberName(profile.full_name || "Unknown");
                    }}
                    className="h-7 text-xs px-3 border-red-500/20 hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-400 transition-colors"
                  >
                    Delete
                  </Button>
                )}
                {profile.role === "visitor" && (
                  <Button
                    size="sm"
                    onClick={() => mutateProfileRole("promote", profile.id)}
                    className="bg-teal-500 hover:bg-teal-400 text-white border-0 h-7 text-xs px-3"
                  >
                    Make Member
                  </Button>
                )}
                {profile.role === "member" && (
                  <div className="flex items-center gap-2 flex-wrap sm:flex-col sm:items-end">
                    {sessionRole === "super_admin" && (
                      <Button
                        size="sm"
                        onClick={() => setRoleConfirm({ profile, targetRole: "leader" })}
                        className="bg-blue-500 hover:bg-blue-400 text-white border-0 h-7 text-xs px-3 mb-1"
                      >
                        Make Leader
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => mutateProfileRole("revoke", profile.id)}
                      className="h-7 text-xs px-3 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30"
                    >
                      Revoke
                    </Button>
                  </div>
                )}
                {profile.role === "leader" && (
                  <div className="flex items-center gap-2 flex-wrap sm:flex-col sm:items-end">
                    {sessionRole === "super_admin" && (
                      <>
                        <Button
                          size="sm"
                          onClick={() => setRoleConfirm({ profile, targetRole: "super_admin" })}
                          className="bg-purple-500 hover:bg-purple-400 text-white border-0 h-7 text-xs px-3 mb-1"
                        >
                          Make Super Admin
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => mutateProfileRole("revoke", profile.id)}
                          className="h-7 text-xs px-3 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30"
                        >
                          Revoke
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
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
    </DashCard>
  );
}
