import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Link } from "wouter";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AlertCircle, CheckCircle2, ChevronLeft } from "lucide-react";
import { useState } from "react";

// ─── Client-side validation schema ────────────────────────────────────────────
// Field names match the public POST /api/register endpoint exactly.
const registerSchema = z.object({
  full_name: z.string().min(2, "Full name must be at least 2 characters"),
  phone_number: z
    .string()
    .min(10, "Valid phone number is required")
    .max(15, "Phone number is too long"),
  email: z.string().email("Invalid email address").optional().or(z.literal("")),
  gender: z.enum(["male", "female", "other"], {
    required_error: "Please select a gender",
  }),
  age: z.coerce
    .number({ invalid_type_error: "Age must be a number" })
    .int("Age must be a whole number")
    .min(10, "Age must be at least 10")
    .max(100, "Age must be at most 100"),
  how_did_you_hear: z.string().min(2, "Please tell us how you heard about us"),
});

type RegisterFormValues = z.infer<typeof registerSchema>;

export default function Register() {
  const [isSuccess, setIsSuccess] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      full_name: "",
      phone_number: "",
      email: "",
      gender: "male",
      age: 18,
      how_did_you_hear: "",
    },
  });

  // ── Submit handler ───────────────────────────────────────────────────────────
  // Calls the fully-public POST /api/register endpoint.
  // No Authorization header — this is intentionally unauthenticated.
  async function onSubmit(data: RegisterFormValues) {
    setIsPending(true);
    setServerError(null);

    try {
      const response = await fetch("/api/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // No Authorization header — public endpoint
        },
        body: JSON.stringify({
          full_name: data.full_name,
          phone_number: data.phone_number,
          // Convert empty string to null before sending
          email: data.email === "" ? null : (data.email ?? null),
          gender: data.gender,
          // Ensure age is sent as an integer
          age: parseInt(String(data.age), 10),
          how_did_you_hear: data.how_did_you_hear,
        }),
      });

      if (response.status === 201) {
        setIsSuccess(true);
        return;
      }

      // Surface the exact server error message so developers can debug
      const errorData = await response.json().catch(() => ({}));
      setServerError(
        errorData.error ||
          `Registration failed with status ${response.status}. Please try again.`,
      );
    } catch (networkErr: any) {
      setServerError(
        networkErr?.message
          ? `Network error: ${networkErr.message}`
          : "Network error — please check your connection and try again.",
      );
    } finally {
      setIsPending(false);
    }
  }

  // ── Success state ────────────────────────────────────────────────────────────
  if (isSuccess) {
    return (
      <Layout>
        <div className="max-w-md mx-auto pt-10">
          <Card className="border-primary/20 shadow-xl overflow-hidden relative">
            <div className="absolute top-0 left-0 w-full h-2 bg-primary" />
            <CardHeader className="text-center pb-2 pt-8">
              <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
                <CheckCircle2 className="w-8 h-8 text-primary" />
              </div>
              <CardTitle className="text-2xl">You're registered!</CardTitle>
              <CardDescription className="text-base mt-2">
                Registered! A leader will approve your check-in.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6 pb-8 space-y-4">
              <div className="bg-muted p-4 rounded-lg text-sm text-center text-muted-foreground">
                Please wait while a leader reviews and approves your check-in
                request. You'll be called up once approved.
              </div>
              <div className="flex flex-col gap-3 pt-2">
                <Link href="/">
                  <Button className="w-full" size="lg">
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

  // ── Registration form ────────────────────────────────────────────────────────
  return (
    <Layout>
      <div className="max-w-xl mx-auto py-8">
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
            <CardTitle className="text-2xl">First Timer Registration</CardTitle>
            <CardDescription>
              Welcome! Please fill in your details so we can get to know you
              better.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Server-side error banner */}
            {serverError && (
              <div className="mb-5 flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{serverError}</span>
              </div>
            )}

            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-6"
              >
                <div className="space-y-4">
                  {/* Full Name */}
                  <FormField
                    control={form.control}
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

                  {/* Phone + Email */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="phone_number"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Phone Number *</FormLabel>
                          <FormControl>
                            <Input
                              type="tel"
                              placeholder="082 123 4567"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
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
                  </div>

                  {/* Gender + Age */}
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
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
                      control={form.control}
                      name="age"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Age *</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              min={10}
                              max={100}
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* How did you hear */}
                  <FormField
                    control={form.control}
                    name="how_did_you_hear"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>How did you hear about us? *</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Friend, Social Media, etc."
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <Button
                  type="submit"
                  className="w-full text-base h-12"
                  disabled={isPending}
                >
                  {isPending ? "Registering..." : "Register"}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
