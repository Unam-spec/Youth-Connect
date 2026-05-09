import { useEffect, useRef } from "react";
import QRCodeLib from "qrcode";

interface QRCodeProps {
  url: string;
  size?: number;
  className?: string;
}

export function QRCode({ url, size = 200, className }: QRCodeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current) {
      QRCodeLib.toCanvas(canvasRef.current, url, {
        width: size,
        margin: 2,
        color: {
          dark: "#000000",
          light: "#ffffff",
        },
      }, (error: Error | null) => {
        if (error) console.error("Error generating QR code:", error);
      });
    }
  }, [url, size]);

  return <canvas ref={canvasRef} className={className} />;
}
