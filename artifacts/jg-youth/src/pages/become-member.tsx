import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { useCreateMembershipRequest, useGetMyProfile, getGetMyProfileQueryKey } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { ChevronLeft } from "lucide-react";
import { useState } from "react";
import { useUser } from "@clerk/react";

const requestSchema = z.object({
  reason: z.string().min(10, "Please provide a slightly more detailed reason (at least 10 characters)"),
});

type RequestFormValues = z.infer<typeof requestSchema>;

export default function BecomeMember() {
  const { toast } = useToast();
  const { isLoaded, isSignedIn } = useUser();
  const { data: profile, isLoading } = useGetMyProfile({
    query: {
      enabled: isLoaded && isSignedIn,
      queryKey: getGetMyProfileQueryKey(),
      retry: false,
    },
  });
  const createRequest = useCreateMembershipRequest();
  const [submitted, setSubmitted] = useState(false);

  const form = useForm<RequestFormValues>({
    resolver: zodResolver(requestSchema),
    defaultValues: { reason: "" },
  });

  function onSubmit(data: RequestFormValues) {
    createRequest.mutate(
      { data },
      {
        onSuccess: () => {
          setSubmitted(true);
        },
        onError: (error: Error) => {
          toast({
            title: "Request Failed",
            description: error.message || "Could not submit your request.",
            variant: "destructive"
          });
        }
      }
    );
  }

  if (!isLoaded || (isSignedIn && isLoading)) {
    return <Layout><div className="p-8 text-center">Loading...</div></Layout>;
  }

  if (!isSignedIn) {
    return (
      <Layout>
        <div className="max-w-md mx-auto pt-10">
          <Card className="border border-border bg-card rounded-2xl text-center">
            <CardHeader>
              <CardTitle className="font-[family-name:var(--app-font-heading)] text-2xl font-semibold tracking-tight">Create your account first</CardTitle>
              <CardDescription>
                Membership requests are linked to your login so leaders can approve the right profile.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Link href="/sign-up">
                <Button className="w-full">Sign up to become a member</Button>
              </Link>
              <Link href="/sign-in">
                <Button variant="outline" className="w-full">I already have an account</Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  if (!profile) {
    return (
      <Layout>
        <div className="max-w-md mx-auto pt-10 text-center">
          <h2 className="font-[family-name:var(--app-font-heading)] text-2xl font-semibold tracking-tight mb-2">Finish your first-timer registration.</h2>
          <p className="text-muted-foreground mb-4">
            We need a profile before you can request membership.
          </p>
          <Link href="/register"><Button>Register your profile</Button></Link>
        </div>
      </Layout>
    );
  }

  if (profile?.role !== "visitor") {
    return (
      <Layout>
        <div className="max-w-md mx-auto pt-10 text-center">
          <h2 className="font-[family-name:var(--app-font-heading)] text-2xl font-semibold tracking-tight mb-2">You are already a member or leader.</h2>
          <Link href="/my"><Button>Return to Dashboard</Button></Link>
        </div>
      </Layout>
    );
  }

  if (submitted) {
    return (
      <Layout>
        <div className="max-w-md mx-auto pt-10">
          <Card className="border border-border bg-card rounded-2xl text-center">
            <CardHeader>
              <CardTitle className="font-[family-name:var(--app-font-heading)] text-2xl font-semibold tracking-tight">Request Submitted</CardTitle>
              <CardDescription>
                Thank you! The leadership team will review your membership request soon.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/my"><Button className="w-full">Return to Dashboard</Button></Link>
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-xl mx-auto py-8">
        <div className="mb-6">
          <Link href="/my">
            <Button variant="ghost" size="sm" className="-ml-3 text-muted-foreground">
              <ChevronLeft className="w-4 h-4 mr-1" />
              Back
            </Button>
          </Link>
        </div>

        <Card className="border border-border bg-card rounded-2xl">
          <CardHeader>
            <CardTitle className="font-[family-name:var(--app-font-heading)] text-2xl font-semibold tracking-tight">Become a Member</CardTitle>
            <CardDescription>
              We're excited you want to join us fully! Let us know why you want to become a member of JG Youth.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <FormField
                  control={form.control}
                  name="reason"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Why do you want to join?</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="I've been attending for a few weeks and really love the community..." 
                          className="min-h-[120px]" 
                          {...field} 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" disabled={createRequest.isPending}>
                  {createRequest.isPending ? "Submitting..." : "Submit Request"}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
