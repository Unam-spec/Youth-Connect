import { useQuery } from "@tanstack/react-query";
import { Cake } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { ZoomableImage } from "@/components/ui/zoomable-image";

interface TodayBirthday {
  id: string;
  full_name: string;
  avatar_url: string | null;
  is_me: boolean;
}

/**
 * "It's X's birthday today!" — shown to every signed-in member (email or PIN)
 * so people without push notifications still see it. Hidden when nobody has
 * a birthday today.
 */
export function BirthdayBanner({ hideOwnWish = false }: { hideOwnWish?: boolean }) {
  const { data } = useQuery({
    queryKey: ["birthdays", "today"],
    queryFn: async () => {
      const res = await apiFetch("/api/birthdays/today");
      if (!res.ok) return [];
      return ((await res.json()) as { today: TodayBirthday[] }).today;
    },
    staleTime: 10 * 60 * 1000,
  });

  // The member dashboard has its own "Happy birthday" banner for you.
  const mine = hideOwnWish ? undefined : data?.find((b) => b.is_me);
  const others = (data ?? []).filter((b) => !b.is_me);
  if (!mine && others.length === 0) return null;
  const names = others.map((b) => b.full_name.split(" ")[0]);
  const joined = names.length <= 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

  return (
    <section className="space-y-3 rounded-2xl border-2 border-pink-400/40 bg-gradient-to-r from-pink-500/10 via-amber-400/10 to-transparent p-5">
      {mine && (
        <p className="text-base font-semibold text-foreground">
          🎉 Happy birthday, {mine.full_name.split(" ")[0]}! From all of us at JG Youth 🎂
        </p>
      )}
      {others.length > 0 && (
        <div className="flex items-center gap-3">
          <div className="flex -space-x-3">
            {others.slice(0, 4).map((b) =>
              b.avatar_url && !b.avatar_url.startsWith("gradient:") ? (
                <ZoomableImage
                  key={b.id}
                  src={b.avatar_url}
                  alt={b.full_name}
                  className="h-11 w-11 rounded-full border-2 border-background object-cover"
                />
              ) : (
                <span
                  key={b.id}
                  className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-background bg-pink-500/20 text-sm font-bold text-pink-700"
                >
                  {b.full_name.charAt(0).toUpperCase()}
                </span>
              ),
            )}
          </div>
          <p className="flex-1 text-sm text-foreground">
            <Cake className="mr-1 inline h-4 w-4 text-pink-600" />
            It's <span className="font-semibold">{joined}</span>'s birthday today! Wish{" "}
            {others.length === 1 ? "them" : "them all"} a happy birthday 🎉
          </p>
        </div>
      )}
    </section>
  );
}
