import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@clerk/react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useVerifyLeaderPin } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { setLeaderSession } from "@/lib/auth";
import { ChevronLeft, Lock, Loader2 } from "lucide-react";
import { Link, useLocation } from "wouter";

const pinOnlySchema = z.object({
  pin: z
    .string()
    .min(4, "PIN must be at least 4 digits")
    .max(6, "PIN max 6 digits"),
});

const fullLoginSchema = z.object({
  phone: z.string().min(10, "Phone number required").max(15),
  pin: z
    .string()
    .min(4, "PIN must be at least 4 digits")
    .max(6, "PIN max 6 digits"),
});

type PinOnlyFormValues = z.infer<typeof pinOnlySchema>;
type FullLoginFormValues = z.infer<typeof fullLoginSchema>;

export default function LeaderLogin() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const verifyPin = useVerifyLeaderPin();

  // "checking" = resolving Clerk session, "pin-only" = Clerk session found (leader),
  // "full" = no Clerk session (phone + PIN), "redirecting" = super_admin bypass
  const [mode, setMode] = useState<
    "checking" | "pin-only" | "full" | "redirecting"
  >("checking");

  // Resolve Clerk session on mount
  useEffect(() => {
    if (!isLoaded) return;

    if (!isSignedIn) {
      setMode("full");
      return;
    }

    // Clerk session exists — fetch profile to determine role
    (async () => {
      try {
        const token = await getToken();
        const response = await fetch("/api/profiles/me", {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        });

        if (!response.ok) {
          setMode("full");
          return;
        }

        const profile = await response.json();

        if (profile.role === "super_admin") {
          // Super admin: set session and skip PIN screen entirely
          setLeaderSession({ role: "super_admin", profile_id: profile.id });
          setMode("redirecting");
          setLocation("/dashboard");
          return;
        }

        if (profile.role === "leader") {
          // Leader with Clerk session: show PIN-only screen
          setMode("pin-only");
          return;
        }

        // Not a leader or super_admin — fall back to full login
        setMode("full");
      } catch {
        setMode("full");
      }
    })();
  }, [isLoaded, isSignedIn, getToken, setLocation]);

  // PIN-only form (for Clerk-authenticated leaders)
  const pinOnlyForm = useForm<PinOnlyFormValues>({
    resolver: zodResolver(pinOnlySchema),
    defaultValues: { pin: "" },
  });

  // Full login form (phone + PIN, no Clerk session)
  const fullForm = useForm<FullLoginFormValues>({
    resolver: zodResolver(fullLoginSchema),
    defaultValues: { phone: "", pin: "" },
  });

  async function onPinOnlySubmit(data: PinOnlyFormValues) {
    try {
      const token = await getToken();
      const response = await fetch("/api/profiles/me", {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        toast({
          title: "Error",
          description: "Could not fetch profile.",
          variant: "destructive",
        });
        return;
      }

      const profile = await response.json();

      // Verify PIN via the standard verify-pin endpoint using the profile's phone
      verifyPin.mutate(
        { data: { phone: profile.phone, pin: data.pin } },
        {
          onSuccess: (result) => {
            if (result.success && result.profile_id) {
              setLeaderSession({
                role: result.role,
                profile_id: result.profile_id,
              });
              toast({ title: "Welcome back, leader." });
              setLocation("/dashboard");
            } else {
              toast({
                title: "Login Failed",
                description: "Invalid PIN.",
                variant: "destructive",
              });
            }
          },
          onError: (error) => {
            toast({
              title: "Login Error",
              description: error.message || "Unable to verify PIN.",
              variant: "destructive",
            });
          },
        },
      );
    } catch {
      toast({
        title: "Error",
        description: "Could not verify PIN.",
        variant: "destructive",
      });
    }
  }

  function onFullSubmit(data: FullLoginFormValues) {
    verifyPin.mutate(
      { data },
      {
        onSuccess: (result) => {
          if (result.success && result.profile_id) {
            setLeaderSession({
              role: result.role,
              profile_id: result.profile_id,
            });
            toast({ title: "Welcome back, leader." });
            setLocation("/dashboard");
          } else {
            toast({
              title: "Login Failed",
              description: "Invalid phone number or PIN.",
              variant: "destructive",
            });
          }
        },
        onError: (error) => {
          toast({
            title: "Login Error",
            description: error.message || "Unable to verify PIN.",
            variant: "destructive",
          });
        },
      },
    );
  }

  // Loading / redirecting states
  if (mode === "checking" || mode === "redirecting") {
    return (
      <Layout>
        <div className="max-w-md mx-auto py-12 flex flex-col items-center justify-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-muted-foreground text-sm">
            {mode === "redirecting"
              ? "Redirecting to dashboard…"
              : "Checking session…"}
          </p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-md mx-auto py-12">
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

        <Card className="shadow-2xl border-primary/20 bg-card overflow-hidden">
          <div className="h-1.5 w-full bg-primary" />
          <CardHeader className="text-center pt-8">
            <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
              <Lock className="w-6 h-6 text-primary" />
            </div>
            <CardTitle className="text-2xl">Leader Access</CardTitle>
            <CardDescription>
              {mode === "pin-only"
                ? "Enter your PIN to access the leader dashboard."
                : "Enter your phone number and PIN to access the leader dashboard."}
            </CardDescription>
          </CardHeader>
          <CardContent className="pb-8">
            {mode === "pin-only" ? (
              /* ── PIN-only form (Clerk session, leader role) ── */
              <Form {...pinOnlyForm}>
                <form
                  onSubmit={pinOnlyForm.handleSubmit(onPinOnlySubmit)}
                  className="space-y-5"
                >
                  <FormField
                    control={pinOnlyForm.control}
                    name="pin"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>PIN</FormLabel>
                        <FormControl>
                          <Input
                            type="password"
                            placeholder="••••"
                            maxLength={6}
                            className="h-12 text-center text-lg tracking-[0.5em] font-mono"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button
                    type="submit"
                    className="w-full h-12 mt-2"
                    disabled={verifyPin.isPending}
                  >
                    {verifyPin.isPending ? "Verifying..." : "Access Dashboard"}
                  </Button>
                </form>
              </Form>
            ) : (
              /* ── Full login form (no Clerk session) ── */
              <Form {...fullForm}>
                <form
                  onSubmit={fullForm.handleSubmit(onFullSubmit)}
                  className="space-y-5"
                >
                  <FormField
                    control={fullForm.control}
                    name="phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Phone Number</FormLabel>
                        <FormControl>
                          <Input
                            type="tel"
                            placeholder="082 123 4567"
                            className="h-12"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={fullForm.control}
                    name="pin"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>PIN</FormLabel>
                        <FormControl>
                          <Input
                            type="password"
                            placeholder="••••"
                            maxLength={6}
                            className="h-12 text-center text-lg tracking-[0.5em] font-mono"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Button
                    type="submit"
                    className="w-full h-12 mt-2"
                    disabled={verifyPin.isPending}
                  >
                    {verifyPin.isPending ? "Verifying..." : "Access Dashboard"}
                  </Button>
                </form>
              </Form>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
