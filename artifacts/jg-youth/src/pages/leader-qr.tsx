import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { QRCode } from "@/components/ui/qr-code";
import { useGetLeaderQrCode, getGetLeaderQrCodeQueryKey, useRegenerateQrCode } from "@workspace/api-client-react";
import { getLeaderSession } from "@/lib/auth";
import { Redirect } from "wouter";
import { RefreshCw, QrCode as QrIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";

export default function LeaderQr() {
  const session = getLeaderSession();
  const { data: qr, isLoading, refetch } = useGetLeaderQrCode({ query: { enabled: !!session, queryKey: getGetLeaderQrCodeQueryKey() } });
  const regenerateQr = useRegenerateQrCode();
  const { toast } = useToast();

  if (!session) {
    return <Redirect to="/leader-login" />;
  }

  const handleRegenerate = () => {
    regenerateQr.mutate(
      { data: { type: "leader" } },
      {
        onSuccess: () => {
          refetch();
          toast({ title: "QR Code Regenerated" });
        },
      }
    );
  };

  const qrUrl = qr ? `${window.location.origin}/qr/${qr.slug}` : "";

  return (
    <Layout>
      <div className="max-w-md mx-auto py-12 text-center">
        <Card className="border-primary/20 shadow-xl">
          <CardHeader>
            <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-2">
              <QrIcon className="w-6 h-6 text-primary" />
            </div>
            <CardTitle>Leader Check-In QR</CardTitle>
            <CardDescription>
              Show this code to leaders for quick check-in. Do not share publicly.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center pb-8">
            <div className="bg-white p-4 rounded-xl mb-6 shadow-sm">
              {isLoading ? (
                <Skeleton className="w-[200px] h-[200px]" />
              ) : qr ? (
                <QRCode url={qrUrl} size={200} />
              ) : (
                <div className="w-[200px] h-[200px] flex items-center justify-center text-muted-foreground border-2 border-dashed">
                  No QR Code Active
                </div>
              )}
            </div>

            {session.role === "super_admin" && (
              <Button 
                variant="outline" 
                onClick={handleRegenerate}
                disabled={regenerateQr.isPending || isLoading}
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${regenerateQr.isPending ? "animate-spin" : ""}`} />
                Regenerate Code
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
