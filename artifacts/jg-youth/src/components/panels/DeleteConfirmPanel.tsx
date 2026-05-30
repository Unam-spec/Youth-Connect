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

export interface DeleteConfirmPanelProps {
  deleteEventId: string | null;
  setDeleteEventId: (id: string | null) => void;
  deleteEventName: string | null;
  handleDeleteEvent: () => void;

  deleteMemberId: string | null;
  setDeleteMemberId: (id: string | null) => void;
  deleteMemberName: string | null;
  handleDeleteMember: () => void;

  roleConfirm: any;
  setRoleConfirm: (role: any) => void;
  handleConfirmRoleChange: () => void;

  showWipeConfirm: boolean;
  setShowWipeConfirm: (v: boolean) => void;
  isWipingData: boolean;
  handleWipeData: () => void;
}

export function DeleteConfirmPanel({
  deleteEventId,
  setDeleteEventId,
  deleteEventName,
  handleDeleteEvent,
  deleteMemberId,
  setDeleteMemberId,
  deleteMemberName,
  handleDeleteMember,
  roleConfirm,
  setRoleConfirm,
  handleConfirmRoleChange,
  showWipeConfirm,
  setShowWipeConfirm,
  isWipingData,
  handleWipeData,
}: DeleteConfirmPanelProps) {
  return (
    <>
      <AlertDialog
        open={!!deleteEventId}
        onOpenChange={(open) => !open && setDeleteEventId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Event</AlertDialogTitle>
            <AlertDialogDescription>
              Delete "{deleteEventName}"? This removes all RSVPs and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteEvent}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={showWipeConfirm}
        onOpenChange={setShowWipeConfirm}
      >
        <AlertDialogContent className="bg-slate-900 text-white border-slate-800">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-red-400 font-bold">Wipe All Test Data</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-300">
              Are you absolutely sure you want to delete all events, check-ins, RSVPs, attendance, and non-admin members?
              This action cannot be undone and will completely wipe the database clean.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleWipeData}
              disabled={isWipingData}
              className="bg-red-650 hover:bg-red-500 text-white font-semibold border-0"
            >
              {isWipingData ? "Wiping Data..." : "Wipe Everything"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!roleConfirm}
        onOpenChange={(open) => !open && setRoleConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change Role</AlertDialogTitle>
            <AlertDialogDescription>
              Promote <strong>{roleConfirm?.profile?.full_name}</strong> to{" "}
              <strong>{roleConfirm?.targetRole?.replace("_", " ")}</strong>?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmRoleChange}>
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!deleteMemberId}
        onOpenChange={(open) => !open && setDeleteMemberId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Member</AlertDialogTitle>
            <AlertDialogDescription>
              Delete "{deleteMemberName}"? This will permanently remove this
              member from the system and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteMember}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
