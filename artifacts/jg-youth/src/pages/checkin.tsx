import { useState, useEffect, useRef } from "react";
import { useAuth } from "@clerk/react";
import { getLeaderSession } from "@/lib/auth";
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
  LockIcon,
  MoonIcon,
} from "lucide-react";
import { QRCode as QRCodeDisplay } from "@/components/ui/qr-code";
import { QRCodeSVG as QRCodeSVGInline } from "qrcode.react";

import { CheckInWaitingState } from "@/components/CheckInWaitingState";

// ── Types ─────────────────────────────────────────────────────────────────────

type CheckInStatus = "idle" | "loading" | "approved" | "pending" | "error";
type FlowMode = "qr" | "search";

interface CheckInResult {
  status: "approved" | "pending";
  message: string;
  requestId?: string;
}

interface Profile {
  id: string;
  full_name: string;
  phone: string | null;
  role: string;
}

// ── SAST time helpers ─────────────────────────────────────────────────────────

function getSastTime(): { dayOfWeek: number; hours: number; minutes: number } {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(now)) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  const hours = parseInt(parts["hour"] ?? "0", 10);
  const minutes = parseInt(parts["minute"] ?? "0", 10);
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const dayOfWeek = weekdayMap[parts["weekday"] ?? ""] ?? new Date().getDay();
  return { dayOfWeek, hours, minutes };
}

type WindowState = "before" | "open" | "after" | "wrong_day";

function getCheckinWindowState(): WindowState {
  const { dayOfWeek, hours, minutes } = getSastTime();
  if (dayOfWeek !== 5) return "wrong_day";
  const totalMins = hours * 60 + minutes;
  const start = 18 * 60 + 30; // 18:30
  const end = 22 * 60;         // 22:00
  if (totalMins < start) return "before";
  if (totalMins >= end) return "after";
  return "open";
}

// ── Session QR Display (shown on check-in page) ─────────────────────────────

function SessionQrDisplay() {
  const [sessionUrl, setSessionUrl] = useState<string | null>(null);

  useEffect(() => {
    // Check for session_id in URL
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    if (sessionId) {
      setSessionUrl(`${window.location.origin}/checkin?session_id=${sessionId}`);
    }
  }, []);

  if (!sessionUrl) return null;

  return (
    <div className="rounded-2xl border border-[#0A84FF]/20 bg-gradient-to-br from-[#0A84FF]/8 to-[#32ADE6]/5 p-5 flex flex-col items-center gap-4 mb-2">
      <p className="text-sm font-semibold text-[#0A84FF]">Tonight's Session QR</p>
      <div className="bg-white p-4 rounded-2xl shadow-sm">
        <QRCodeSVGInline value={sessionUrl} size={200} />
      </div>
      <p className="text-xs text-muted-foreground text-center">Members can also scan this QR to check in</p>
    </div>
  );
}

// ── Time Window Banner ────────────────────────────────────────────────────────

function TimeWindowBanner() {
  const state = getCheckinWindowState();

  if (state === "open") return null;

  const config = {
    before: {
      icon: <LockIcon className="w-8 h-8 text-[#0A84FF]" />,
      title: "Check-In Not Yet Open",
      message: "Friday night check-in opens at 18:30 SAST. See you then!",
      bg: "bg-gradient-to-br from-[#0A84FF]/10 to-[#30D158]/5",
      border: "border-[#0A84FF]/30",
      text: "text-[#0A84FF]",
    },
    after: {
      icon: <MoonIcon className="w-8 h-8 text-[#5E5CE6]" />,
      title: "Check-In Has Closed",
      message: "Tonight's check-in closed at 22:00 SAST. See you next Friday!",
      bg: "bg-gradient-to-br from-[#5E5CE6]/10 to-[#0A84FF]/5",
      border: "border-[#5E5CE6]/30",
      text: "text-[#5E5CE6]",
    },
    wrong_day: {
      icon: <Clock className="w-8 h-8 text-[#32ADE6]" />,
      title: "Check-In is Fridays Only",
      message: "Friday night check-in runs every Friday from 18:30 to 22:00 SAST.",
      bg: "bg-gradient-to-br from-[#32ADE6]/10 to-[#30D158]/5",
      border: "border-[#32ADE6]/30",
      text: "text-[#32ADE6]",
    },
  }[state];

  return (
    <div className={`rounded-2xl border ${config.border} ${config.bg} p-8 flex flex-col items-center text-center gap-4 shadow-sm`}>
      <div className={`w-16 h-16 rounded-full flex items-center justify-center ${config.bg} border ${config.border}`}>
        {config.icon}
      </div>
      <div>
        <h3 className={`text-xl font-semibold ${config.text}`}>{config.title}</h3>
        <p className="text-muted-foreground mt-1 text-sm">{config.message}</p>
      </div>
      <Link href="/">
        <Button variant="outline" className="mt-2">Return Home</Button>
      </Link>
    </div>
  );
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
        } else {
          toast({
            title: "Invalid QR Code",
            description: "The scanned QR code does not contain a valid session ID.",
            variant: "destructive",
          });
          setShowMemberDialog(false);
        }
      } catch (error) {
        toast({
          title: "Invalid QR Code",
          description: "The scanned QR code is not a valid URL.",
          variant: "destructive",
        });
        setShowMemberDialog(false);
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

  if (!isLoaded) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      </Layout>
    );
  }

  // ── QR Scanner Functions ─────────────────────────────────────────────────────

  async function startQRScanner() {
    setIsScanning(true);
    setScannerError("");

    try {
      // Pre-request camera permission natively to force iOS/Chrome prompts
      try {
        const preStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        preStream.getTracks().forEach((track) => track.stop());
      } catch (mediaErr) {
        console.warn("Natively requesting media permission failed, proceeding to Html5Qrcode:", mediaErr);
      }

      const html5QrCode = new Html5Qrcode("qr-reader");
      qrReaderRef.current = html5QrCode;

      await html5QrCode.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          html5QrCode.stop().then(() => {
            setIsScanning(false);
            setScannedData(decodedText);
            setShowMemberDialog(true);
          });
        },
        () => {},
      );
    } catch (err: any) {
      setIsScanning(false);
      setScannerError("Camera access required. Please allow camera access and try again.");
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

  // ── Check-in Functions ───────────────────────────────────────────────────────

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
        toast({ title: "Check-in failed", description: data.error ?? "An unexpected error occurred.", variant: "destructive" });
        return;
      }
      const status: "approved" | "pending" = data.status ?? "pending";
      setResult({ status, message: data.message, requestId: data.request?.id });
      setCheckInStatus(status);
    } catch {
      setCheckInStatus("error");
      setErrorMessage("Network error. Please try again.");
      toast({ title: "Check-in failed", description: "Network error. Please try again.", variant: "destructive" });
    }
  }

  function handleFirstTimer() {
    setShowMemberDialog(false);
    window.location.href = `/register?session_id=${sessionSlug}`;
  }

  // ── Search Functions ─────────────────────────────────────────────────────────

  async function handleSearch(query: string) {
    setSearchQuery(query);
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }
    setIsSearching(true);
    try {
      const response = await fetch(`/api/checkin/search?query=${encodeURIComponent(query)}`);
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
        toast({ title: "Check-in failed", description: data.error ?? "An unexpected error occurred.", variant: "destructive" });
        return;
      }
      const status: "approved" | "pending" = data.status ?? "pending";
      setResult({ status, message: data.message, requestId: data.request?.id });
      setCheckInStatus(status);
    } catch {
      setCheckInStatus("error");
      setErrorMessage("Network error. Please try again.");
      toast({ title: "Check-in failed", description: "Network error. Please try again.", variant: "destructive" });
    }
  }

  // ── QR Generator Functions ───────────────────────────────────────────────────

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
        toast({ title: "Failed to generate QR code", description: "Please try again.", variant: "destructive" });
      }
    } catch (err) {
      toast({ title: "Failed to generate QR code", description: "Network error.", variant: "destructive" });
    } finally {
      setIsGeneratingQR(false);
    }
  }

  // ── Success: approved ────────────────────────────────────────────────────────
  if (checkInStatus === "approved") {
    return (
      <Layout>
        <div className="max-w-sm mx-auto pt-12 px-4">
          <div className="rounded-3xl bg-gradient-to-br from-[#30D158]/15 to-[#30D158]/5 border border-[#30D158]/30 p-10 flex flex-col items-center text-center gap-4 shadow-sm">
            <div className="w-20 h-20 rounded-full bg-[#30D158]/20 flex items-center justify-center">
              <CheckCircle2 className="w-10 h-10 text-[#30D158]" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-[#30D158]">Checked In!</h2>
              <p className="text-muted-foreground mt-1">You're all set. Enjoy the service!</p>
            </div>
            <Link href="/">
              <Button variant="outline" className="mt-2 rounded-xl px-8">Return Home</Button>
            </Link>
          </div>
        </div>
      </Layout>
    );
  }

  // ── Success: pending ─────────────────────────────────────────────────────────
  if (checkInStatus === "pending" && result?.requestId) {
    return (
      <Layout>
        <div className="max-w-sm mx-auto pt-12 px-4">
          <CheckInWaitingState requestId={result.requestId} />
        </div>
      </Layout>
    );
  } else if (checkInStatus === "pending") {
    // Fallback if no request ID is returned
    return (
      <Layout>
        <div className="max-w-sm mx-auto pt-12 px-4">
          <div className="rounded-3xl bg-gradient-to-br from-[#FF9F0A]/15 to-[#FF9F0A]/5 border border-[#FF9F0A]/30 p-10 flex flex-col items-center text-center gap-4 shadow-sm">
            <div className="w-20 h-20 rounded-full bg-[#FF9F0A]/20 flex items-center justify-center">
              <Clock className="w-10 h-10 text-[#FF9F0A]" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-[#FF9F0A]">Pending Approval</h2>
              <p className="text-muted-foreground mt-1">Your check-in was submitted. A leader will approve it shortly.</p>
            </div>
            <Link href="/">
              <Button variant="outline" className="mt-2 rounded-xl px-8">Return Home</Button>
            </Link>
          </div>
        </div>
      </Layout>
    );
  }

  const windowState = getCheckinWindowState();
  const leaderSession = getLeaderSession();
  const isLeaderOrAdmin =
    leaderSession?.role === "super_admin" ||
    leaderSession?.role === "leader" ||
    userProfile?.role === "super_admin" ||
    userProfile?.role === "leader";
  // Leaders and super admins always see the check-in form regardless of time
  const canBypassWindow = isLeaderOrAdmin;

  // ── Default: check-in form ───────────────────────────────────────────────────
  return (
    <Layout>
      <div className="max-w-xl mx-auto py-8 px-4 space-y-6">

        {/* Header row */}
        <div className="flex items-center justify-between">
          <Link href="/">
            <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground gap-1">
              <ChevronLeft className="w-4 h-4" />
              Back
            </Button>
          </Link>
          {userProfile && (userProfile.role === "leader" || userProfile.role === "super_admin") && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleGenerateQR}
              disabled={isGeneratingQR}
              className="rounded-xl gap-1.5"
            >
              {isGeneratingQR ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" />}
              Generate QR
            </Button>
          )}
        </div>

        {/* Page title */}
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Friday Check-In</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Check-in is available every Friday from 18:30 to 22:00 SAST
          </p>
        </div>

        {/* Time window banner — shown before/after/wrong day unless bypassed */}
        {windowState !== "open" && !canBypassWindow && <TimeWindowBanner />}

        {/* Check-in form — always shown for leaders/admins, otherwise only during open window */}
        {(windowState === "open" || canBypassWindow) && (
          <div className="space-y-5">

            {/* Not signed in */}
            {!isSignedIn && (
              <div className="rounded-2xl border border-[#0A84FF]/30 bg-[#0A84FF]/8 px-5 py-4 text-sm text-[#0A84FF]">
                Please{" "}
                <Link href="/sign-in" className="underline underline-offset-4 font-semibold">
                  sign in
                </Link>{" "}
                to check in. First timer?{" "}
                <Link href="/register" className="underline underline-offset-4 font-semibold">
                  Register here
                </Link>
                .
              </div>
            )}

            {/* Error banner */}
            {checkInStatus === "error" && errorMessage && (
              <div className="rounded-2xl border border-destructive/30 bg-destructive/8 px-5 py-4 text-sm text-destructive">
                {errorMessage}
              </div>
            )}

            {/* Live Session QR display */}
            <SessionQrDisplay />

            {/* Mode picker */}
            {isSignedIn && (
              <div className="flex gap-2 p-1.5 bg-muted rounded-2xl">
                <button
                  onClick={() => { setFlowMode("qr"); stopQRScanner(); }}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all
                    ${flowMode === "qr"
                      ? "bg-background shadow-sm text-foreground"
                      : "text-muted-foreground hover:text-foreground"}`}
                >
                  <Camera className="w-4 h-4" />
                  Scan QR
                </button>
                <button
                  onClick={() => { setFlowMode("search"); stopQRScanner(); }}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all
                    ${flowMode === "search"
                      ? "bg-background shadow-sm text-foreground"
                      : "text-muted-foreground hover:text-foreground"}`}
                >
                  <Search className="w-4 h-4" />
                  Search
                </button>
              </div>
            )}

            {/* Flow A: QR Scanner */}
            {isSignedIn && flowMode === "qr" && (
              <div className="rounded-2xl border border-border/60 bg-card p-6 space-y-5">
                {!isScanning ? (
                  <div className="flex flex-col items-center gap-5 py-4">
                    <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#0A84FF]/20 to-[#30D158]/10 flex items-center justify-center">
                      <QrCode className="w-10 h-10 text-[#0A84FF]" />
                    </div>
                    <div className="text-center">
                      <p className="font-medium text-foreground">Scan Session QR</p>
                      <p className="text-sm text-muted-foreground mt-1">Point your camera at the QR code displayed at the venue</p>
                    </div>
                    <Button
                      className="w-full h-12 rounded-xl text-sm font-semibold bg-gradient-to-r from-[#0A84FF] to-[#32ADE6] hover:opacity-90 border-0"
                      onClick={startQRScanner}
                    >
                      <Camera className="w-4 h-4 mr-2" />
                      Open Camera
                    </Button>
                    {scannerError && (
                      <p className="text-sm text-destructive text-center">{scannerError}</p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div
                      id="qr-reader"
                      className="rounded-xl overflow-hidden border-2 border-[#0A84FF]"
                    />
                    <Button variant="outline" className="w-full rounded-xl" onClick={stopQRScanner}>
                      Cancel Scan
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Flow B: Search */}
            {isSignedIn && flowMode === "search" && (
              <div className="rounded-2xl border border-border/60 bg-card p-6 space-y-4">
                <div className="relative">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by name or phone..."
                    value={searchQuery}
                    onChange={(e) => handleSearch(e.target.value)}
                    className="pl-10 h-11 rounded-xl bg-muted/40 border-transparent focus:border-[#0A84FF]/40"
                  />
                </div>

                {isSearching && (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                )}

                {searchResults.length > 0 && (
                  <div className="rounded-xl border border-border/60 divide-y overflow-hidden max-h-56 overflow-y-auto">
                    {searchResults.map((profile) => (
                      <button
                        key={profile.id}
                        onClick={() => handleProfileCheckIn(profile.id)}
                        disabled={checkInStatus === "loading"}
                        className="w-full px-4 py-3.5 text-left hover:bg-muted/50 transition-colors disabled:opacity-50 flex items-center gap-3"
                      >
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#0A84FF]/20 to-[#30D158]/10 flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-bold text-[#0A84FF]">
                            {profile.full_name.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div>
                          <div className="font-medium text-sm">{profile.full_name}</div>
                          {profile.phone && (
                            <div className="text-xs text-muted-foreground">{profile.phone}</div>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {searchQuery.length >= 2 && !isSearching && searchResults.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No members found. Try a different search.
                  </p>
                )}

                <div className="pt-2 border-t border-border/40">
                  <p className="text-xs text-muted-foreground text-center mb-3">Or check in directly with your account</p>
                  <Button
                    className="w-full h-12 rounded-xl text-sm font-semibold bg-gradient-to-r from-[#0A84FF] to-[#32ADE6] hover:opacity-90 border-0"
                    onClick={handleMemberCheckIn}
                    disabled={checkInStatus === "loading"}
                  >
                    {checkInStatus === "loading" ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Checking in…</>
                    ) : (
                      <><UserCheck className="w-4 h-4 mr-2" />Check Me In</>
                    )}
                  </Button>
                </div>
              </div>
            )}

            <p className="text-center text-xs text-muted-foreground">
              Not a member yet?{" "}
              <Link href="/register" className="text-[#0A84FF] hover:underline font-medium">
                Register as a first-timer
              </Link>
            </p>
          </div>
        )}
      </div>

      {/* Member vs First Timer Dialog */}
      <Dialog open={showMemberDialog} onOpenChange={setShowMemberDialog}>
        <DialogContent className="rounded-2xl max-w-sm">
          <DialogHeader>
            <DialogTitle>Welcome!</DialogTitle>
            <DialogDescription>
              Are you a returning member or is this your first time here?
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 pt-2">
            <Button
              onClick={handleMemberCheckIn}
              disabled={checkInStatus === "loading"}
              className="w-full h-12 rounded-xl bg-gradient-to-r from-[#0A84FF] to-[#32ADE6] hover:opacity-90 border-0"
            >
              {checkInStatus === "loading" ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Users className="w-4 h-4 mr-2" />
              )}
              I'm a Member
            </Button>
            <Button
              variant="outline"
              onClick={handleFirstTimer}
              className="w-full h-12 rounded-xl"
            >
              First Time Here
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* QR Generator Dialog */}
      <Dialog open={showQRGenerator} onOpenChange={setShowQRGenerator}>
        <DialogContent className="rounded-2xl max-w-sm">
          <DialogHeader>
            <DialogTitle>Today's Check-In QR</DialogTitle>
            <DialogDescription>Display this for members to scan and check in</DialogDescription>
          </DialogHeader>
          <div className="flex justify-center py-6">
            {generatedQR && (
              <div className="bg-white p-4 rounded-2xl shadow-sm">
                <QRCodeDisplay url={generatedQR} size={220} />
              </div>
            )}
          </div>
          <Button variant="outline" onClick={() => setShowQRGenerator(false)} className="w-full rounded-xl">
            Close
          </Button>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
