import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useVerifyLeaderPin } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { setLeaderSession } from "@/lib/auth";
import { ChevronLeft, Lock } from "lucide-react";
import { Link, useLocation } from "wouter";

const loginSchema = z.object({
  phone: z.string().min(10, "Phone number required").max(15),
  pin: z.string().min(4, "PIN must be at least 4 digits").max(6, "PIN max 6 digits"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export default function LeaderLogin() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const verifyPin = useVerifyLeaderPin();

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { phone: "", pin: "" },
  });

  function onSubmit(data: LoginFormValues) {
    verifyPin.mutate(
      { data },
      {
        onSuccess: (result) => {
          if (result.success && result.profile_id) {
            setLeaderSession({
              role: result.role,
              profile_id: result.profile_id
            });
            toast({ title: "Welcome back, leader." });
            setLocation("/dashboard");
          } else {
            toast({
              title: "Login Failed",
              description: "Invalid phone number or PIN.",
              variant: "destructive"
            });
          }
        },
        onError: (error) => {
          toast({
            title: "Login Error",
            description: error.message || "Unable to verify PIN.",
            variant: "destructive"
          });
        }
      }
    );
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

        <Card className="shadow-2xl border-primary/20 bg-card overflow-hidden">
          <div className="h-1.5 w-full bg-primary" />
          <CardHeader className="text-center pt-8">
            <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
              <Lock className="w-6 h-6 text-primary" />
            </div>
            <CardTitle className="text-2xl">Leader Access</CardTitle>
            <CardDescription>
              Enter your phone number and PIN to access the leader dashboard.
            </CardDescription>
          </CardHeader>
          <CardContent className="pb-8">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone Number</FormLabel>
                      <FormControl>
                        <Input type="tel" placeholder="082 123 4567" className="h-12" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
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
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
