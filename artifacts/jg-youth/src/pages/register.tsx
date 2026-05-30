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
  SelectValue,
  SelectTrigger,
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
  school: z.string().min(2, "School name is required"),
  parent_phone: z.string().min(10, "Parent/Guardian phone is required").max(15),
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
      school: "",
      parent_phone: "",
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
        },
        body: JSON.stringify({
          full_name: data.full_name,
          phone_number: data.phone_number,
          email: data.email === "" ? null : (data.email ?? null),
          gender: data.gender,
          age: parseInt(String(data.age), 10),
          how_did_you_hear: data.how_did_you_hear,
          school: data.school,
          parent_phone: data.parent_phone,
        }),
      });

      if (response.status === 201) {
        if (data.email) {
          sessionStorage.setItem("jg_pending_signup_email", data.email);
          sessionStorage.setItem("jg_pending_signup_name", data.full_name);
        }
        setIsSuccess(true);
        return;
      }

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
          <Card className="border-slate-700/80 bg-slate-800/90 text-white shadow-xl overflow-hidden relative">
            <div className="absolute top-0 left-0 w-full h-2 bg-primary" />
            <CardHeader className="text-center pb-2 pt-8">
              <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
                <CheckCircle2 className="w-8 h-8 text-primary" />
              </div>
              <CardTitle className="text-2xl">You're registered!</CardTitle>
              <CardDescription className="text-base mt-2 text-slate-300">
                Registered! A leader will approve your check-in.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6 pb-8 space-y-4">
              <div className="bg-slate-950/40 border border-slate-700/50 p-4 rounded-lg text-sm text-center text-slate-300">
                Please wait while a leader reviews and approves your check-in
                request. You'll be called up once approved.
              </div>
              <div className="flex flex-col gap-3 pt-2">
                <Link href="/">
                  <Button className="w-full bg-teal-500 hover:bg-teal-400 text-white border-0 rounded-xl" size="lg">
                    Return Home
                  </Button>
                </Link>
              </div>
              <p className="text-xs text-slate-400 text-center pt-1">
                Once a leader approves your membership request, you will receive an email with a link to create your login.
              </p>
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  // ── Registration form ────────────────────────────────────────────────────────
  return (
    <Layout>
      <div className="max-w-xl mx-auto py-8 px-4">
        <div className="mb-6">
          <Link href="/">
            <Button
              variant="ghost"
              size="sm"
              className="-ml-3 text-muted-foreground hover:bg-slate-800/50 hover:text-white"
            >
              <ChevronLeft className="w-4 h-4 mr-1" />
              Back
            </Button>
          </Link>
        </div>

        <Card className="shadow-2xl border-slate-700 bg-slate-800/90 text-white overflow-hidden">
          {/* Colourful accent stripe at top */}
          <div className="h-1.5 w-full bg-gradient-to-r from-primary via-teal-400 to-primary/60" />
          <CardHeader className="pb-4 pt-6">
            <CardTitle className="text-2xl text-white font-bold">First Timer Registration</CardTitle>
            <CardDescription className="text-slate-300 text-sm leading-relaxed">
              Welcome! Please fill in your details so we can get to know you
              better.
            </CardDescription>
          </CardHeader>
          <CardContent className="pb-8">
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
                         <FormLabel className="text-slate-200">Full Name *</FormLabel>
                         <FormControl>
                           <Input
                             placeholder="John Doe"
                             className="bg-slate-950/50 border-slate-700 text-white placeholder:text-slate-500 focus:border-teal-500 focus:ring-teal-500 rounded-xl h-11"
                             {...field}
                           />
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
                          <FormLabel className="text-slate-200">Phone Number *</FormLabel>
                          <FormControl>
                            <Input
                              type="tel"
                              placeholder="082 123 4567"
                              className="bg-slate-950/50 border-slate-700 text-white placeholder:text-slate-500 focus:border-teal-500 focus:ring-teal-500 rounded-xl h-11"
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
                          <FormLabel className="text-slate-200">Email <span className="text-slate-400 text-xs font-normal">(optional)</span></FormLabel>
                          <FormControl>
                            <Input
                              type="email"
                              placeholder="john@example.com"
                              className="bg-slate-950/50 border-slate-700 text-white placeholder:text-slate-500 focus:border-teal-500 focus:ring-teal-500 rounded-xl h-11"
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
                          <FormLabel className="text-slate-200">Gender *</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            defaultValue={field.value}
                          >
                            <FormControl>
                              <SelectTrigger className="bg-slate-950/50 border-slate-700 text-white focus:border-teal-500 focus:ring-teal-500 rounded-xl h-11">
                                <SelectValue placeholder="Select gender" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent className="bg-slate-900 border-slate-800 text-white">
                              <SelectItem value="male" className="focus:bg-slate-800 focus:text-white">Male</SelectItem>
                              <SelectItem value="female" className="focus:bg-slate-800 focus:text-white">Female</SelectItem>
                              <SelectItem value="other" className="focus:bg-slate-800 focus:text-white">Other</SelectItem>
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
                          <FormLabel className="text-slate-200">Age *</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              min={10}
                              max={100}
                              className="bg-slate-950/50 border-slate-700 text-white focus:border-teal-500 focus:ring-teal-500 rounded-xl h-11"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* School + Parent Phone */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="school"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-slate-200">School / High School *</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="e.g. Waterberg High School"
                              className="bg-slate-950/50 border-slate-700 text-white placeholder:text-slate-500 focus:border-teal-500 focus:ring-teal-500 rounded-xl h-11"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="parent_phone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-slate-200">Parent / Guardian Phone *</FormLabel>
                          <FormControl>
                            <Input
                              type="tel"
                              placeholder="072 123 4567"
                              className="bg-slate-950/50 border-slate-700 text-white placeholder:text-slate-500 focus:border-teal-500 focus:ring-teal-500 rounded-xl h-11"
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
                        <FormLabel className="text-slate-200">How did you hear about us? *</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Friend, Social Media, etc."
                            className="bg-slate-950/50 border-slate-700 text-white placeholder:text-slate-500 focus:border-teal-500 focus:ring-teal-500 rounded-xl h-11"
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
                  className="w-full text-base h-12 bg-gradient-to-r from-primary to-teal-400 hover:from-primary/90 hover:to-teal-400/90 text-white font-semibold rounded-xl shadow-md border-0 transition-all duration-200"
                  disabled={isPending}
                >
                  {isPending ? "Registering..." : "Register →"}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
