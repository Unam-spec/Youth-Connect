import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";

export interface TourStep {
  target: RefObject<HTMLElement | null>;
  title: string;
  body: string;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 8;
const CARD_WIDTH = 300;

/**
 * Lightweight 3-step spotlight tour. Dims the page, highlights the current
 * target element, and shows a tooltip card with Back/Next/Finish. Pure React +
 * a portal — no external tour library.
 */
export function OnboardingTour({
  steps,
  open,
  onClose,
}: {
  steps: TourStep[];
  open: boolean;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);

  const step = steps[index];

  const measure = useCallback(() => {
    const el = step?.target.current;
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [step]);

  // Reset to the first step each time the tour opens.
  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  // Scroll the target into view, then measure (with a couple of follow-up
  // measurements so we catch the position after smooth-scroll settles).
  useLayoutEffect(() => {
    if (!open || !step) return;
    const el = step.target.current;
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    measure();
    const timers = [80, 250, 450].map((t) => window.setTimeout(measure, t));
    return () => timers.forEach(clearTimeout);
  }, [open, step, measure]);

  // Keep the highlight glued to the target on scroll/resize.
  useEffect(() => {
    if (!open) return;
    const onMove = () => measure();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, measure]);

  if (!open || steps.length === 0) return null;

  const isLast = index === steps.length - 1;
  const next = () => (isLast ? onClose() : setIndex((i) => i + 1));
  const back = () => setIndex((i) => Math.max(0, i - 1));

  // Position the tooltip card below the target if there's room, else above.
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const vw = typeof window !== "undefined" ? window.innerWidth : 400;
  let cardTop = 24;
  let cardLeft = vw / 2 - CARD_WIDTH / 2;
  if (rect) {
    const below = rect.top + rect.height + PAD + 12;
    const placeBelow = below + 180 < vh;
    cardTop = placeBelow ? below : Math.max(16, rect.top - 196);
    cardLeft = Math.min(
      Math.max(16, rect.left + rect.width / 2 - CARD_WIDTH / 2),
      vw - CARD_WIDTH - 16,
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-[100]">
      {/* Click blocker (keeps focus on the tour) */}
      <div className="absolute inset-0" />

      {/* Spotlight cutout via a large box-shadow; falls back to a centered dim
          panel when the target can't be measured. */}
      {rect ? (
        <motion.div
          className="pointer-events-none absolute rounded-xl ring-2 ring-primary"
          initial={false}
          animate={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
          }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          style={{ boxShadow: "0 0 0 9999px rgba(0,0,0,0.65)" }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/65" />
      )}

      {/* Tooltip card */}
      <AnimatePresence mode="wait">
        <motion.div
          key={index}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18 }}
          className="absolute w-[300px] rounded-2xl border border-border bg-popover p-4 text-popover-foreground shadow-2xl"
          style={{ top: cardTop, left: cardLeft }}
        >
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-primary">
              Step {index + 1} of {steps.length}
            </span>
            <button
              onClick={onClose}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Skip
            </button>
          </div>
          <h3 className="font-[family-name:var(--app-font-heading)] text-base font-semibold tracking-tight">
            {step.title}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>

          <div className="mt-4 flex items-center justify-between gap-2">
            <div className="flex gap-1.5">
              {steps.map((_, i) => (
                <span
                  key={i}
                  className={`h-1.5 w-1.5 rounded-full ${
                    i === index ? "bg-primary" : "bg-border"
                  }`}
                />
              ))}
            </div>
            <div className="flex gap-2">
              {index > 0 && (
                <Button variant="ghost" size="sm" onClick={back} className="rounded-lg">
                  Back
                </Button>
              )}
              <Button size="sm" onClick={next} className="rounded-lg">
                {isLast ? "Got it" : "Next"}
              </Button>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>,
    document.body,
  );
}
