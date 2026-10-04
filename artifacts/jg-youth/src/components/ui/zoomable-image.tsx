import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * A profile picture you can tap to see full size. Drop-in for an <img>: the
 * tap doesn't bubble, so it works inside clickable rows and cards.
 */
export function ZoomableImage({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label={`View ${alt}'s photo`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className="contents cursor-zoom-in"
      >
        <img src={src} alt={alt} className={cn("cursor-zoom-in", className)} />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="flex w-auto max-w-[90vw] flex-col items-center border-none bg-transparent p-0 shadow-none sm:max-w-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <DialogTitle className="sr-only">{alt}</DialogTitle>
          {/* Fixed width so small stored photos still show large. */}
          <img
            src={src}
            alt={alt}
            className="aspect-square w-[85vw] max-w-md rounded-2xl bg-black/40 object-contain shadow-2xl"
          />
          <p className="mt-3 rounded-full bg-black/60 px-3 py-1 text-sm font-medium text-white">{alt}</p>
        </DialogContent>
      </Dialog>
    </>
  );
}
