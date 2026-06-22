import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Check, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useApiFetch } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

const FALLBACK_PROMPTS = [
  "What's something you loved recently? 🙌",
  "Anything we could do better at sessions?",
  "An event or topic you'd love to see",
];
const FALLBACK_TITLE = "How's your JG Youth experience?";
const FALLBACK_BODY =
  "We'd love a quick word — what's going well, or what could be better?";

export function FeedbackModal({
  open,
  onOpenChange,
  userId,
  title,
  body,
  examples,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId?: string;
  /** Editable copy from the backend (falls back to sensible defaults). */
  title?: string;
  body?: string;
  examples?: string[];
}) {
  const heading = title?.trim() || FALLBACK_TITLE;
  const subtitle = body?.trim() || FALLBACK_BODY;
  const prompts = examples && examples.length > 0 ? examples : FALLBACK_PROMPTS;
  const apiFetch = useApiFetch();
  const { toast } = useToast();
  const [content, setContent] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  function close() {
    onOpenChange(false);
    // Reset after the close animation so a re-open starts fresh.
    setTimeout(() => {
      setContent("");
      setAnonymous(false);
      setSubmitting(false);
      setDone(false);
    }, 250);
  }

  async function handleSubmit() {
    if (!content.trim()) {
      toast({ title: "Add a little something first 🙂", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiFetch("/api/feedbacks", {
        method: "POST",
        body: JSON.stringify({
          content: content.trim(),
          anonymous,
          // Only attach identity when not anonymous; backend also enforces this.
          user_id: anonymous ? null : (userId ?? null),
        }),
      });
      if (!res.ok) throw new Error();
      setDone(true);
      setTimeout(close, 1600);
    } catch {
      toast({ title: "Couldn't send feedback", description: "Please try again.", variant: "destructive" });
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-lg rounded-2xl border-border bg-popover p-0 overflow-hidden">
        <AnimatePresence mode="wait">
          {done ? (
            <motion.div
              key="done"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center gap-3 px-8 py-14 text-center"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 360, damping: 18 }}
                className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/15"
              >
                <Check className="h-8 w-8 text-primary" />
              </motion.div>
              <DialogTitle className="font-[family-name:var(--app-font-heading)] text-xl font-semibold">
                Thank you! 💚
              </DialogTitle>
              <p className="text-sm text-muted-foreground">
                Your feedback helps us make JG Youth better.
              </p>
            </motion.div>
          ) : (
            <motion.div
              key="form"
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 26 }}
              className="p-6"
            >
              <div className="mb-4 flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
                  <Sparkles className="h-4 w-4 text-primary" />
                </span>
                <div>
                  <DialogTitle className="font-[family-name:var(--app-font-heading)] text-xl font-semibold tracking-tight">
                    {heading}
                  </DialogTitle>
                  <p className="text-sm text-muted-foreground">{subtitle}</p>
                </div>
              </div>

              <div className="mb-3 flex flex-wrap gap-2">
                {prompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => setContent((c) => (c ? c : prompt + "\n"))}
                    className="rounded-full border border-border bg-muted/60 px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                  >
                    {prompt}
                  </button>
                ))}
              </div>

              <Textarea
                autoFocus
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Share anything on your mind…"
                rows={4}
                className="resize-none rounded-xl"
              />

              <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-muted-foreground select-none">
                <input
                  type="checkbox"
                  checked={anonymous}
                  onChange={(e) => setAnonymous(e.target.checked)}
                  className="h-4 w-4 rounded border-border accent-primary"
                />
                Submit anonymously
              </label>

              <div className="mt-5 flex justify-end gap-2">
                <Button variant="ghost" onClick={close} className="rounded-xl">
                  Maybe later
                </Button>
                <Button onClick={handleSubmit} disabled={submitting} className="rounded-xl">
                  {submitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Sending…
                    </>
                  ) : (
                    "Send feedback"
                  )}
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
