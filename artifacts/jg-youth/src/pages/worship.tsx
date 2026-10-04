import { Link } from "wouter";
import {
  ArrowLeft,
  Music,
  UserCircle,
  ListMusic,
  KeyRound,
  FileText,
  Users,
  CalendarDays,
} from "lucide-react";
import { Layout } from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

// Placeholder for the Worship Team hub. The real feature (member profiles with
// personal song lists, keys and lyrics) is being built on the
// `feature/worship-team` branch; see docs/worship-team.md for the plan.
const PLANNED_FEATURES = [
  {
    icon: UserCircle,
    title: "Your worship profile",
    description: "Your role on the team (vocals, keys, guitar, drums…) and your vocal range.",
  },
  {
    icon: ListMusic,
    title: "Personal song list",
    description: "Every song you lead or play, in one place, ready to pull up at practice.",
  },
  {
    icon: KeyRound,
    title: "Your key for every song",
    description: "Save the key that suits you, so the band knows what to play when you lead.",
  },
  {
    icon: FileText,
    title: "Lyrics & chords",
    description: "Full lyrics with chord charts that transpose to your key automatically.",
  },
  {
    icon: Users,
    title: "View the team",
    description: "Open anyone's profile to see their songs and keys. Only they can edit it.",
  },
  {
    icon: CalendarDays,
    title: "Sunday setlists",
    description: "Leaders build each week's setlist from the team's songs, with keys already filled in.",
  },
];

export default function Worship() {
  return (
    <Layout>
      <div className="mx-auto max-w-3xl space-y-8">
        <Link
          href="/my"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to my dashboard
        </Link>

        <section className="relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/15 via-primary/5 to-transparent p-6 sm:p-8">
          <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-primary/10 blur-2xl" />
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary/15">
              <Music className="h-7 w-7 text-primary" />
            </div>
            <div className="space-y-1.5">
              <Badge variant="outline" className="border-primary/40 text-primary">
                Coming soon
              </Badge>
              <h1 className="font-[family-name:var(--app-font-heading)] text-3xl font-semibold tracking-tight text-foreground">
                Worship Team
              </h1>
              <p className="text-sm text-muted-foreground">
                A home for the worship team: your songs, your keys and your lyrics, all in one place.
              </p>
            </div>
          </div>
        </section>

        <section>
          <h2 className="mb-4 font-[family-name:var(--app-font-heading)] text-xl font-semibold tracking-tight text-foreground">
            What's on the way
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {PLANNED_FEATURES.map(({ icon: Icon, title, description }) => (
              <Card key={title} className="rounded-2xl">
                <CardContent className="flex gap-3 p-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <p className="text-center text-xs text-muted-foreground">
          We're still building this. Check back soon.
        </p>
      </div>
    </Layout>
  );
}
