import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { getListProfilesQueryKey, useMergeProfiles } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useApiFetch } from "@/lib/api";

interface DupProfile {
  id: string;
  full_name: string;
  username: string | null;
  phone: string | null;
  date_of_birth: string | null;
  role: string;
  created_at: string;
}
interface DupGroup {
  reason: "phone" | "name_and_birthday" | "name";
  profiles: DupProfile[];
}

const REASON: Record<DupGroup["reason"], string> = {
  phone: "Same phone number",
  name_and_birthday: "Same name and birthday",
  name: "Same name",
};

/**
 * Super admin: every set of profiles that look like the same person, with
 * "Keep this one" to merge the others into it (check-ins, RSVPs and requests
 * move across; the extra profiles are deleted).
 */
export function DuplicatesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const apiFetch = useApiFetch();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const merge = useMergeProfiles();
  const [confirm, setConfirm] = useState<{ keep: DupProfile; others: DupProfile[] } | null>(null);
  const [merging, setMerging] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["profiles", "duplicates"],
    enabled: open,
    queryFn: async () => {
      const res = await apiFetch("/api/profiles/duplicates");
      if (!res.ok) throw new Error("Couldn't check for duplicates");
      return (await res.json()) as { groups: DupGroup[] };
    },
  });

  async function doMerge() {
    if (!confirm) return;
    setMerging(true);
    try {
      for (const o of confirm.others) {
        await merge.mutateAsync({ data: { keepId: confirm.keep.id, mergeId: o.id } });
      }
      toast({ title: `Merged into ${confirm.keep.full_name}` });
      queryClient.invalidateQueries({ queryKey: getListProfilesQueryKey() });
      await refetch();
    } catch {
      toast({ title: "Merge failed", variant: "destructive" });
    } finally {
      setMerging(false);
      setConfirm(null);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogTitle>Possible duplicates</DialogTitle>
          <DialogDescription>
            Profiles that look like the same person. Tap <b>Keep this one</b> on the right profile to merge the others
            into it. "Same name" can be two different people, so check before merging.
          </DialogDescription>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !data?.groups.length ? (
            <p className="flex items-center gap-2 rounded-xl border border-border p-4 text-sm">
              <CheckCircle2 className="h-4 w-4 text-green-500" /> No duplicates found.
            </p>
          ) : (
            <div className="space-y-3">
              {data.groups.map((g) => (
                <div key={g.profiles.map((p) => p.id).join()} className="rounded-xl border border-border p-3">
                  <p
                    className={`mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider ${
                      g.reason === "name" ? "text-muted-foreground" : "text-amber-500"
                    }`}
                  >
                    <AlertTriangle className="h-3.5 w-3.5" /> {REASON[g.reason]}
                  </p>
                  <div className="space-y-2">
                    {g.profiles.map((p) => (
                      <div key={p.id} className="flex items-center gap-3 rounded-lg bg-muted/40 p-2">
                        <div className="min-w-0 flex-1 text-sm">
                          <p className="truncate font-medium">
                            {p.full_name}
                            {p.username && <span className="font-normal text-muted-foreground"> @{p.username}</span>}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {[
                              p.phone,
                              p.date_of_birth ? `Born ${p.date_of_birth}` : null,
                              p.role,
                              `Joined ${format(new Date(p.created_at), "d MMM yyyy")}`,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="shrink-0"
                          onClick={() => setConfirm({ keep: p, others: g.profiles.filter((o) => o.id !== p.id) })}
                        >
                          Keep this one
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && !merging && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Keep {confirm?.keep.full_name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.others.length === 1 ? "The other profile" : `The other ${confirm?.others.length} profiles`} will
              be merged into this one: check-ins, RSVPs and requests move across, then{" "}
              {confirm?.others.length === 1 ? "it's" : "they're"} deleted. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={merging}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={merging}
              onClick={(e) => {
                e.preventDefault();
                void doMerge();
              }}
            >
              {merging ? "Merging…" : "Merge"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
