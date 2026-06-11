import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState } from "react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { setPinSession } from "@/lib/pinSession";
import { ChevronLeft, UserPlus } from "lucide-react";
import { Link, useLocation } from "wouter";

const schema = z
  .object({
    full_name: z.string().min(1, "Your name is required").max(120),
    username: z
      .string()
      .min(3, "3-20 characters")
      .max(20, "3-20 characters")
      .regex(/^[a-zA-Z0-9_]+$/, "Letters, numbers, or underscore only"),
    age: z
      .string()
      .regex(/^\d{1,3}$/, "Enter your age")
      .refine((v) => Number(v) >= 1 && Number(v) <= 120, "Age must be 1-120"),
    pin: z.string().regex(/^\d{4,6}$/, "PIN must be 4-6 digits"),
    confirm_pin: z.string(),
  })
  .refine((d) => d.pin === d.confirm_pin, {
    message: "PINs do not match",
    path: ["confirm_pin"],
  });

type FormValues = z.infer<typeof schema>;

export default function PinSignup() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { full_name: "", username: "", age: "", pin: "", confirm_pin: "" },
  });

  async function onSubmit(values: FormValues) {
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/pin-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: values.full_name,
          username: values.username,
          pin: values.pin,
          age: Number(values.age),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 201) {
        setPinSession({
          role: "visitor",
          profile_id: data.profile_id,
          session_token: data.session_token,
          username: String(values.username).trim().toLowerCase(),
        });
        toast({ title: "Account created!" });
        setLocation("/account");
        return;
      }
      if (res.status === 409) {
        form.setError("username", { message: "That username is already taken." });
        return;
      }
      toast({ title: "Sign up failed", description: data.error ?? "Please try again.", variant: "destructive" });
    } catch {
      toast({ title: "Network error", description: "Please try again.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Layout>
      <div className="max-w-md mx-auto py-12">
        <div className="mb-6">
          <Link href="/">
            <Button variant="ghost" size="sm" className="-ml-3 text-muted-foreground">
              <ChevronLeft className="w-4 h-4 mr-1" />
              Back
            </Button>
          </Link>
        </div>
        <Card className="border border-border bg-card rounded-2xl overflow-hidden">
          <div className="h-1.5 w-full bg-primary" />
          <CardHeader className="text-center pt-8">
            <div className="mx-auto w-12 h-12 bg-primary/10 border border-primary/20 rounded-full flex items-center justify-center mb-4">
              <UserPlus className="w-6 h-6 text-primary" />
            </div>
            <CardTitle className="text-2xl font-semibold tracking-tight">Create an account</CardTitle>
            <CardDescription>No email needed — pick a username and a PIN.</CardDescription>
          </CardHeader>
          <CardContent className="pb-8">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField control={form.control} name="full_name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Your name</FormLabel>
                    <FormControl><Input className="h-12" placeholder="Thandi K" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="username" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Username</FormLabel>
                    <FormControl><Input className="h-12" placeholder="thandi_k" autoCapitalize="none" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="age" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Age</FormLabel>
                    <FormControl><Input className="h-12" type="number" inputMode="numeric" placeholder="13" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="pin" render={({ field }) => (
                  <FormItem>
                    <FormLabel>PIN (4-6 digits)</FormLabel>
                    <FormControl><Input className="h-12 text-center text-lg tracking-[0.5em] font-mono" type="password" inputMode="numeric" maxLength={6} placeholder="••••" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="confirm_pin" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm PIN</FormLabel>
                    <FormControl><Input className="h-12 text-center text-lg tracking-[0.5em] font-mono" type="password" inputMode="numeric" maxLength={6} placeholder="••••" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <Button type="submit" className="w-full h-12 mt-2" disabled={submitting}>
                  {submitting ? "Creating..." : "Create account"}
                </Button>
              </form>
            </Form>
            <p className="text-center text-sm text-muted-foreground mt-6">
              Have an account?{" "}
              <Link href="/pin-login" className="text-primary font-medium">Log in</Link>
            </p>
            <p className="text-center text-xs text-muted-foreground mt-2">
              Have an email?{" "}
              <Link href="/sign-up" className="text-primary font-medium">Sign up with email</Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
