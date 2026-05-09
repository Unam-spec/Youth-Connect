import { Link, useLocation } from "wouter";
import { Show, useClerk } from "@clerk/react";
import { Button } from "@/components/ui/button";
import { getLeaderSession, clearLeaderSession } from "@/lib/auth";
import { LogOut, User, LayoutDashboard, QrCode, Home } from "lucide-react";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const { signOut } = useClerk();
  const leaderSession = getLeaderSession();

  const handleSignOut = () => {
    signOut(() => setLocation("/"));
  };

  const handleLeaderSignOut = () => {
    clearLeaderSession();
    setLocation("/");
  };

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground selection:bg-primary selection:text-primary-foreground">
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto flex h-14 max-w-screen-2xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2 mr-6 hover:opacity-80 transition-opacity">
            <span className="font-bold tracking-tight text-lg">Jeremiah Generation</span>
            <span className="hidden sm:inline-block px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-semibold uppercase tracking-wider">JG Youth AFM</span>
          </Link>
          <nav className="flex items-center gap-2 sm:gap-4">
            <Show when="signed-in">
              <Link href="/my" className="text-sm font-medium hover:text-primary transition-colors flex items-center gap-1.5">
                <User className="w-4 h-4" />
                <span className="hidden sm:inline-block">Profile</span>
              </Link>
              <Button variant="ghost" size="sm" onClick={handleSignOut} className="text-muted-foreground hover:text-foreground">
                <LogOut className="w-4 h-4 sm:mr-1.5" />
                <span className="hidden sm:inline-block">Sign Out</span>
              </Button>
            </Show>
            <Show when="signed-out">
              {!leaderSession ? (
                <>
                  <Link href="/sign-in" className="text-sm font-medium hover:text-primary transition-colors">Login</Link>
                  <Link href="/register">
                    <Button size="sm" className="hidden sm:flex bg-primary text-primary-foreground hover:bg-primary/90">First Timer</Button>
                  </Link>
                </>
              ) : (
                <Button variant="ghost" size="sm" onClick={handleLeaderSignOut} className="text-muted-foreground hover:text-foreground">
                  <LogOut className="w-4 h-4 sm:mr-1.5" />
                  <span className="hidden sm:inline-block">Leader Sign Out</span>
                </Button>
              )}
            </Show>
            {leaderSession && (
              <Link href="/dashboard">
                <Button variant="outline" size="sm" className="flex items-center gap-1.5 border-primary/20 hover:bg-primary/10 hover:text-primary">
                  <LayoutDashboard className="w-4 h-4" />
                  <span className="hidden sm:inline-block">Dashboard</span>
                </Button>
              </Link>
            )}
          </nav>
        </div>
      </header>
      <main className="flex-1 container mx-auto max-w-screen-2xl p-4 sm:p-6 lg:p-8">
        {children}
      </main>
      <footer className="border-t border-border/40 py-6 md:py-0 bg-muted/20">
        <div className="container mx-auto flex flex-col md:flex-row items-center justify-between gap-4 md:h-16 px-4">
          <p className="text-sm text-muted-foreground leading-loose text-center md:text-left">
            Built for Jeremiah Generation Youth AFM.
          </p>
          <div className="flex items-center gap-4">
            <Link href="/leader-login" className="text-sm text-muted-foreground hover:text-primary transition-colors">
              Leader Portal
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
