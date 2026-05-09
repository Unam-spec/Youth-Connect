import { useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { useResolveQrSlug, getResolveQrSlugQueryKey } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Loader2 } from "lucide-react";

export default function QrResolver() {
  const params = useParams();
  const slug = params.slug;
  const [, setLocation] = useLocation();

  const { data: resolution, error, isLoading } = useResolveQrSlug(slug as string, {
    query: { enabled: !!slug, retry: false, queryKey: getResolveQrSlugQueryKey(slug ?? "") }
  });

  useEffect(() => {
    if (resolution?.redirect_to) {
      // Use window.location.href if it's an absolute URL (though it shouldn't be based on spec, but just in case)
      if (resolution.redirect_to.startsWith('http')) {
        window.location.href = resolution.redirect_to;
      } else {
        setLocation(resolution.redirect_to);
      }
    }
  }, [resolution, setLocation]);

  if (error) {
    return (
      <Layout>
        <div className="max-w-md mx-auto py-20 text-center">
          <div className="bg-destructive/10 text-destructive p-6 rounded-xl border border-destructive/20">
            <h2 className="text-xl font-bold mb-2">Invalid QR Code</h2>
            <p>This QR code is invalid or has expired.</p>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background text-foreground">
      <Loader2 className="w-12 h-12 animate-spin text-primary mb-4" />
      <p className="text-muted-foreground font-medium animate-pulse">Resolving...</p>
    </div>
  );
}
