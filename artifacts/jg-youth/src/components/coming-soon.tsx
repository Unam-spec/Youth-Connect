import { MessageCircle } from "lucide-react";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

interface ComingSoonProps {
  title?: string;
  description?: string;
}

export function ComingSoon({
  title = "Coming soon",
  description = "We're building a leader communication channel so your team can stay connected. Check back soon.",
}: ComingSoonProps) {
  return (
    <Empty className="min-h-[400px] border border-dashed border-border/60 bg-muted/10">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <MessageCircle className="size-6 text-primary" />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <p className="text-xs text-muted-foreground">
          This feature is paused while we finish the rest of the platform.
        </p>
      </EmptyContent>
    </Empty>
  );
}
