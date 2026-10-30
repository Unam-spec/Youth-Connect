import { useEffect } from "react";
import { useLocation } from "wouter";
import { ChevronLeft } from "lucide-react";

// How many worship pages deep we are in this visit. Lets "Back" return to
// the previous worship page, but never step out of the app: if you opened a
// page straight from a notification or link, Back goes to `fallback`.
let depth = 0;

/** Count page changes (called once from the worship layout). */
export function useTrackWorshipNav(location: string) {
  useEffect(() => {
    depth++;
  }, [location]);
}

export function PageBack({ fallback = "/worship", label = "Back" }: { fallback?: string; label?: string }) {
  const [, setLocation] = useLocation();
  return (
    <button
      type="button"
      onClick={() => {
        if (depth > 1) {
          depth -= 2; // the page we return to counts itself again
          window.history.back();
        } else {
          setLocation(fallback);
        }
      }}
      className="-ml-1 inline-flex items-center gap-1 rounded-lg py-1 pr-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ChevronLeft className="h-4 w-4" />
      {label}
    </button>
  );
}
