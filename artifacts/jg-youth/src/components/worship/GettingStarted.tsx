import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { getPushSetupState } from "@/lib/pushClient";
import { type WorshipAccount } from "@/lib/worship";

const DISMISS_KEY = "jg_worship_getting_started_dismissed";

/**
 * "Getting started" checklist on the team page after the welcome sequence.
 * Ticks itself off from real data and hides once everything is done (or
 * it's dismissed).
 */
export function GettingStarted({ me, songCount }: { me: WorshipAccount; songCount: number }) {
  const [pushOn, setPushOn] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === me.id;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    getPushSetupState()
      .then((s) => setPushOn(s === "subscribed"))
      .catch(() => setPushOn(false));
  }, []);

  const isLeader = me.role === "owner" || me.role === "leader";
  const items = [
    { done: me.instruments.length > 0, label: "Say what you do on the team", href: `/worship/members/${me.id}` },
    { done: songCount > 0, label: "Add your first song, in your key", href: "/worship/library" },
    { done: pushOn, label: "Turn on notifications (tap the 🔔 above)", href: null },
    ...(isLeader ? [{ done: false, label: "Post a Sunday setlist", href: "/worship/setlists" }] : []),
  ];
  // The setlist step is a pointer, not tracked; don't let it keep the card up.
  const tracked = items.slice(0, 3);
  if (dismissed || tracked.every((i) => i.done)) return null;
  const doneCount = tracked.filter((i) => i.done).length;

  return (
    <section className="mb-6 rounded-2xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold">
          Getting started <span className="font-normal text-muted-foreground">· {doneCount} of {tracked.length}</span>
        </p>
        <button
          type="button"
          aria-label="Hide getting started"
          onClick={() => {
            try {
              localStorage.setItem(DISMISS_KEY, me.id);
            } catch {
              /* ignore */
            }
            setDismissed(true);
          }}
          className="rounded-md p-1 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(doneCount / tracked.length) * 100}%` }} />
      </div>
      <ul className="space-y-2">
        {items.map((item) => {
          const row = (
            <span className="flex items-center gap-2.5 text-sm">
              <span
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                  item.done ? "border-primary bg-primary text-primary-foreground" : "border-border",
                )}
              >
                {item.done && <Check className="h-3 w-3" />}
              </span>
              <span className={cn(item.done && "text-muted-foreground line-through")}>{item.label}</span>
            </span>
          );
          return (
            <li key={item.label}>
              {item.href && !item.done ? (
                <Link href={item.href} className="block hover:text-primary">
                  {row}
                </Link>
              ) : (
                row
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
