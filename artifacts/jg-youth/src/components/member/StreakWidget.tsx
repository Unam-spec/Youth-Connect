import { motion } from "framer-motion";
import { Flame } from "lucide-react";
import { computeStreak } from "@/lib/streak";

export function StreakWidget({ sessionDates }: { sessionDates: (string | null | undefined)[] }) {
  const { current, longest, total } = computeStreak(sessionDates);
  const active = current > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 24 }}
      className="rounded-2xl border border-border bg-card p-5"
    >
      <div className="flex items-center gap-4">
        <motion.div
          className={`relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${
            active ? "bg-primary/10" : "bg-muted"
          }`}
          animate={active ? { scale: [1, 1.08, 1] } : {}}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
        >
          <Flame
            className={`h-7 w-7 ${active ? "text-primary" : "text-muted-foreground"}`}
            fill={active ? "currentColor" : "none"}
          />
        </motion.div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="font-[family-name:var(--app-font-heading)] text-3xl font-bold tabular-nums text-foreground">
              {current}
            </span>
            <span className="text-sm font-medium text-muted-foreground">
              week{current === 1 ? "" : "s"} streak
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {total === 0
              ? "Check in on Friday to start your streak! 🔥"
              : `Longest: ${longest} · ${total} session${total === 1 ? "" : "s"} total`}
          </p>
        </div>
      </div>
    </motion.div>
  );
}
