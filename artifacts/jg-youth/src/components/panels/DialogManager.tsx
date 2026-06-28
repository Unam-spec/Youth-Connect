import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Label } from "@/components/ui/label";
import { QRCodeSVG } from "qrcode.react";
import { User, GraduationCap, BookOpen, Check } from "lucide-react";
import { SCHOOL_OPTIONS } from "@/lib/schools";
import { computeAge } from "@/lib/age";

export interface DialogManagerProps {
  showSessionQrCodeDialog: boolean;
  setShowSessionQrCodeDialog: (v: boolean) => void;
  qrCodeUrl: string | null;

  showEditDialog: boolean;
  setShowEditDialog: (v: boolean) => void;
  editFullName: string;
  setEditFullName: (v: string) => void;
  editPhone: string;
  setEditPhone: (v: string) => void;
  editEmail: string;
  setEditEmail: (v: string) => void;
  editGender: string;
  setEditGender: (v: any) => void;
  editDateOfBirth: string;
  setEditDateOfBirth: (v: string) => void;
  editSchool: string;
  setEditSchool: (v: string) => void;
  editShowSchoolDropdown: boolean;
  setEditShowSchoolDropdown: (v: boolean) => void;
  editParentName: string;
  setEditParentName: (v: string) => void;
  editParentPhone: string;
  setEditParentPhone: (v: string) => void;
  editWhatsappOptIn: boolean;
  setEditWhatsappOptIn: (v: boolean) => void;
  isSavingEdit: boolean;
  handleSaveEdit: () => void;

  settingPinFor: any;
  setSettingPinFor: (v: any) => void;
  leaderPinInput: string;
  setLeaderPinInput: (v: string) => void;
  handleSetLeaderPin: () => void;

  showPinDialog: boolean;
  setShowPinDialog: (v: boolean) => void;
  hasPin: boolean;
  pin: string;
  setPin: (v: string) => void;
  handleSavePin: () => void;
}

export function DialogManager(props: DialogManagerProps) {
  return (
    <>
      <Dialog
        open={props.showSessionQrCodeDialog}
        onOpenChange={props.setShowSessionQrCodeDialog}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Scan for Session Check-in</DialogTitle>
            <DialogDescription>
              Members and visitors scan this to check in tonight.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-center p-4">
            {props.qrCodeUrl ? (
              <QRCodeSVG value={props.qrCodeUrl} size={256} level="H" includeMargin />
            ) : (
              <p>Generating…</p>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => props.setShowSessionQrCodeDialog(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={props.showEditDialog} onOpenChange={props.setShowEditDialog}>
        <DialogContent className="sm:max-w-lg rounded-2xl bg-popover text-popover-foreground border border-border overflow-y-auto max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="text-foreground font-bold">Edit Profile Details</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Update member details directly. Ensure all details are accurate.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-name" className="text-foreground">Full Name *</Label>
              <Input
                id="edit-name"
                value={props.editFullName}
                onChange={(e) => props.setEditFullName(e.target.value)}
                placeholder="John Doe"
                className="bg-card border-border rounded-xl"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="edit-phone" className="text-foreground">Phone Number</Label>
                <PhoneInput
                  value={props.editPhone}
                  onChange={props.setEditPhone}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-email" className="text-foreground">Email</Label>
                <Input
                  id="edit-email"
                  type="email"
                  value={props.editEmail}
                  onChange={(e) => props.setEditEmail(e.target.value)}
                  placeholder="john@example.com"
                  className="bg-card border-border rounded-xl"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="edit-gender" className="text-foreground">Gender</Label>
                <select
                  id="edit-gender"
                  value={props.editGender}
                  onChange={(e: any) => props.setEditGender(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-border bg-card px-3 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-xl"
                >
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-dob" className="text-foreground">Date of Birth</Label>
                <Input
                  id="edit-dob"
                  type="date"
                  value={props.editDateOfBirth}
                  onChange={(e) => props.setEditDateOfBirth(e.target.value)}
                  className="bg-card border-border rounded-xl"
                />
                <p className="text-xs text-muted-foreground">
                  Age: {computeAge(props.editDateOfBirth) ?? "—"}
                </p>
              </div>
            </div>

            <div className="space-y-1.5 relative">
              <Label htmlFor="edit-school" className="text-foreground">School / University</Label>
              <div className="relative">
                <Input
                  id="edit-school"
                  value={props.editSchool}
                  onFocus={() => props.setEditShowSchoolDropdown(true)}
                  onBlur={() => setTimeout(() => props.setEditShowSchoolDropdown(false), 200)}
                  onChange={(e) => {
                    props.setEditSchool(e.target.value);
                    props.setEditShowSchoolDropdown(true);
                  }}
                  placeholder="Start typing school or university..."
                  className="bg-card border-border rounded-xl pr-10"
                />
                <div className="absolute right-3 top-2.5 text-muted-foreground">
                  <GraduationCap className="w-4 h-4" />
                </div>
              </div>
              {props.editShowSchoolDropdown && (
                <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-xl shadow-xl max-h-40 overflow-y-auto">
                  {SCHOOL_OPTIONS.filter(s => s.toLowerCase().includes(props.editSchool.toLowerCase())).map((schoolName) => (
                    <div
                      key={schoolName}
                      onClick={() => {
                        props.setEditSchool(schoolName);
                        props.setEditShowSchoolDropdown(false);
                      }}
                      className="px-4 py-2 text-sm text-popover-foreground hover:bg-primary/10 hover:text-primary cursor-pointer flex items-center justify-between transition-colors duration-150"
                    >
                      <span className="flex items-center gap-2">
                        <BookOpen className="w-3.5 h-3.5" />
                        {schoolName}
                      </span>
                      {props.editSchool === schoolName && <Check className="w-3.5 h-3.5 text-primary" />}
                    </div>
                  ))}
                  {props.editSchool && !SCHOOL_OPTIONS.includes(props.editSchool) && (
                    <div
                      onClick={() => props.setEditShowSchoolDropdown(false)}
                      className="px-4 py-2 text-sm text-primary hover:bg-primary/10 cursor-pointer italic flex items-center gap-2"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Use Custom: "{props.editSchool}"
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="bg-muted/40 border border-border rounded-xl p-4 space-y-3 shadow-xs">
              <div className="flex items-center gap-2 text-primary font-semibold text-xs border-b border-border pb-1.5">
                <User className="w-3.5 h-3.5" />
                Parent / Guardian Details
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="edit-parent-name" className="text-xs text-muted-foreground">Parent/Guardian Name</Label>
                  <Input
                    id="edit-parent-name"
                    value={props.editParentName}
                    onChange={(e) => props.setEditParentName(e.target.value)}
                    placeholder="Mary Doe"
                    className="bg-card border-border rounded-xl h-9 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-parent-phone" className="text-xs text-muted-foreground">Parent/Guardian Phone</Label>
                  <PhoneInput
                    value={props.editParentPhone}
                    onChange={props.setEditParentPhone}
                    className="h-9 text-sm"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-start space-x-3 space-y-0 rounded-xl border border-border bg-muted/40 p-3 shadow-xs">
              <input
                type="checkbox"
                id="edit-whatsapp-opt-in"
                checked={props.editWhatsappOptIn}
                onChange={(e) => props.setEditWhatsappOptIn(e.target.checked)}
                className="w-4 h-4 rounded text-primary focus:ring-ring border-border bg-card cursor-pointer mt-0.5"
              />
              <div className="space-y-1 leading-none cursor-pointer" onClick={() => props.setEditWhatsappOptIn(!props.editWhatsappOptIn)}>
                <Label htmlFor="edit-whatsapp-opt-in" className="text-xs font-semibold text-foreground cursor-pointer">
                  Join the Youth Connect WhatsApp Group
                </Label>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Get session details and announcements directly on WhatsApp.
                </p>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => props.setShowEditDialog(false)}
              disabled={props.isSavingEdit}
              className="rounded-xl"
            >
              Cancel
            </Button>
            <Button
              onClick={props.handleSaveEdit}
              disabled={props.isSavingEdit}
              className="rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold border-0"
            >
              {props.isSavingEdit ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!props.settingPinFor}
        onOpenChange={(open) => {
          if (!open) {
            props.setSettingPinFor(null);
            props.setLeaderPinInput("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set PIN for {props.settingPinFor?.full_name}</DialogTitle>
            <DialogDescription>
              Enter a 4-digit PIN. This will be used when this leader logs in.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              id="leader-pin-input"
              type="password"
              placeholder="Enter 4-digit PIN"
              maxLength={4}
              value={props.leaderPinInput}
              onChange={(e) =>
                props.setLeaderPinInput(e.target.value.replace(/\D/g, "").slice(0, 4))
              }
              className="text-center text-2xl tracking-widest"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                props.setSettingPinFor(null);
                props.setLeaderPinInput("");
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={props.handleSetLeaderPin}
              disabled={props.leaderPinInput.length !== 4}
              className="bg-primary hover:bg-primary/90 text-primary-foreground border-0"
            >
              Set PIN
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={props.showPinDialog} onOpenChange={props.setShowPinDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{props.hasPin ? "Change PIN" : "Set PIN"}</DialogTitle>
            <DialogDescription>
              {props.hasPin
                ? "Update your 4-digit leader PIN."
                : "Create a 4-digit PIN for leader authentication."}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              id="pin-input"
              type="password"
              placeholder="Enter 4-digit PIN"
              maxLength={4}
              value={props.pin}
              onChange={(e) =>
                props.setPin(e.target.value.replace(/\D/g, "").slice(0, 4))
              }
              className="text-center text-2xl tracking-widest"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => props.setShowPinDialog(false)}>
              Cancel
            </Button>
            <Button
              id="btn-save-pin"
              onClick={props.handleSavePin}
              disabled={props.pin.length !== 4}
              className="bg-primary hover:bg-primary/90 text-primary-foreground border-0"
            >
              {props.hasPin ? "Update PIN" : "Set PIN"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
