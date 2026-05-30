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
import { AlertCircle, CheckCircle2, ChevronLeft, GraduationCap, Check, BookOpen, User, Phone, ChevronDown, XCircle } from "lucide-react";
import { useState, useRef, useEffect } from "react";

// ─── Client-side validation schema ────────────────────────────────────────────
// Field names match the public POST /api/register endpoint exactly.
const registerSchema = z.object({
  full_name: z.string().min(2, "Full name must be at least 2 characters"),
  phone_number: z
    .string()
    .min(10, "Valid phone number is required")
    .max(15, "Phone number is too long"),
  email: z.string().email("Invalid email address").min(1, "Email is required"),
  gender: z.enum(["male", "female"], {
    required_error: "Please select a gender",
  }),
  age: z.coerce
    .number({ invalid_type_error: "Age must be a number" })
    .int("Age must be a whole number")
    .min(10, "Age must be at least 10")
    .max(100, "Age must be at most 100"),
  how_did_you_hear: z.string().min(2, "Please tell us how you heard about us"),
  school: z.string().min(2, "School/University is required"),
  parent_name: z.string().min(2, "Parent/Guardian name is required"),
  parent_phone: z.string().min(10, "Parent/Guardian phone is required").max(15),
  whatsapp_opt_in: z.boolean().default(false),
});

type RegisterFormValues = z.infer<typeof registerSchema>;

const WATERBERG_SCHOOLS = [
  "Paresis Secondary",
  "Otjiwarongo Secondary",
  "Waterberg High",
  "Edugate Academy"
];

const SA_UNIVERSITIES = [
  "UP",
  "UCT",
  "Wits",
  "Stellenbosch",
  "UJ",
  "UNISA",
  "DUT",
  "UKZN",
  "NWU",
  "UFS",
  "WSU",
  "MUT",
  "CUT",
  "UFH",
  "UWC",
  "RU",
  "SMU",
  "VUT",
  "TUT",
  "CPUT",
  "NMU"
];

const NONE_SCHOOL = "None / Completed Schooling";

export default function Register() {
  const [isSuccess, setIsSuccess] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const [schoolQuery, setSchoolQuery] = useState("");
  const [showSchoolDropdown, setShowSchoolDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowSchoolDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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
      parent_name: "",
      parent_phone: "",
      whatsapp_opt_in: false,
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
          parent_name: data.parent_name,
          parent_phone: data.parent_phone,
          whatsapp_opt_in: data.whatsapp_opt_in,
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
              <CardTitle className="text-2xl">Registration Received</CardTitle>
              <CardDescription className="text-base mt-2 text-slate-350">
                God bless you! Your registration has been received. A leader will be in touch soon.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6 pb-8">
              <div className="flex flex-col gap-3 pt-2">
                <Link href="/">
                  <Button className="w-full bg-teal-500 hover:bg-teal-400 text-white border-0 rounded-xl" size="lg">
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
                          <FormLabel className="text-slate-200">Email *</FormLabel>
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

                  {/* Google Maps School / University Autocomplete Combobox */}
                  <FormField
                    control={form.control}
                    name="school"
                    render={({ field }) => {
                      const query = (field.value || "").toLowerCase();
                      const filteredWaterberg = WATERBERG_SCHOOLS.filter(s => s.toLowerCase().includes(query));
                      const filteredUni = SA_UNIVERSITIES.filter(s => s.toLowerCase().includes(query));
                      const showNone = NONE_SCHOOL.toLowerCase().includes(query);

                      return (
                        <FormItem className="relative">
                          <FormLabel className="text-slate-200">School / University *</FormLabel>
                          <div className="relative" ref={dropdownRef}>
                            <FormControl>
                              <Input
                                value={field.value || schoolQuery}
                                onChange={(e) => {
                                  field.onChange(e.target.value);
                                  setSchoolQuery(e.target.value);
                                  setShowSchoolDropdown(true);
                                }}
                                onFocus={() => setShowSchoolDropdown(true)}
                                placeholder="Start typing school or university..."
                                className="bg-slate-950/50 border-slate-700 text-white placeholder:text-slate-500 focus:border-teal-500 focus:ring-teal-500 rounded-xl h-11 pr-10"
                              />
                            </FormControl>
                            <div className="absolute right-3 top-3 text-slate-400">
                              <GraduationCap className="w-5 h-5" />
                            </div>
                            {showSchoolDropdown && (
                              <div className="absolute z-50 w-full mt-1 bg-slate-900 border border-slate-800 rounded-xl shadow-xl max-h-60 overflow-y-auto backdrop-blur-md">
                                {/* Waterberg District schools */}
                                {filteredWaterberg.length > 0 && (
                                  <>
                                    <div className="px-3 py-1.5 text-2xs font-semibold text-slate-500 uppercase tracking-wider bg-slate-950/20">
                                      Waterberg Schools
                                    </div>
                                    {filteredWaterberg.map((schoolName) => (
                                      <div
                                        key={schoolName}
                                        onClick={() => {
                                          field.onChange(schoolName);
                                          setSchoolQuery(schoolName);
                                          setShowSchoolDropdown(false);
                                        }}
                                        className="px-4 py-2 text-sm text-slate-200 hover:bg-teal-500/20 hover:text-teal-400 cursor-pointer flex items-center justify-between transition-colors duration-150"
                                      >
                                        <span className="flex items-center gap-2">
                                          <BookOpen className="w-3.5 h-3.5 text-teal-550/60" />
                                          {schoolName}
                                        </span>
                                        {field.value === schoolName && <Check className="w-3.5 h-3.5 text-teal-400" />}
                                      </div>
                                    ))}
                                  </>
                                )}

                                {/* Divider */}
                                {filteredWaterberg.length > 0 && filteredUni.length > 0 && (
                                  <div className="h-px bg-slate-800 my-1" />
                                )}

                                {/* South African universities */}
                                {filteredUni.length > 0 && (
                                  <>
                                    <div className="px-3 py-1.5 text-2xs font-semibold text-slate-500 uppercase tracking-wider bg-slate-950/20">
                                      South African Universities
                                    </div>
                                    {filteredUni.map((schoolName) => (
                                      <div
                                        key={schoolName}
                                        onClick={() => {
                                          field.onChange(schoolName);
                                          setSchoolQuery(schoolName);
                                          setShowSchoolDropdown(false);
                                        }}
                                        className="px-4 py-2 text-sm text-slate-200 hover:bg-teal-500/20 hover:text-teal-400 cursor-pointer flex items-center justify-between transition-colors duration-150"
                                      >
                                        <span className="flex items-center gap-2">
                                          <GraduationCap className="w-3.5 h-3.5 text-teal-550/60" />
                                          {schoolName}
                                        </span>
                                        {field.value === schoolName && <Check className="w-3.5 h-3.5 text-teal-400" />}
                                      </div>
                                    ))}
                                  </>
                                )}

                                {/* Divider */}
                                {((filteredWaterberg.length > 0 || filteredUni.length > 0) && showNone) && (
                                  <div className="h-px bg-slate-800 my-1" />
                                )}

                                {/* None Option */}
                                {showNone && (
                                  <div
                                    onClick={() => {
                                      field.onChange(NONE_SCHOOL);
                                      setSchoolQuery(NONE_SCHOOL);
                                      setShowSchoolDropdown(false);
                                    }}
                                    className="px-4 py-2 text-sm text-slate-300 hover:bg-teal-500/20 hover:text-teal-400 cursor-pointer flex items-center justify-between transition-colors duration-150"
                                  >
                                    <span className="flex items-center gap-2 font-medium">
                                      <XCircle className="w-3.5 h-3.5 text-slate-500/65" />
                                      {NONE_SCHOOL}
                                    </span>
                                    {field.value === NONE_SCHOOL && <Check className="w-3.5 h-3.5 text-teal-400" />}
                                  </div>
                                )}

                                {/* Free text entry option */}
                                {field.value && ![...WATERBERG_SCHOOLS, ...SA_UNIVERSITIES, NONE_SCHOOL].includes(field.value) && (
                                  <div
                                    onClick={() => setShowSchoolDropdown(false)}
                                    className="px-4 py-2 text-sm text-teal-400 hover:bg-teal-500/10 cursor-pointer italic flex items-center gap-2 border-t border-slate-800 mt-1"
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                    Use Custom School: "{field.value}"
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                          <FormMessage />
                        </FormItem>
                      );
                    }}
                  />

                  {/* Isolated Parent / Guardian Details Card */}
                  <div className="bg-slate-950/40 border border-slate-800/80 rounded-2xl p-5 space-y-4 shadow-sm backdrop-blur-xs">
                    <div className="flex items-center gap-2 text-teal-400 font-semibold text-sm border-b border-slate-850 pb-2">
                      <User className="w-4 h-4" />
                      Parent / Guardian Details
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="parent_name"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-slate-200">Parent/Guardian Name *</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="e.g. Mary Doe"
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
                            <FormLabel className="text-slate-200">Parent/Guardian Phone *</FormLabel>
                            <FormControl>
                              <Input
                                type="tel"
                                placeholder="e.g. 081 123 4567"
                                className="bg-slate-950/50 border-slate-700 text-white placeholder:text-slate-500 focus:border-teal-500 focus:ring-teal-500 rounded-xl h-11"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>

                  {/* WhatsApp Opt-in Card */}
                  <FormField
                    control={form.control}
                    name="whatsapp_opt_in"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-2xl border border-slate-800/60 bg-slate-950/40 p-4 shadow-xs backdrop-blur-xs">
                        <FormControl>
                          <input
                            type="checkbox"
                            checked={field.value}
                            onChange={(e) => field.onChange(e.target.checked)}
                            className="w-4 h-4 rounded text-teal-600 focus:ring-teal-500 border-slate-700 bg-slate-950/50 cursor-pointer mt-1"
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel className="text-sm font-semibold text-slate-200 cursor-pointer">
                            Join JG Youth WhatsApp Group
                          </FormLabel>
                          <p className="text-xs text-slate-400 mt-1">
                            Receive session announcements, schedules, and event invitations directly on WhatsApp.
                          </p>
                        </div>
                      </FormItem>
                    )}
                  />

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
