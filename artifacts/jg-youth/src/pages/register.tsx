import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRegisterVisitor } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, ChevronLeft } from "lucide-react";
import { useState } from "react";

const registerSchema = z.object({
  full_name: z.string().min(2, "Full name is required"),
  phone: z.string().min(10, "Valid phone number is required").max(15),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  gender: z.enum(["male", "female", "other"]),
  age: z.coerce.number().min(10).max(100),
  heard_from: z.string().min(2, "Please tell us how you heard about us"),
});

type RegisterFormValues = z.infer<typeof registerSchema>;

export default function Register() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [isSuccess, setIsSuccess] = useState(false);
  const registerVisitor = useRegisterVisitor();

  const form = useForm<RegisterFormValues>({
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

  function onSubmit(data: RegisterFormValues) {
    registerVisitor.mutate(
      {
        data: {
          ...data,
          email: data.email || null,
        },
      },
      {
        onSuccess: () => {
          setIsSuccess(true);
        },
        onError: (error) => {
          toast({
            title: "Registration Failed",
            description: error.message || "An error occurred during registration",
            variant: "destructive",
          });
        },
      }
    );
  }

  if (isSuccess) {
    return (
      <Layout>
        <div className="max-w-md mx-auto pt-10">
          <Card className="border-primary/20 shadow-xl overflow-hidden relative">
            <div className="absolute top-0 left-0 w-full h-2 bg-primary"></div>
            <CardHeader className="text-center pb-2 pt-8">
              <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
                <CheckCircle2 className="w-8 h-8 text-primary" />
              </div>
              <CardTitle className="text-2xl">Welcome to JG Youth!</CardTitle>
              <CardDescription className="text-base mt-2">
                You've successfully registered as a first-timer. We're so glad you're here.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6 pb-8 space-y-4">
              <div className="bg-muted p-4 rounded-lg text-sm text-center">
                Your profile has been created as a Visitor. To get full access to RSVP to events and more, you can become a Member.
              </div>
              <div className="flex flex-col gap-3 pt-2">
                <Link href="/become-member">
                  <Button className="w-full" size="lg">Become a Member</Button>
                </Link>
                <Link href="/">
                  <Button variant="outline" className="w-full">Return Home</Button>
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
        <div className="mb-6">
          <Link href="/">
            <Button variant="ghost" size="sm" className="-ml-3 text-muted-foreground">
              <ChevronLeft className="w-4 h-4 mr-1" />
              Back
            </Button>
          </Link>
        </div>

        <Card className="shadow-lg border-border/60">
          <CardHeader>
            <CardTitle className="text-2xl">First Timer Registration</CardTitle>
            <CardDescription>
              Welcome! Please fill in your details so we can get to know you better.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <div className="space-y-4">
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

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
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
                      control={form.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email (Optional)</FormLabel>
                          <FormControl>
                            <Input type="email" placeholder="john@example.com" {...field} />
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
                          <FormLabel>Gender *</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
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
                            <Input type="number" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="heard_from"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>How did you hear about us? *</FormLabel>
                        <FormControl>
                          <Input placeholder="Friend, Social Media, etc." {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <Button 
                  type="submit" 
                  className="w-full text-base h-12" 
                  disabled={registerVisitor.isPending}
                >
                  {registerVisitor.isPending ? "Registering..." : "Register"}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
