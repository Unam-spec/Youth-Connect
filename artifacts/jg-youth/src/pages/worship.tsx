import { Link } from "wouter";
import {
  ArrowLeft,
  Bell,
  Lock,
  Music,
  UserCircle,
  ListMusic,
  KeyRound,
  FileText,
  Users,
  CalendarDays,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

// Placeholder for the Worship Team hub. The real feature (member profiles with
// personal song lists, keys and lyrics) is being built on the
// `feature/worship-team` branch; see docs/worship-team.md for the plan.
//
// Deliberately standalone: worship team is its own membership, separate from
// JG Youth (some worship members aren't JG Youth members), so there's no JG
// Youth header/footer or dashboard links. The only way in is the discreet
// "Worship Team" link in the site footer.
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
    icon: Bell,
    title: "Team notifications",
    description: "Get notified when a teammate adds a new song. Only the worship team receives these.",
  },
  {
    icon: CalendarDays,
    title: "Sunday setlists",
    description: "Leaders build each week's setlist from the team's songs, with keys already filled in.",
  },
];

export default function Worship() {
  return (
    <div className="min-h-[100dvh] bg-[hsl(250,35%,8%)] text-white selection:bg-violet-400 selection:text-black">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-80 bg-gradient-to-b from-violet-600/25 to-transparent" />
      <div className="relative mx-auto max-w-3xl space-y-8 px-4 py-6 sm:py-10">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-500/20">
              <Music className="h-5 w-5 text-violet-300" />
            </div>
            <span className="font-[family-name:var(--app-font-heading)] text-lg font-semibold tracking-tight">
              Worship Team
            </span>
          </div>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs text-white/50 hover:text-white transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            JG Youth
          </Link>
        </header>

        <section className="space-y-4 pt-6 text-center sm:pt-10">
          <div className="flex justify-center gap-2">
            <Badge variant="outline" className="border-violet-400/40 text-violet-200">
              Coming soon
            </Badge>
            <Badge variant="outline" className="border-white/20 text-white/70">
              <Lock className="mr-1 h-3 w-3" />
              Members only
            </Badge>
          </div>
          <h1 className="font-[family-name:var(--app-font-heading)] text-4xl font-semibold tracking-tight sm:text-5xl">
            Your songs. Your keys.
          </h1>
          <p className="mx-auto max-w-md text-sm text-white/60">
            A private space for the worship team, with each person's song list, keys and lyrics in one place.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-white/40">
            What's on the way
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {PLANNED_FEATURES.map(({ icon: Icon, title, description }) => (
              <div
                key={title}
                className="flex gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-500/15">
                  <Icon className="h-5 w-5 text-violet-300" />
                </div>
                <div>
                  <p className="text-sm font-semibold">{title}</p>
                  <p className="mt-0.5 text-xs text-white/55">{description}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <p className="pb-4 text-center text-xs text-white/40">
          The worship team has its own membership, so you don't need to be a JG Youth member to join.
          <br />
          Worship team sign-in is coming soon.
        </p>
      </div>
    </div>
  );
}
