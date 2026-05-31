import { useEffect, useRef } from "react";
import { ClerkProvider, SignIn, SignUp, useAuth, useClerk } from "@clerk/react";
import { shadcn } from "@clerk/themes";
import { Switch, Route, useLocation, Router as WouterRouter } from "wouter";
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Layout } from "@/components/layout";

import Home from "@/pages/home";
import Register from "@/pages/register";
import CheckIn from "@/pages/checkin";
import LeaderLogin from "@/pages/leader-login";
import MyDashboard from "@/pages/my";
import BecomeMember from "@/pages/become-member";
import Dashboard from "@/pages/dashboard";
import LeaderQr from "@/pages/leader-qr";
import SessionQr from "@/pages/session-qr";
import QrResolver from "@/pages/qr-resolver";

const queryClient = new QueryClient();

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in .env file");
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "hsl(262, 83%, 58%)",
    colorForeground: "hsl(213, 31%, 91%)",
    colorMutedForeground: "hsl(215.4, 16.3%, 56.9%)",
    colorDanger: "hsl(0, 84%, 60%)",
    colorBackground: "hsl(222, 47%, 11%)",
    colorInput: "hsl(216, 34%, 17%)",
    colorInputForeground: "hsl(213, 31%, 91%)",
    colorNeutral: "hsl(216, 34%, 17%)",
    fontFamily: "'Inter', sans-serif",
    borderRadius: "0.5rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox:
      "bg-card rounded-2xl w-[440px] max-w-full overflow-hidden shadow-xl border border-border",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-2xl font-bold tracking-tight text-foreground",
    headerSubtitle: "text-muted-foreground",
    socialButtonsBlockButtonText: "text-foreground font-medium",
    formFieldLabel: "text-foreground font-medium",
    footerActionLink: "text-primary hover:text-primary/90 font-medium",
    footerActionText: "text-muted-foreground",
    dividerText: "text-muted-foreground",
    identityPreviewEditButton: "text-primary hover:text-primary/90",
    formFieldSuccessText: "text-green-500",
    alertText: "text-destructive",
    logoBox: "flex justify-center mb-4",
    logoImage: "h-12 w-auto",
    socialButtonsBlockButton:
      "bg-background border border-border hover:bg-muted text-foreground transition-colors",
    formButtonPrimary:
      "bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm",
    formFieldInput:
      "bg-background border border-input text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:border-primary transition-colors",
    footerAction: "bg-muted/30 py-4 mt-4 text-center",
    dividerLine: "bg-border",
    alert: "bg-destructive/10 border-destructive/20 text-destructive",
    otpCodeFieldInput:
      "bg-background border border-input text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:border-primary transition-colors",
    formFieldRow: "mb-4",
    main: "w-full",
  },
};

function SignInPage() {
  return (
    <Layout>
      <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center">
        <SignIn
          routing="path"
          path={`${basePath}/sign-in`}
          signUpUrl={`${basePath}/sign-up`}
        />
      </div>
    </Layout>
  );
}

function SignUpPage() {
  return (
    <Layout>
      <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center">
        <SignUp
          routing="path"
          path={`${basePath}/sign-up`}
          signInUrl={`${basePath}/sign-in`}
        />
      </div>
    </Layout>
  );
}

function ApiClientAuthBridge() {
  const { getToken, isLoaded, isSignedIn } = useAuth();

  if (!isLoaded || !isSignedIn) {
    setAuthTokenGetter(null);
  } else {
    setAuthTokenGetter(() => getToken());
  }

  useEffect(() => {
    return () => setAuthTokenGetter(null);
  }, []);

  return null;
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;

      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        queryClient.clear();
      }

      prevUserIdRef.current = userId;
    });

    return unsubscribe;
  }, [addListener, queryClient]);

  return null;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: "Welcome to JG Youth",
            subtitle: "Sign in to your account",
          },
        },
        signUp: {
          start: {
            title: "Join JG Youth",
            subtitle: "Create your account",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ApiClientAuthBridge />
        <ClerkQueryClientCacheInvalidator />

        <Switch>
          <Route path="/" component={Home} />
          <Route path="/register" component={Register} />
          <Route path="/checkin" component={CheckIn} />
          <Route path="/leader-login" component={LeaderLogin} />

          <Route path="/my" component={MyDashboard} />
          <Route path="/become-member" component={BecomeMember} />
          <Route path="/dashboard" component={Dashboard} />
          <Route path="/leader-qr" component={LeaderQr} />
          <Route path="/session-qr" component={SessionQr} />
          <Route path="/qr/:slug" component={QrResolver} />

          <Route path="/sign-in/*?" component={SignInPage} />
          <Route path="/sign-up/*?" component={SignUpPage} />

          <Route component={NotFound} />
        </Switch>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <TooltipProvider>
        <ClerkProviderWithRoutes />
        <Toaster />
      </TooltipProvider>
    </WouterRouter>
  );
}

export default App;
