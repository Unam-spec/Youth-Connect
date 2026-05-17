import { useState } from "react";
import { useAuth } from "@clerk/react";
import { Redirect, Link } from "wouter";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle2,
  ChevronLeft,
  Clock,
  Loader2,
  LogIn,
  UserCheck,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type CheckInStatus = "idle" | "loading" | "approved" | "pending" | "error";

interface CheckInResult {
  status: "approved" | "pending";
  message: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CheckIn() {
  const { toast } = useToast();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const [checkInStatus, setCheckInStatus] = useState<CheckInStatus>("idle");
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");

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

  // Redirect unauthenticated users to sign-in
  if (!isSignedIn) {
    return <Redirect to="/sign-in" />;
  }

  async function handleSelfCheckIn() {
    setCheckInStatus("loading");
    setErrorMessage("");

    try {
      // Always attach the Clerk JWT — the backend extracts the member_id from
      // the token and never trusts a profile_id sent in the request body.
      const token = await getToken();
      const response = await fetch("/api/checkin/requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        // Empty body — the backend resolves the member from the auth token
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

      // Success — status is either "approved" (leader) or "pending" (member)
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
      <div className="max-w-md mx-auto py-8">
        <div className="mb-6">
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
        </div>

        <Card className="shadow-lg border-border/60">
          <CardHeader>
            <CardTitle className="text-2xl">Friday Night Check-In</CardTitle>
            <CardDescription>
              Tap the button below to check yourself in for tonight's session.
              Check-in is available on Fridays between 18:30 and 22:00 SAST.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pb-8">
            {/* Error message */}
            {checkInStatus === "error" && errorMessage && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {errorMessage}
              </div>
            )}

            <Button
              className="w-full h-14 text-base"
              size="lg"
              onClick={handleSelfCheckIn}
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

        {/* Leader portal link */}
        <p className="text-center text-sm text-muted-foreground mt-6">
          <Link
            href="/leader-login"
            className="inline-flex items-center gap-1 hover:text-primary underline underline-offset-4"
          >
            <LogIn className="w-3.5 h-3.5" />
            Leader portal
          </Link>
        </p>
      </div>
    </Layout>
  );
}
