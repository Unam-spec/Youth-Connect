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
import { PhoneInput } from "@/components/ui/phone-input";
import { Link } from "wouter";
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertCircle, CheckCircle2, ChevronLeft, GraduationCap, Check, BookOpen, User, XCircle, ArrowRight, Camera, Loader2, Sparkles } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { WATERBERG_SCHOOLS, SA_UNIVERSITIES, NONE_SCHOOL } from "@/lib/schools";

// ─── Client-side validation schema ────────────────────────────────────────────
const registerSchema = z.object({
  full_name: z.string().min(2, "Full name must be at least 2 characters"),
  phone_number: z
    .string()
    .min(8, "Valid phone number is required")
    .max(20, "Phone number is too long"),
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
  parent_phone: z.string().min(8, "Parent/Guardian phone is required").max(20),
  whatsapp_opt_in: z.boolean().default(false),
  avatar_url: z.string().min(1, "A profile picture is required"),
});

type RegisterFormValues = z.infer<typeof registerSchema>;

export default function Register() {
  const [isSuccess, setIsSuccess] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // Profile-picture upload state
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Post-registration "become a member?" prompt state
  const [visitorId, setVisitorId] = useState<string | null>(null);
  const [showMembershipPrompt, setShowMembershipPrompt] = useState(false);
  const [membershipChoice, setMembershipChoice] = useState<"yes" | "no" | null>(null);
  const [isSavingIntent, setIsSavingIntent] = useState(false);

  // Wizard state
  const [step, setStep] = useState(1);
  const totalSteps = 3;

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
      avatar_url: "",
    },
    mode: "onTouched",
  });

  const avatarUrl = form.watch("avatar_url");

  async function handlePhotoSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Allow re-selecting the same file later
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setPhotoError("Please choose an image file (JPG or PNG).");
      return;
    }
    setPhotoError(null);
    setIsUploadingPhoto(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/register/photo", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPhotoError(data.error || "Upload failed. Please try again.");
        return;
      }
      form.setValue("avatar_url", data.url, { shouldValidate: true, shouldDirty: true });
    } catch {
      setPhotoError("Upload failed — please check your connection and try again.");
    } finally {
      setIsUploadingPhoto(false);
    }
  }

  async function handleMembershipChoice(wants: boolean) {
    setIsSavingIntent(true);
    try {
      if (visitorId) {
        await fetch("/api/register/membership-intent", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ visitor_id: visitorId, wants_membership: wants }),
        });
      }
    } catch {
      // Non-blocking — they're already registered; intent is a nice-to-have.
    } finally {
      setIsSavingIntent(false);
      setMembershipChoice(wants ? "yes" : "no");
      setShowMembershipPrompt(false);
      setIsSuccess(true);
    }
  }

  const nextStep = async () => {
    let fieldsToValidate: (keyof RegisterFormValues)[] = [];
    if (step === 1) {
      fieldsToValidate = ["avatar_url", "full_name", "phone_number", "email", "gender", "age"];
    } else if (step === 2) {
      fieldsToValidate = ["school", "how_did_you_hear"];
    }

    const isValid = await form.trigger(fieldsToValidate);
    if (isValid) {
      setStep((prev) => Math.min(prev + 1, totalSteps));
    }
  };

  const prevStep = () => {
    setStep((prev) => Math.max(prev - 1, 1));
  };

  async function onSubmit(data: RegisterFormValues) {
    if (step !== totalSteps) return; // Only submit on final step
    
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
          avatar_url: data.avatar_url,
        }),
      });

      if (response.status === 201) {
        if (data.email) {
          sessionStorage.setItem("jg_pending_signup_email", data.email);
          sessionStorage.setItem("jg_pending_signup_name", data.full_name);
        }
        const body = await response.json().catch(() => ({}));
        if (body?.visitor?.id) setVisitorId(body.visitor.id);
        // Pop up the "become a member?" question before the success screen.
        setShowMembershipPrompt(true);
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

  if (isSuccess) {
    return (
      <Layout>
        <div className="max-w-md mx-auto pt-10">
          <Card className="border border-border bg-card rounded-2xl overflow-hidden relative">
            <div className="absolute top-0 left-0 w-full h-2 bg-primary" />
            <CardHeader className="text-center pb-2 pt-8">
              <div className="mx-auto w-16 h-16 bg-primary/10 border border-primary/20 rounded-full flex items-center justify-center mb-4">
                <CheckCircle2 className="w-8 h-8 text-primary" />
              </div>
              <CardTitle className="font-[family-name:var(--app-font-heading)] text-2xl font-semibold tracking-tight">You're in!</CardTitle>
              <CardDescription className="text-base mt-2 text-muted-foreground">
                {membershipChoice === "yes"
                  ? "Awesome — we've noted that you'd like to become a member! A leader will check you in and help you join. See you on Friday."
                  : "A leader will review your registration and check you in shortly. See you on Friday!"}
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6 pb-8">
              <div className="flex flex-col gap-3 pt-2">
                <Link href="/">
                  <Button className="w-full bg-primary text-primary-foreground hover:bg-primary/90 rounded-xl" size="lg">
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
      <div className="max-w-xl mx-auto py-8 px-4">
        <div className="mb-6 flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (step > 1) {
                prevStep();
              } else {
                window.history.back();
              }
            }}
            className="-ml-3 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft className="w-4 h-4 mr-1" />
            Back
          </Button>
          <span className="text-sm font-medium text-muted-foreground">Step {step} of {totalSteps}</span>
        </div>

        <Card className="border border-border bg-card rounded-2xl overflow-hidden relative">
          {/* Progress Bar */}
          <div className="absolute top-0 left-0 w-full h-1.5 bg-muted">
            <div
              className="h-full bg-primary transition-all duration-300 ease-in-out"
              style={{ width: `${(step / totalSteps) * 100}%` }}
            />
          </div>

          <CardHeader className="pb-4 pt-8">
            <CardTitle className="font-[family-name:var(--app-font-heading)] text-2xl text-foreground font-semibold tracking-tight">
              {step === 1 && "Personal Details"}
              {step === 2 && "Education & Discovery"}
              {step === 3 && "Parent & Contact Info"}
            </CardTitle>
            <CardDescription className="text-muted-foreground text-sm leading-relaxed">
              {step === 1 && "Welcome! Please fill in your basic details."}
              {step === 2 && "Tell us a bit about your education and how you found us."}
              {step === 3 && "We need parent/guardian details and your communication preferences."}
            </CardDescription>
          </CardHeader>
          <CardContent className="pb-8">
            {serverError && (
              <div className="mb-5 flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{serverError}</span>
              </div>
            )}

            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                
                {/* Step 1: Personal Details */}
                <div className={step === 1 ? "space-y-4 animate-in fade-in slide-in-from-right-4 duration-300" : "hidden"}>
                  {/* Required profile picture */}
                  <FormField
                    control={form.control}
                    name="avatar_url"
                    render={() => (
                      <FormItem>
                        <FormLabel className="text-foreground">Profile Picture *</FormLabel>
                        <FormControl>
                          <div className="flex items-center gap-4">
                            <input
                              ref={fileInputRef}
                              type="file"
                              accept="image/*"
                              capture="user"
                              className="hidden"
                              onChange={handlePhotoSelected}
                            />
                            <button
                              type="button"
                              onClick={() => fileInputRef.current?.click()}
                              disabled={isUploadingPhoto}
                              className="relative w-20 h-20 rounded-full border-2 border-dashed border-border bg-muted flex items-center justify-center overflow-hidden shrink-0 hover:border-primary transition-colors disabled:opacity-60"
                            >
                              {isUploadingPhoto ? (
                                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                              ) : avatarUrl ? (
                                <img src={avatarUrl} alt="Your profile" className="w-full h-full object-cover" />
                              ) : (
                                <Camera className="w-7 h-7 text-muted-foreground" />
                              )}
                            </button>
                            <div className="text-sm">
                              <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={isUploadingPhoto}
                                className="font-semibold text-primary hover:underline disabled:opacity-60"
                              >
                                {avatarUrl ? "Change photo" : "Add a photo"}
                              </button>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                Required — a clear photo of you (max 2MB).
                              </p>
                              {avatarUrl && (
                                <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
                                  <Check className="w-3 h-3" /> Photo added
                                </p>
                              )}
                            </div>
                          </div>
                        </FormControl>
                        {photoError && (
                          <p className="text-sm text-destructive mt-1">{photoError}</p>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                     control={form.control}
                     name="full_name"
                     render={({ field }) => (
                       <FormItem>
                         <FormLabel className="text-foreground">Full Name *</FormLabel>
                         <FormControl>
                           <Input
                             placeholder="John Doe"
                             className="bg-card border-border text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-primary rounded-xl h-11"
                             {...field}
                           />
                         </FormControl>
                         <FormMessage />
                       </FormItem>
                     )}
                  />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="phone_number"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-foreground">Phone Number *</FormLabel>
                          <FormControl>
                            <PhoneInput
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
                          <FormLabel className="text-foreground">Email *</FormLabel>
                          <FormControl>
                            <Input
                              type="email"
                              placeholder="john@example.com"
                              className="bg-card border-border text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-primary rounded-xl h-11"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="gender"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-foreground">Gender *</FormLabel>
                          <FormControl>
                            <div className="flex gap-4 pt-1">
                              {["male", "female", "prefer_not_to_say"].map((option) => (
                                <label key={option} className="flex items-center gap-2">
                                  <input 
                                    type="radio" 
                                    value={option}
                                    checked={field.value === option}
                                    onChange={(e) => field.onChange(e.target.value)}
                                    className="h-4 w-4 text-primary focus:ring-primary border-border bg-card"
                                  />
                                  <span className="text-sm text-foreground capitalize">{option.replace(/_/g, " ")}</span>
                                </label>
                              ))}
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="age"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-foreground">Age *</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              min={10}
                              max={100}
                              className="bg-card border-border text-foreground focus:border-primary focus:ring-primary rounded-xl h-11"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                {/* Step 2: Education & Discovery */}
                <div className={step === 2 ? "space-y-4 animate-in fade-in slide-in-from-right-4 duration-300" : "hidden"}>
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
                          <FormLabel className="text-foreground">School / University *</FormLabel>
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
                                className="bg-card border-border text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-primary rounded-xl h-11 pr-10"
                              />
                            </FormControl>
                            <div className="absolute right-3 top-3 text-muted-foreground">
                              <GraduationCap className="w-5 h-5" />
                            </div>
                            {showSchoolDropdown && (
                              <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-xl shadow-lg max-h-60 overflow-y-auto">
                                {filteredWaterberg.length > 0 && (
                                  <>
                                    <div className="px-3 py-1.5 text-2xs font-semibold text-muted-foreground uppercase tracking-wider bg-muted">Waterberg Schools</div>
                                    {filteredWaterberg.map((schoolName) => (
                                      <div
                                        key={schoolName}
                                        onClick={() => {
                                          field.onChange(schoolName);
                                          setSchoolQuery(schoolName);
                                          setShowSchoolDropdown(false);
                                        }}
                                        className="px-4 py-2 text-sm text-foreground hover:bg-primary/5 hover:text-primary cursor-pointer flex items-center justify-between"
                                      >
                                        <span className="flex items-center gap-2"><BookOpen className="w-3.5 h-3.5 text-primary/60" />{schoolName}</span>
                                        {field.value === schoolName && <Check className="w-3.5 h-3.5 text-primary" />}
                                      </div>
                                    ))}
                                  </>
                                )}
                                {filteredWaterberg.length > 0 && filteredUni.length > 0 && <div className="h-px bg-border my-1" />}
                                {filteredUni.length > 0 && (
                                  <>
                                    <div className="px-3 py-1.5 text-2xs font-semibold text-muted-foreground uppercase tracking-wider bg-muted">South African Universities</div>
                                    {filteredUni.map((schoolName) => (
                                      <div
                                        key={schoolName}
                                        onClick={() => {
                                          field.onChange(schoolName);
                                          setSchoolQuery(schoolName);
                                          setShowSchoolDropdown(false);
                                        }}
                                        className="px-4 py-2 text-sm text-foreground hover:bg-primary/5 hover:text-primary cursor-pointer flex items-center justify-between"
                                      >
                                        <span className="flex items-center gap-2"><GraduationCap className="w-3.5 h-3.5 text-primary/60" />{schoolName}</span>
                                        {field.value === schoolName && <Check className="w-3.5 h-3.5 text-primary" />}
                                      </div>
                                    ))}
                                  </>
                                )}
                                {((filteredWaterberg.length > 0 || filteredUni.length > 0) && showNone) && <div className="h-px bg-border my-1" />}
                                {showNone && (
                                  <div
                                    onClick={() => {
                                      field.onChange(NONE_SCHOOL);
                                      setSchoolQuery(NONE_SCHOOL);
                                      setShowSchoolDropdown(false);
                                    }}
                                    className="px-4 py-2 text-sm text-foreground hover:bg-primary/5 hover:text-primary cursor-pointer flex items-center justify-between"
                                  >
                                    <span className="flex items-center gap-2 font-medium"><XCircle className="w-3.5 h-3.5 text-muted-foreground" />{NONE_SCHOOL}</span>
                                    {field.value === NONE_SCHOOL && <Check className="w-3.5 h-3.5 text-primary" />}
                                  </div>
                                )}
                                {field.value && ![...WATERBERG_SCHOOLS, ...SA_UNIVERSITIES, NONE_SCHOOL].includes(field.value) && (
                                  <div
                                    onClick={() => setShowSchoolDropdown(false)}
                                    className="px-4 py-2 text-sm text-primary hover:bg-primary/5 cursor-pointer italic flex items-center gap-2 border-t border-border mt-1"
                                  >
                                    <Check className="w-3.5 h-3.5" /> Use Custom School: "{field.value}"
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
                  <FormField
                    control={form.control}
                    name="how_did_you_hear"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-foreground">How did you hear about us? *</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Friend, Social Media, etc."
                            className="bg-card border-border text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-primary rounded-xl h-11"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Step 3: Parent & Contact Info */}
                <div className={step === 3 ? "space-y-4 animate-in fade-in slide-in-from-right-4 duration-300" : "hidden"}>
                  <p className="text-sm text-muted-foreground pb-2">We ask for a parent or guardian contact for members under 18.</p>
                  <div className="bg-muted border border-border rounded-2xl p-5 space-y-4">
                    <div className="flex items-center gap-2 text-primary font-semibold text-sm border-b border-border pb-2">
                      <User className="w-4 h-4" />
                      Parent / Guardian Details
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="parent_name"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-foreground">Name *</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="e.g. Mary Doe"
                                className="bg-card border-border text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-primary rounded-xl h-11"
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
                            <FormLabel className="text-foreground">Phone *</FormLabel>
                            <FormControl>
                              <PhoneInput
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>

                  <FormField
                    control={form.control}
                    name="whatsapp_opt_in"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-2xl border border-border bg-card p-4 cursor-pointer hover:bg-muted transition-colors"
                                onClick={() => field.onChange(!field.value)}>
                        <FormControl>
                          <input
                            type="checkbox"
                            checked={field.value}
                            onChange={(e) => field.onChange(e.target.checked)}
                            className="w-5 h-5 rounded text-primary focus:ring-primary border-border bg-card cursor-pointer mt-0.5"
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel className="text-sm font-semibold text-foreground cursor-pointer">
                            Join our WhatsApp group for updates, reminders and community
                          </FormLabel>
                          <p className="text-xs text-muted-foreground mt-1">
                            Receive session announcements, schedules, and event invitations directly on WhatsApp.
                          </p>
                        </div>
                      </FormItem>
                    )}
                  />
                </div>

                <div className="pt-4 flex gap-3">
                  {step < totalSteps ? (
                    <Button
                      type="button"
                      onClick={nextStep}
                      className="w-full text-base h-12 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold rounded-xl transition-all duration-200 flex items-center justify-center gap-2"
                    >
                      Continue <ArrowRight className="w-4 h-4" />
                    </Button>
                  ) : (
                    <Button
                      type="submit"
                      disabled={isPending}
                      className="w-full text-base h-12 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold rounded-xl transition-all duration-200"
                    >
                      {isPending ? "Registering..." : "Complete Registration"}
                    </Button>
                  )}
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>

      {/* ── Post-registration: "Become a member?" pop-up ── */}
      <Dialog open={showMembershipPrompt} onOpenChange={() => { /* must choose */ }}>
        <DialogContent className="rounded-2xl max-w-sm" hideClose>
          <DialogHeader>
            <div className="mx-auto w-14 h-14 bg-primary/10 border border-primary/20 rounded-full flex items-center justify-center mb-2">
              <Sparkles className="w-7 h-7 text-primary" />
            </div>
            <DialogTitle className="text-center font-[family-name:var(--app-font-heading)] text-2xl font-semibold tracking-tight">
              You're registered! 🎉
            </DialogTitle>
            <DialogDescription className="text-center text-base pt-1">
              Welcome to Jeremiah Generation Youth. Would you like to become a
              <span className="font-semibold text-foreground"> member</span>?
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 pt-2">
            <Button
              onClick={() => handleMembershipChoice(true)}
              disabled={isSavingIntent}
              className="w-full h-12 rounded-xl text-base font-semibold bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {isSavingIntent ? <Loader2 className="w-4 h-4 animate-spin" /> : "Yes, I'd love to join!"}
            </Button>
            <Button
              onClick={() => handleMembershipChoice(false)}
              disabled={isSavingIntent}
              variant="outline"
              className="w-full h-12 rounded-xl text-base"
            >
              No, just visiting for now
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
