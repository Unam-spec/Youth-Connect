import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Layout } from "@/components/layout";
import { useApiFetch } from "@/lib/api";
import { useRegisterVisitor } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useSearchForCheckIn,
  getSearchForCheckInQueryKey,
  useCheckIn,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle2,
  ChevronLeft,
  QrCode,
  Search,
  User,
  UserCheck,
  X,
} from "lucide-react";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const searchSchema = z.object({
  query: z.string().min(2, "Enter at least 2 characters to search"),
});

const registerSchema = z.object({
  full_name: z.string().min(2, "Full name is required"),
  phone: z.string().min(10, "Valid phone number is required").max(15),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  gender: z.enum(["male", "female", "other"]),
  age: z.coerce.number().min(10).max(100),
  heard_from: z.string().min(2, "Please tell us how you heard about us"),
});

type RegisterFormValues = z.infer<typeof registerSchema>;

export default function CheckIn() {
  const { toast } = useToast();
  const apiFetch = useApiFetch();
  const registerVisitor = useRegisterVisitor();
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [hasSearched, setHasSearched] = useState(false);
  const [successProfile, setSuccessProfile] = useState<{
    name: string;
    role: string;
  } | null>(null);
  const [showQrScanner, setShowQrScanner] = useState(false);
  const [showCheckInPrompt, setShowCheckInPrompt] = useState(false);
  const [showRegisterForm, setShowRegisterForm] = useState(false);

  const form = useForm<z.infer<typeof searchSchema>>({
    resolver: zodResolver(searchSchema),
    defaultValues: { query: "" },
  });

  const registerForm = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      full_name: "",
      phone: "",
      email: "",
      gender: "male",
      age: 18,
      heard_from: "",
    },
  });

  async function handleRegister(data: RegisterFormValues) {
    registerVisitor.mutate(
      {
        data: {
          ...data,
          email: data.email || null,
        },
      },
      {
        onSuccess: async () => {
          // Submit check-in request for first timer
          try {
            await apiFetch("/api/checkin/requests", {
              method: "POST",
            });
          } catch (error) {
            console.error("Failed to submit check-in request:", error);
          }
          setShowRegisterForm(false);
          toast({
            title: "Registration successful",
            description: "Check-in request submitted - pending approval",
          });
          registerForm.reset();
        },
        onError: (error) => {
          toast({
            title: "Registration Failed",
            description:
              error.message || "An error occurred during registration",
            variant: "destructive",
          });
        },
      },
    );
  }

  const { data: searchResults, isLoading: isSearching } = useSearchForCheckIn(
    { query: searchQuery },
    {
      query: {
        enabled: searchQuery.length >= 2,
        queryKey: getSearchForCheckInQueryKey({ query: searchQuery }),
      },
    },
  );

  const checkInMutation = useCheckIn();

  function onSearchSubmit(data: z.infer<typeof searchSchema>) {
    setSearchQuery(data.query);
    setHasSearched(true);
  }

  function handleCheckIn(profileId: string, name: string, role: string) {
    checkInMutation.mutate(
      {
        data: {
          profile_id: profileId,
          check_in_method: "self",
        },
      },
      {
        onSuccess: () => {
          setSuccessProfile({ name, role });
          toast({
            title: "Check-in Successful",
            description: `Welcome, ${name}!`,
          });
        },
        onError: (error) => {
          toast({
            title: "Check-in Failed",
            description: error.message || "An error occurred.",
            variant: "destructive",
          });
        },
      },
    );
  }

  if (successProfile) {
    return (
      <Layout>
        <div className="max-w-md mx-auto pt-10">
          <Card className="border-green-500/30 shadow-xl overflow-hidden relative">
            <div className="absolute top-0 left-0 w-full h-2 bg-green-500"></div>
            <CardHeader className="text-center pb-4 pt-8">
              <div className="mx-auto w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center mb-4">
                <CheckCircle2 className="w-10 h-10 text-green-500" />
              </div>
              <CardTitle className="text-3xl">Checked In!</CardTitle>
              <CardDescription className="text-lg mt-2 font-medium text-foreground">
                {successProfile.name}
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-2 pb-8 space-y-6">
              <p className="text-center text-muted-foreground">
                You're all set. Enjoy the service!
              </p>
              <div className="flex flex-col gap-3 pt-2">
                <Button
                  className="w-full"
                  size="lg"
                  onClick={() => {
                    setSuccessProfile(null);
                    setSearchQuery("");
                    setHasSearched(false);
                    form.reset();
                  }}
                >
                  Check In Another Person
                </Button>
                <Link href="/">
                  <Button variant="outline" className="w-full">
                    Return Home
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-xl mx-auto py-8">
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
          <Link
            href="/leader-login"
            className="text-sm text-muted-foreground hover:text-primary underline underline-offset-4"
          >
            Are you a leader?
          </Link>
        </div>

        <Card className="shadow-lg border-border/60">
          <CardHeader>
            <CardTitle className="text-2xl">Self Check-In</CardTitle>
            <CardDescription>
              Search for your name or phone number to check in for today.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSearchSubmit)}
                className="flex gap-2"
              >
                <FormField
                  control={form.control}
                  name="query"
                  render={({ field }) => (
                    <FormItem className="flex-1 space-y-0">
                      <FormControl>
                        <div className="relative">
                          <Search className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
                          <Input
                            placeholder="Name or phone number..."
                            className="pl-10 h-12 text-base"
                            {...field}
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="h-12 px-6">
                  Search
                </Button>
              </form>
            </Form>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">Or</span>
              </div>
            </div>

            <Button
              variant="outline"
              className="w-full h-12 text-base"
              onClick={() => {
                const now = new Date();
                const day = now.getDay(); // 0 = Sunday, 5 = Friday
                const hours = now.getHours();
                const minutes = now.getMinutes();
                const currentTime = hours * 60 + minutes; // Minutes since midnight
                const targetTime = 18 * 60 + 30; // 18:30 in minutes

                if (day === 5 && currentTime >= targetTime) {
                  setShowQrScanner(true);
                } else {
                  toast({
                    title: "Check-in unavailable",
                    description:
                      "Check-in is only available on Fridays at 18:30",
                    variant: "destructive",
                  });
                }
              }}
            >
              <QrCode className="w-5 h-5 mr-2" />
              Scan QR Code
            </Button>

            <div className="mt-8">
              {isSearching ? (
                <div className="space-y-3">
                  <Skeleton className="h-16 w-full rounded-lg" />
                  <Skeleton className="h-16 w-full rounded-lg" />
                </div>
              ) : hasSearched && searchResults ? (
                searchResults.length > 0 ? (
                  <div className="space-y-3">
                    <h3 className="text-sm font-medium text-muted-foreground mb-3 uppercase tracking-wider">
                      Select your profile
                    </h3>
                    {searchResults.map((profile) => (
                      <div
                        key={profile.id}
                        className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-accent/5 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                            <User className="w-5 h-5" />
                          </div>
                          <div>
                            <p className="font-medium text-foreground">
                              {profile.full_name}
                            </p>
                            <p className="text-sm text-muted-foreground capitalize">
                              {profile.role}
                            </p>
                          </div>
                        </div>
                        <Button
                          onClick={() =>
                            handleCheckIn(
                              profile.id,
                              profile.full_name,
                              profile.role,
                            )
                          }
                          disabled={checkInMutation.isPending}
                          size="sm"
                        >
                          <UserCheck className="w-4 h-4 mr-1.5" />
                          Check In
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-10 border rounded-lg border-dashed">
                    <User className="mx-auto h-10 w-10 text-muted-foreground mb-3 opacity-20" />
                    <p className="text-muted-foreground mb-4">
                      No profiles found matching "{searchQuery}".
                    </p>
                    <Link href="/register">
                      <Button variant="outline">Register as First Timer</Button>
                    </Link>
                  </div>
                )
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* QR Scanner Dialog */}
      <Dialog open={showQrScanner} onOpenChange={setShowQrScanner}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Scan QR Code</DialogTitle>
            <DialogDescription>
              Point your camera at the QR code to check in.
            </DialogDescription>
          </DialogHeader>
          <div className="py-8 flex items-center justify-center">
            <div className="w-64 h-64 border-2 border-dashed border-muted-foreground/30 rounded-lg flex items-center justify-center">
              <QrCode className="w-16 h-16 text-muted-foreground/50" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowQrScanner(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setShowQrScanner(false);
                setShowCheckInPrompt(true);
              }}
            >
              Simulate Scan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Check-in Type Prompt Dialog */}
      <Dialog open={showCheckInPrompt} onOpenChange={setShowCheckInPrompt}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Check-in Type</DialogTitle>
            <DialogDescription>
              Are you a member checking in or a first timer?
            </DialogDescription>
          </DialogHeader>
          <div className="py-6 space-y-3">
            <Button
              className="w-full h-12 text-base"
              onClick={async () => {
                try {
                  const response = await apiFetch("/api/checkin/requests", {
                    method: "POST",
                  });
                  if (!response.ok) {
                    const error = await response.json();
                    toast({
                      title: "Check-in failed",
                      description: error.error || "An error occurred",
                      variant: "destructive",
                    });
                    return;
                  }
                  setShowCheckInPrompt(false);
                  toast({
                    title: "Check-in request submitted - pending approval",
                  });
                } catch (error) {
                  toast({
                    title: "Check-in failed",
                    description: "An error occurred",
                    variant: "destructive",
                  });
                }
              }}
            >
              Member Check-in
            </Button>
            <Button
              variant="outline"
              className="w-full h-12 text-base"
              onClick={() => {
                setShowCheckInPrompt(false);
                setShowRegisterForm(true);
              }}
            >
              First Timer
            </Button>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowCheckInPrompt(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showRegisterForm} onOpenChange={setShowRegisterForm}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>First Timer Registration</DialogTitle>
            <DialogDescription>
              Please fill in your details to register as a first-time visitor
            </DialogDescription>
          </DialogHeader>
          <Form {...registerForm}>
            <form
              onSubmit={registerForm.handleSubmit(handleRegister)}
              className="space-y-4"
            >
              <FormField
                control={registerForm.control}
                name="full_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full Name *</FormLabel>
                    <FormControl>
                      <Input placeholder="John Doe" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={registerForm.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone Number *</FormLabel>
                    <FormControl>
                      <Input type="tel" placeholder="082 123 4567" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={registerForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email (Optional)</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="john@example.com"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={registerForm.control}
                  name="gender"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Gender *</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select gender" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="male">Male</SelectItem>
                          <SelectItem value="female">Female</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={registerForm.control}
                  name="age"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Age *</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={registerForm.control}
                name="heard_from"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>How did you hear about us? *</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Friend, social media, etc."
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => setShowRegisterForm(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={registerVisitor.isPending}>
                  {registerVisitor.isPending ? "Registering..." : "Register"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
