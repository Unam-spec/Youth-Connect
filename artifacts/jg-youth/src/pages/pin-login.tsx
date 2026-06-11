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
import { ChevronLeft, LogIn } from "lucide-react";
import { Link, useLocation } from "wouter";

const schema = z.object({
  username: z.string().min(1, "Username is required"),
  pin: z.string().min(1, "PIN is required"),
});
type FormValues = z.infer<typeof schema>;

export default function PinLogin() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { username: "", pin: "" },
  });

  async function onSubmit(values: FormValues) {
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/pin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setPinSession({
          role: data.role === "member" ? "member" : "visitor",
          profile_id: data.profile_id,
          session_token: data.session_token,
          username: values.username.trim().toLowerCase(),
        });
        toast({ title: "Welcome back!" });
        setLocation("/account");
        return;
      }
      toast({ title: "Login failed", description: data.error ?? "Invalid username or PIN", variant: "destructive" });
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
              <LogIn className="w-6 h-6 text-primary" />
            </div>
            <CardTitle className="text-2xl font-semibold tracking-tight">Log in</CardTitle>
            <CardDescription>Use the username and PIN you created.</CardDescription>
          </CardHeader>
          <CardContent className="pb-8">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField control={form.control} name="username" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Username</FormLabel>
                    <FormControl><Input className="h-12" autoCapitalize="none" placeholder="thandi_k" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="pin" render={({ field }) => (
                  <FormItem>
                    <FormLabel>PIN</FormLabel>
                    <FormControl><Input className="h-12 text-center text-lg tracking-[0.5em] font-mono" type="password" inputMode="numeric" maxLength={6} placeholder="••••" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <Button type="submit" className="w-full h-12 mt-2" disabled={submitting}>
                  {submitting ? "Logging in..." : "Log in"}
                </Button>
              </form>
            </Form>
            <p className="text-center text-sm text-muted-foreground mt-6">
              New here?{" "}
              <Link href="/pin-signup" className="text-primary font-medium">Create an account</Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
