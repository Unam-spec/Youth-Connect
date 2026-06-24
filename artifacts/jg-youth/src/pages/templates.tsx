import { useEffect, useState } from "react";
import { Redirect } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MessageSquare, Loader2, Save, Megaphone } from "lucide-react";
import { DashboardLayout } from "@/components/dashboard-layout";
import { getLeaderSession } from "@/lib/auth";
import { useApiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface WhatsappTemplate {
  id: string;
  template_type: string;
  stage_weeks: number | null;
  message_text: string;
  color_hex: string;
}

const PLACEHOLDER_HINTS: Record<string, string[]> = {
  follow_up: ["[User]", "[Leader]"],
  event_creation: ["[User]", "[Event]", "[Date]", "[Time]", "[Location]"],
};

function stageLabel(t: WhatsappTemplate): string {
  if (t.template_type === "event_creation") return "Event announcement";
  if (t.template_type === "follow_up" && t.stage_weeks != null)
    return `${t.stage_weeks} weeks absent`;
  return t.template_type;
}

function TemplateCard({ template }: { template: WhatsappTemplate }) {
  const apiFetch = useApiFetch();
  const queryClient = useQueryClient();
  const [text, setText] = useState(template.message_text);
  const [color, setColor] = useState(template.color_hex || "#2A9D8F");

  // Re-sync if the server copy changes (e.g. after invalidation).
  useEffect(() => {
    setText(template.message_text);
    setColor(template.color_hex || "#2A9D8F");
  }, [template.message_text, template.color_hex]);

  const dirty = text !== template.message_text || color !== template.color_hex;
  const hints = PLACEHOLDER_HINTS[template.template_type] ?? [];

  const save = useMutation({
    mutationFn: async () => {
      const res = await apiFetch(`/api/whatsapp-templates/${template.id}`, {
        method: "PATCH",
        body: JSON.stringify({ message_text: text.trim(), color_hex: color }),
      });
      if (!res.ok) throw new Error("Failed to save template");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-templates"] });
      toast.success("Template saved");
    },
    onError: () => toast.error("Couldn't save template"),
  });

  return (
    <Card className="border-border bg-card">
      <CardContent className="p-5 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span
              className="h-3.5 w-3.5 rounded-full ring-2 ring-background"
              style={{ backgroundColor: color }}
              aria-hidden
            />
            <span className="text-sm font-semibold text-foreground">
              {stageLabel(template)}
            </span>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Colour
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-7 w-9 cursor-pointer rounded border border-border bg-transparent p-0.5"
              aria-label="Template colour"
            />
            <Input
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-7 w-24 font-mono text-xs"
            />
          </label>
        </div>

        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          className="resize-none rounded-xl"
        />

        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {hints.map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setText((t) => `${t}${t.endsWith(" ") || t === "" ? "" : " "}${h}`)}
                className="rounded-full border border-border bg-muted/60 px-2 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                title={`Insert ${h}`}
              >
                {h}
              </button>
            ))}
          </div>
          <Button
            size="sm"
            className="rounded-xl"
            disabled={!dirty || save.isPending || !text.trim()}
            onClick={() => save.mutate()}
          >
            {save.isPending ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</>
            ) : (
              <><Save className="mr-2 h-4 w-4" />Save</>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Templates() {
  const session = getLeaderSession();
  const apiFetch = useApiFetch();

  const { data: templates, isLoading } = useQuery<WhatsappTemplate[]>({
    queryKey: ["whatsapp-templates"],
    queryFn: async () => {
      const res = await apiFetch("/api/whatsapp-templates");
      if (!res.ok) throw new Error("Failed to load templates");
      return res.json();
    },
    enabled: !!session,
  });

  if (!session) return <Redirect to="/leader-login" />;

  const followUps = (templates ?? [])
    .filter((t) => t.template_type === "follow_up")
    .sort((a, b) => (a.stage_weeks ?? 0) - (b.stage_weeks ?? 0));
  const eventTemplates = (templates ?? []).filter(
    (t) => t.template_type === "event_creation",
  );

  return (
    <DashboardLayout active="templates">
      <div className="space-y-6 pb-12">
        <div className="rounded-2xl border border-border bg-card p-6">
          <div className="mb-2 flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-primary" />
            <span className="text-xs font-semibold uppercase tracking-widest text-primary">
              WhatsApp
            </span>
          </div>
          <h1 className="font-[family-name:var(--app-font-heading)] text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Message Templates
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Edit the wording and colour for automated WhatsApp messages. Tap a
            placeholder to insert it — it's filled in per recipient when sent.
          </p>
        </div>

        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-48 w-full rounded-2xl" />
            ))}
          </div>
        ) : (
          <>
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <Megaphone className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">
                  Event announcement
                </h2>
              </div>
              {eventTemplates.length > 0 ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  {eventTemplates.map((t) => (
                    <TemplateCard key={t.id} template={t} />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No event-creation template configured.
                </p>
              )}
            </section>

            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">
                  Follow-up messages (by weeks absent)
                </h2>
              </div>
              {followUps.length > 0 ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  {followUps.map((t) => (
                    <TemplateCard key={t.id} template={t} />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No follow-up templates configured.
                </p>
              )}
            </section>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
