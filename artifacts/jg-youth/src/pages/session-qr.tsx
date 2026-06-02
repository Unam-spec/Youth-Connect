import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { QRCodeSVG } from "qrcode.react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { getLeaderSession } from "@/lib/auth";
import { Redirect } from "wouter";
import { RefreshCw, Download, ChevronLeft, QrCode } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

export default function SessionQr() {
  const session = getLeaderSession();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const slug = params.get("slug");
  const { toast } = useToast();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [currentSlug, setCurrentSlug] = useState(slug);
  const [, setLocation] = useLocation();

  if (!session) return <Redirect to="/leader-login" />;

  const qrUrl = currentSlug
    ? `${window.location.origin}/checkin?session_id=${currentSlug}`
    : null;

  async function regenerate() {
    setIsRefreshing(true);
    try {
      const sessionStr = localStorage.getItem("jg_leader_session");
      const res = await fetch("/api/qrcodes/session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(sessionStr ? { "x-leader-session": sessionStr } : {}),
        },
      });
      if (res.ok) {
        const data = await res.json();
        setCurrentSlug(data.slug);
        setLocation(`/session-qr?slug=${data.slug}`, { replace: true });
        toast({ title: "New session QR generated" });
      } else {
        toast({ title: "Failed to regenerate", variant: "destructive" });
      }
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    } finally {
      setIsRefreshing(false);
    }
  }

  function downloadQR() {
    const svg = document.querySelector("#session-qr-svg") as SVGElement | null;
    if (!svg) return;
    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 400;
    const ctx = canvas.getContext("2d")!;
    const img = new Image();
    img.onload = () => {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, 400, 400);
      ctx.drawImage(img, 0, 0, 400, 400);
      const a = document.createElement("a");
      a.download = `jg-checkin-qr-${currentSlug?.slice(0, 6)}.png`;
      a.href = canvas.toDataURL("image/png");
      a.click();
    };
    img.src = "data:image/svg+xml;base64," + btoa(svgData);
  }

  return (
    <Layout>
      <div className="max-w-md mx-auto py-10 px-4">
        <Link href="/dashboard">
          <Button variant="ghost" size="sm" className="-ml-2 mb-6 text-muted-foreground gap-1">
            <ChevronLeft className="w-4 h-4" /> Back to Dashboard
          </Button>
        </Link>

        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-4">
            <QrCode className="w-7 h-7 text-primary" />
          </div>
          <h1 className="font-[family-name:var(--app-font-heading)] text-3xl font-semibold tracking-tight text-foreground">Tonight's Check-In QR</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Display this on screen — members scan it to check in
          </p>
        </div>

        {qrUrl ? (
          <div className="flex flex-col items-center gap-6">
            <div className="bg-white p-6 rounded-3xl border border-border">
              <QRCodeSVG
                id="session-qr-svg"
                value={qrUrl}
                size={280}
                level="H"
                includeMargin={false}
              />
            </div>

            <div className="w-full rounded-2xl border border-border bg-muted px-4 py-3 text-center">
              <p className="text-xs text-muted-foreground font-mono break-all">{qrUrl}</p>
            </div>

            <div className="flex gap-3 w-full">
              <Button
                variant="outline"
                className="flex-1 rounded-xl gap-2"
                onClick={regenerate}
                disabled={isRefreshing}
              >
                <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} />
                New QR
              </Button>
              <Button
                className="flex-1 rounded-xl gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
                onClick={downloadQR}
              >
                <Download className="w-4 h-4" />
                Download
              </Button>
            </div>

            <p className="text-xs text-muted-foreground text-center">
              This QR expires when you generate a new one. Keep this page open during the service.
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 py-10">
            <p className="text-muted-foreground text-sm">No QR code yet.</p>
            <Button
              className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={regenerate}
              disabled={isRefreshing}
            >
              {isRefreshing ? "Generating..." : "Generate Session QR"}
            </Button>
          </div>
        )}
      </div>
    </Layout>
  );
}
