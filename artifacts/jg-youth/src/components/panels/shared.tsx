import { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function KpiCard({
  title,
  value,
  loading,
  icon,
  lastUpdated,
  accent,
}: {
  title: string;
  value?: number;
  loading: boolean;
  icon: ReactNode;
  lastUpdated?: string | null;
  accent?: "teal" | "cyan" | "blue" | "indigo";
}) {
  const borderMap = {
    teal: "border-t-teal-500",
    cyan: "border-t-cyan-500",
    blue: "border-t-blue-500",
    indigo: "border-t-indigo-500",
  };
  return (
    <Card
      className={`border-t-2 ${borderMap[accent ?? "teal"]} bg-card/60 backdrop-blur-sm`}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-4 px-4">
        <CardTitle className="text-xs font-medium text-muted-foreground">
          {title}
        </CardTitle>
        {icon}
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {loading ? (
          <>
            <Skeleton className="h-8 w-14" />
            <Skeleton className="mt-1.5 h-2.5 w-24" />
          </>
        ) : (
          <>
            <div className="text-3xl font-bold tabular-nums">{value ?? 0}</div>
            {lastUpdated && (
              <p className="mt-1 text-xs text-muted-foreground">
                Updated {lastUpdated}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
export function DashCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={`p-6 border border-border rounded-2xl bg-card text-card-foreground ${className || ""}`}>
      {children}
    </div>
  );
}

export function SectionTitle({ title, icon }: { title: string; icon?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      {icon}
      <h3 className="font-[family-name:var(--app-font-heading)] text-base font-semibold tracking-tight text-foreground">{title}</h3>
    </div>
  );
}

export function EmptyState({ text }: { text: string }) {
  return (
    <div className="py-10 text-center">
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

export function SkeletonRows({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full rounded-xl" />
      ))}
    </div>
  );
}

export function RoleBadge({ role }: { role: string }) {
  let classes = "";
  switch (role) {
    case "super_admin":
      classes = "bg-primary/10 text-primary border-primary/25";
      break;
    case "leader":
      classes = "bg-blue-600/10 text-blue-700 border-blue-600/25";
      break;
    case "member":
      classes = "bg-muted text-foreground border-border";
      break;
    default:
      classes = "bg-muted text-muted-foreground border-border";
  }
  return (
    <Badge className={`${classes} text-xs`} variant="outline">
      {role ? role?.replace("_", " ") : "Visitor"}
    </Badge>
  );
}

export function SimpleTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: (string | ReactNode)[][];
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border/50">
      <table className="w-full text-sm">
        <thead className="bg-muted/25 border-b border-border/50">
          <tr>
            {headers.map((h) => (
              <th
                key={h}
                className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground uppercase tracking-wide whitespace-nowrap"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/40">
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-muted/15 transition-colors">
              {row.map((cell, j) => (
                <td key={`${i}-${j}`} className="px-4 py-3 text-sm">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface PendingCheckIn {
  id: string;
  name: string;
  phone: string | null;
  type: "member" | "visitor";
  role: string;
  requested_at: string;
  age?: number | null;
  school?: string | null;
  parent_phone?: string | null;
  how_did_you_hear?: string | null;
}

export function CheckInCard({
  req,
  onApprove,
  onReject,
  isFirstTimer = false,
}: {
  req: PendingCheckIn;
  onApprove: () => void;
  onReject: () => void;
  isFirstTimer?: boolean;
}) {
  return (
    <div
      className={`flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between transition-colors ${
        isFirstTimer
          ? "border-amber-500/40 bg-amber-500/10 dark:border-amber-500/30 dark:bg-amber-500/5 hover:border-amber-500/60"
          : "border-teal-500/40 bg-teal-500/10 dark:border-teal-500/30 dark:bg-teal-500/5 hover:border-teal-500/60"
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`h-9 w-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
            isFirstTimer
              ? "bg-amber-500/20 text-amber-700 dark:text-amber-300"
              : "bg-teal-500/20 text-teal-700 dark:text-teal-300"
          }`}
        >
          {req.name?.charAt(0)?.toUpperCase() ?? "?"}
        </div>
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-sm">{req.name}</p>
            {isFirstTimer && (
              <Badge
                variant="outline"
                className="text-xs text-amber-700 dark:text-amber-300 border-amber-500/40 bg-amber-500/15 dark:bg-amber-500/10 py-0"
              >
                First Timer
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {req.phone ?? "No phone"} •{" "}
            {format(new Date(req.requested_at), "HH:mm")}
          </p>
        </div>
      </div>
      <div className="flex gap-2 shrink-0">
        <Button
          size="sm"
          onClick={onApprove}
          className={`h-7 text-xs border-0 text-white font-medium ${isFirstTimer ? "bg-amber-600 hover:bg-amber-500 dark:bg-amber-500 dark:hover:bg-amber-400" : "bg-teal-600 hover:bg-teal-500 dark:bg-teal-500 dark:hover:bg-teal-400"}`}
        >
          Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onReject}
          className="h-7 text-xs"
        >
          Reject
        </Button>
      </div>
    </div>
  );
}
