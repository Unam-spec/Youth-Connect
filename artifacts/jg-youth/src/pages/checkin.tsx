import { useState, useEffect, useRef } from "react";
import { useAuth } from "@clerk/react";
import { Link } from "wouter";
import { Html5Qrcode } from "html5-qrcode";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle2,
  ChevronLeft,
  Clock,
  Loader2,
  QrCode,
  Search,
  UserCheck,
  Camera,
  Users,
} from "lucide-react";
import { QRCode as QRCodeDisplay } from "@/components/ui/qr-code";

// ── Types ─────────────────────────────────────────────────────────────────────

type CheckInStatus = "idle" | "loading" | "approved" | "pending" | "error";
type FlowMode = "qr" | "search";

interface CheckInResult {
  status: "approved" | "pending";
  message: string;
}

interface Profile {
  id: string;
  full_name: string;
  phone: string | null;
  role: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CheckIn() {
  const { toast } = useToast();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const [flowMode, setFlowMode] = useState<FlowMode>("qr");
  const [checkInStatus, setCheckInStatus] = useState<CheckInStatus>("idle");
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");

  // QR Scanner state
  const [isScanning, setIsScanning] = useState(false);
  const [scannerError, setScannerError] = useState<string>("");
  const qrReaderRef = useRef<Html5Qrcode | null>(null);
  const [showMemberDialog, setShowMemberDialog] = useState(false);
  const [scannedData, setScannedData] = useState<string>("");
  const [sessionSlug, setSessionSlug] = useState<string | null>(null);

  useEffect(() => {
    if (scannedData) {
      try {
        const url = new URL(scannedData);
        const sessionId = url.searchParams.get("session_id");
        if (sessionId) {
          setSessionSlug(sessionId);
          // Here, instead of directly showing the dialog, we should ideally
          // make an API call to determine if the user is a member or first-timer
          // based on the sessionSlug and their authenticated status.
          // For now, we'll keep showing the dialog, but this is where the logic
          // for automatic determination would go.
        } else {
          toast({
            title: "Invalid QR Code",
            description:
              "The scanned QR code does not contain a valid session ID.",
            variant: "destructive",
          });
          setShowMemberDialog(false); // Close dialog if invalid
        }
      } catch (error) {
        toast({
          title: "Invalid QR Code",
          description: "The scanned QR code is not a valid URL.",
          variant: "destructive",
        });
        setShowMemberDialog(false); // Close dialog if invalid
      }
    }
  }, [scannedData, toast]);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // QR Generator state (for leaders/super admins)
  const [showQRGenerator, setShowQRGenerator] = useState(false);
  const [generatedQR, setGeneratedQR] = useState<string>("");
  const [isGeneratingQR, setIsGeneratingQR] = useState(false);
  const [userProfile, setUserProfile] = useState<Profile | null>(null);

  // Fetch user profile to check role
  useEffect(() => {
    async function fetchProfile() {
      if (!isSignedIn) return;
      try {
        const token = await getToken();
        const response = await fetch("/api/profiles/me", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (response.ok) {
          const profile = await response.json();
          setUserProfile(profile);
        }
      } catch (err) {
        console.error("Failed to fetch profile:", err);
      }
    }
    if (isLoaded && isSignedIn) {
      fetchProfile();
    }
  }, [isLoaded, isSignedIn, getToken]);

  // Cleanup QR scanner on unmount
  useEffect(() => {
    return () => {
      if (qrReaderRef.current) {
        qrReaderRef.current.stop().catch(() => {});
      }
    };
  }, []);

  // Wait for Clerk to initialise
  if (!isLoaded) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      </Layout>
    );
  }

  // ── QR Scanner Functions ──────────────────────────────────────────────────────

  async function startQRScanner() {
    setIsScanning(true);
    setScannerError("");

    try {
      const html5QrCode = new Html5Qrcode("qr-reader");
      qrReaderRef.current = html5QrCode;

      await html5QrCode.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
        },
        (decodedText) => {
          // Successfully scanned
          html5QrCode.stop().then(() => {
            setIsScanning(false);
            setScannedData(decodedText);
            setShowMemberDialog(true);
          });
        },
        () => {
          // Scan error (ignore, happens frequently)
        },
      );
    } catch (err: any) {
      setIsScanning(false);
      setScannerError(
        "Camera access required. Please allow camera access and try again.",
      );
      toast({
        title: "Camera Error",
        description: "Failed to access camera. Please check permissions.",
        variant: "destructive",
      });
    }
  }

  function stopQRScanner() {
    if (qrReaderRef.current) {
      qrReaderRef.current
        .stop()
        .then(() => {
          setIsScanning(false);
          qrReaderRef.current = null;
        })
        .catch(() => {
          setIsScanning(false);
        });
    }
  }

  // ── Check-in Functions ────────────────────────────────────────────────────────

  async function handleMemberCheckIn() {
    if (!isSignedIn) {
      setErrorMessage("Please sign in to check in");
      return;
    }

    if (!sessionSlug) {
      setErrorMessage("No session QR code scanned.");
      setCheckInStatus("error");
      return;
    }

    setShowMemberDialog(false);
    setCheckInStatus("loading");
    setErrorMessage("");

    try {
      const token = await getToken();
      const response = await fetch("/api/checkin/requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ sessionSlug }),
      });

      const data = await response.json();

      if (!response.ok) {
        setCheckInStatus("error");
        setErrorMessage(data.error ?? "An unexpected error occurred.");
        toast({
          title: "Check-in failed",
          description: data.error ?? "An unexpected error occurred.",
          variant: "destructive",
        });
        return;
      }

      const status: "approved" | "pending" = data.status ?? "pending";
      setResult({ status, message: data.message });
      setCheckInStatus(status);
    } catch {
      setCheckInStatus("error");
      setErrorMessage("Network error. Please try again.");
      toast({
        title: "Check-in failed",
        description: "Network error. Please try again.",
        variant: "destructive",
      });
    }
  }

  function handleFirstTimer() {
    setShowMemberDialog(false);
    window.location.href = `/register?session_id=${sessionSlug}`;
  }

  // ── Search Functions ──────────────────────────────────────────────────────────

  async function handleSearch(query: string) {
    setSearchQuery(query);
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const response = await fetch(
        `/api/checkin/search?query=${encodeURIComponent(query)}`,
      );
      if (response.ok) {
        const profiles = await response.json();
        setSearchResults(profiles);
      }
    } catch (err) {
      console.error("Search failed:", err);
    } finally {
      setIsSearching(false);
    }
  }

  async function handleProfileCheckIn(profileId: string) {
    if (!isSignedIn) {
      setErrorMessage("Please sign in to check in");
      return;
    }

    setCheckInStatus("loading");
    setErrorMessage("");

    try {
      const token = await getToken();
      const response = await fetch("/api/checkin/requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({}),
      });

      const data = await response.json();

      if (!response.ok) {
        setCheckInStatus("error");
        setErrorMessage(data.error ?? "An unexpected error occurred.");
        toast({
          title: "Check-in failed",
          description: data.error ?? "An unexpected error occurred.",
          variant: "destructive",
        });
        return;
      }

      const status: "approved" | "pending" = data.status ?? "pending";
      setResult({ status, message: data.message });
      setCheckInStatus(status);
    } catch {
      setCheckInStatus("error");
      setErrorMessage("Network error. Please try again.");
      toast({
        title: "Check-in failed",
        description: "Network error. Please try again.",
        variant: "destructive",
      });
    }
  }

  // ── QR Generator Functions ────────────────────────────────────────────────────

  async function handleGenerateQR() {
    setIsGeneratingQR(true);
    try {
      const token = await getToken();
      const response = await fetch("/api/qrcodes/public", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (response.ok) {
        const qr = await response.json();
        const qrUrl = `${window.location.origin}/qr/${qr.slug}`;
        setGeneratedQR(qrUrl);
        setShowQRGenerator(true);
      } else {
        toast({
          title: "Failed to generate QR code",
          description: "Please try again.",
          variant: "destructive",
        });
      }
    } catch (err) {
      toast({
        title: "Failed to generate QR code",
        description: "Network error.",
        variant: "destructive",
      });
    } finally {
      setIsGeneratingQR(false);
    }
  }

  // ── Success: leader / super_admin ─────────────────────────────────────────
  if (checkInStatus === "approved") {
    return (
      <Layout>
        <div className="max-w-md mx-auto pt-10">
          <Card className="border-green-500/30 shadow-xl overflow-hidden relative">
            <div className="absolute top-0 left-0 w-full h-2 bg-green-500" />
            <CardHeader className="text-center pb-4 pt-8">
              <div className="mx-auto w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center mb-4">
                <CheckCircle2 className="w-10 h-10 text-green-500" />
              </div>
              <CardTitle className="text-3xl">Checked In!</CardTitle>
              <CardDescription className="text-base mt-2 text-foreground">
                You're all set. Enjoy the service!
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-2 pb-8">
              <Link href="/">
                <Button variant="outline" className="w-full">
                  Return Home
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  // ── Success: member / visitor (pending approval) ───────────────────────────
  if (checkInStatus === "pending") {
    return (
      <Layout>
        <div className="max-w-md mx-auto pt-10">
          <Card className="border-yellow-500/30 shadow-xl overflow-hidden relative">
            <div className="absolute top-0 left-0 w-full h-2 bg-yellow-500" />
            <CardHeader className="text-center pb-4 pt-8">
              <div className="mx-auto w-20 h-20 bg-yellow-500/10 rounded-full flex items-center justify-center mb-4">
                <Clock className="w-10 h-10 text-yellow-500" />
              </div>
              <CardTitle className="text-3xl">Pending Approval</CardTitle>
              <CardDescription className="text-base mt-2 text-foreground">
                Your check-in request has been submitted. A leader will approve
                it shortly.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-2 pb-8">
              <Link href="/">
                <Button variant="outline" className="w-full">
                  Return Home
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  // ── Default: check-in form ────────────────────────────────────────────────
  return (
    <Layout>
      <div className="max-w-2xl mx-auto py-8 px-4">
        <div className="mb-6 flex items-center justify-between">
          <Link href="/">
            <Button
              variant="ghost"
              size="sm"
              className="-ml-3 text-muted-foreground"
            >
              <ChevronLeft className="w-4 h-4 mr-1" />
              Back
            </Button>
          </Link>

          {/* QR Generator Button (Leaders/Super Admins Only) */}
          {userProfile &&
            (userProfile.role === "leader" ||
              userProfile.role === "super_admin") && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleGenerateQR}
                disabled={isGeneratingQR}
              >
                {isGeneratingQR ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <QrCode className="w-4 h-4 mr-2" />
                )}
                Generate QR Code
              </Button>
            )}
        </div>

        <Card className="shadow-lg border-border/60">
          <CardHeader>
            <CardTitle className="text-2xl">Friday Night Check-In</CardTitle>
            <CardDescription>
              {!isSignedIn
                ? "Please sign in to check in for tonight's session."
                : "Choose how you'd like to check in for tonight's session. Check-in is available on Fridays between 18:30 and 22:00 SAST."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pb-8">
            {/* Not signed in message */}
            {!isSignedIn && (
              <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-sm text-blue-700 dark:text-blue-300">
                Please sign in to check in. If you're a first-timer,{" "}
                <Link
                  href="/register"
                  className="underline underline-offset-4 hover:text-primary font-medium"
                >
                  register here
                </Link>
                .
              </div>
            )}

            {/* Error message */}
            {checkInStatus === "error" && errorMessage && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {errorMessage}
              </div>
            )}

            {/* Flow Mode Selector */}
            {isSignedIn && (
              <div className="flex gap-2 p-1 bg-muted rounded-lg">
                <Button
                  variant={flowMode === "qr" ? "default" : "ghost"}
                  className="flex-1"
                  onClick={() => {
                    setFlowMode("qr");
                    stopQRScanner();
                  }}
                >
                  <Camera className="w-4 h-4 mr-2" />
                  QR Scan
                </Button>
                <Button
                  variant={flowMode === "search" ? "default" : "ghost"}
                  className="flex-1"
                  onClick={() => {
                    setFlowMode("search");
                    stopQRScanner();
                  }}
                >
                  <Search className="w-4 h-4 mr-2" />
                  Self Check-In
                </Button>
              </div>
            )}

            {/* Flow A: QR Code Scanner */}
            {isSignedIn && flowMode === "qr" && (
              <div className="space-y-4">
                {!isScanning ? (
                  <div className="text-center space-y-4">
                    <div className="mx-auto w-24 h-24 bg-primary/10 rounded-full flex items-center justify-center">
                      <QrCode className="w-12 h-12 text-primary" />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Scan the QR code displayed at the venue to check in
                    </p>
                    <Button
                      className="w-full h-14 text-base"
                      size="lg"
                      onClick={startQRScanner}
                    >
                      <Camera className="w-5 h-5 mr-2" />
                      Start Camera
                    </Button>
                    {scannerError && (
                      <p className="text-sm text-destructive">{scannerError}</p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div
                      id="qr-reader"
                      className="rounded-lg overflow-hidden border-2 border-primary"
                    />
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={stopQRScanner}
                    >
                      Cancel Scan
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Flow B: Self Check-In Search */}
            {isSignedIn && flowMode === "search" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="Search by name or phone..."
                      value={searchQuery}
                      onChange={(e) => handleSearch(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                  {isSearching && (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                    </div>
                  )}
                  {searchResults.length > 0 && (
                    <div className="border rounded-lg divide-y max-h-64 overflow-y-auto">
                      {searchResults.map((profile) => (
                        <button
                          key={profile.id}
                          onClick={() => handleProfileCheckIn(profile.id)}
                          disabled={checkInStatus === "loading"}
                          className="w-full px-4 py-3 text-left hover:bg-muted transition-colors disabled:opacity-50"
                        >
                          <div className="font-medium">{profile.full_name}</div>
                          {profile.phone && (
                            <div className="text-sm text-muted-foreground">
                              {profile.phone}
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                  {searchQuery.length >= 2 &&
                    !isSearching &&
                    searchResults.length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        No members found. Try a different search.
                      </p>
                    )}
                </div>

                <div className="pt-4 border-t">
                  <p className="text-sm text-muted-foreground text-center mb-3">
                    Or check in directly:
                  </p>
                  <Button
                    className="w-full h-14 text-base"
                    size="lg"
                    onClick={handleMemberCheckIn}
                    disabled={checkInStatus === "loading"}
                  >
                    {checkInStatus === "loading" ? (
                      <>
                        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                        Checking in…
                      </>
                    ) : (
                      <>
                        <UserCheck className="w-5 h-5 mr-2" />
                        Check Me In
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}

            <p className="text-center text-xs text-muted-foreground pt-2">
              Not a member yet?{" "}
              <Link
                href="/register"
                className="underline underline-offset-4 hover:text-primary"
              >
                Register as a first-timer
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Member vs First Timer Dialog */}
      <Dialog open={showMemberDialog} onOpenChange={setShowMemberDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Check-In Type</DialogTitle>
            <DialogDescription>
              Are you a member or is this your first time?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col sm:flex-col gap-2">
            <Button
              onClick={handleMemberCheckIn}
              disabled={checkInStatus === "loading"}
              className="w-full"
            >
              {checkInStatus === "loading" ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Users className="w-4 h-4 mr-2" />
              )}
              Member Check-In
            </Button>
            <Button
              variant="outline"
              onClick={handleFirstTimer}
              className="w-full"
            >
              First Timer Registration
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* QR Code Generator Dialog */}
      <Dialog open={showQRGenerator} onOpenChange={setShowQRGenerator}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Today's Check-In QR Code</DialogTitle>
            <DialogDescription>
              Display this QR code for members to scan and check in
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-center py-6">
            {generatedQR && (
              <div className="bg-white p-4 rounded-lg">
                <QRCodeDisplay url={generatedQR} size={250} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowQRGenerator(false)}
              className="w-full"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
