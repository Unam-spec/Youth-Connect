import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, XCircle, Clock } from "lucide-react";

interface CheckInWaitingStateProps {
  requestId: string;
  memberName?: string;
  onStatusChange?: (status: "approved" | "rejected" | "timeout") => void;
}

export function CheckInWaitingState({ requestId, memberName, onStatusChange }: CheckInWaitingStateProps) {
  const [status, setStatus] = useState<"pending" | "approved" | "rejected" | "timeout">("pending");

  useEffect(() => {
    if (!requestId || status !== "pending") return;

    let timeoutId: NodeJS.Timeout;
    const eventSource = new EventSource(`/api/checkin/stream/${requestId}`);

    const cleanup = () => {
      eventSource.close();
      clearTimeout(timeoutId);
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.status === "approved" || data.status === "rejected") {
          setStatus(data.status);
          onStatusChange?.(data.status);
          cleanup();
        }
      } catch (err) {
        console.error("Failed to parse SSE data", err);
      }
    };

    eventSource.onerror = () => {
      console.warn("SSE stream error/disconnect");
    };

    timeoutId = setTimeout(() => {
      setStatus("timeout");
      onStatusChange?.("timeout");
      cleanup();
    }, 5 * 60 * 1000);

    return cleanup;
  }, [requestId, status, onStatusChange]);

  if (status === "approved") {
    return (
      <div className="rounded-3xl bg-gradient-to-br from-[#30D158]/15 to-[#30D158]/5 border border-[#30D158]/30 p-10 flex flex-col items-center text-center gap-4 shadow-sm animate-in zoom-in-95 duration-300">
        <div className="w-20 h-20 rounded-full bg-[#30D158]/20 flex items-center justify-center">
          <CheckCircle2 className="w-10 h-10 text-[#30D158]" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-[#30D158]">
            {memberName ? `${memberName} Checked In!` : "Checked In!"}
          </h2>
          <p className="text-muted-foreground mt-1">You're all set. Enjoy the service!</p>
        </div>
        <Link href="/">
          <Button variant="outline" className="mt-2 rounded-xl px-8">Return Home</Button>
        </Link>
      </div>
    );
  }

  if (status === "rejected") {
    return (
      <div className="rounded-3xl bg-gradient-to-br from-destructive/15 to-destructive/5 border border-destructive/30 p-10 flex flex-col items-center text-center gap-4 shadow-sm animate-in zoom-in-95 duration-300">
        <div className="w-20 h-20 rounded-full bg-destructive/20 flex items-center justify-center">
          <XCircle className="w-10 h-10 text-destructive" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-destructive">Check-in was not approved — please speak to a leader</h2>
          <p className="text-muted-foreground mt-1">Please speak to a leader for assistance.</p>
        </div>
        <Link href="/">
          <Button variant="outline" className="mt-2 rounded-xl px-8">Return Home</Button>
        </Link>
      </div>
    );
  }

  if (status === "timeout") {
    return (
      <div className="rounded-3xl bg-gradient-to-br from-destructive/15 to-destructive/5 border border-destructive/30 p-10 flex flex-col items-center text-center gap-4 shadow-sm animate-in zoom-in-95 duration-300">
        <div className="w-20 h-20 rounded-full bg-destructive/20 flex items-center justify-center">
          <Clock className="w-10 h-10 text-destructive" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-destructive">Check-in request timed out. Please ask a leader to check you in manually.</h2>
        </div>
        <Link href="/">
          <Button variant="outline" className="mt-2 rounded-xl px-8">Return Home</Button>
        </Link>
      </div>
    );
  }

  // Pending State
  return (
    <div className="rounded-3xl bg-gradient-to-br from-[#FF9F0A]/15 to-[#FF9F0A]/5 border border-[#FF9F0A]/30 p-10 flex flex-col items-center text-center gap-4 shadow-sm animate-in fade-in duration-300">
      <div className="relative w-20 h-20 flex items-center justify-center">
        <div className="absolute inset-0 rounded-full border-4 border-[#FF9F0A] animate-pulse"></div>
        <Clock className="w-8 h-8 text-[#FF9F0A] absolute" />
      </div>
      <div>
        <h2 className="text-2xl font-bold text-[#FF9F0A]">Pending Approval</h2>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed max-w-[250px] mx-auto">
          Your check-in was submitted. A leader will approve it shortly. Please wait...
        </p>
      </div>
      <div className="mt-2 flex items-center text-xs font-medium text-[#FF9F0A]/80 bg-[#FF9F0A]/10 px-3 py-1.5 rounded-full">
        <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> Live updates active
      </div>
    </div>
  );
}
