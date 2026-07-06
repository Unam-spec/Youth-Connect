import { forwardRef, useState, type ComponentProps } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface PinInputProps
  extends Omit<ComponentProps<typeof Input>, "type" | "onChange" | "value" | "maxLength"> {
  value: string;
  onChange: (value: string) => void;
  /** Hard digit cap: 6 for member PINs, 4 for leader PINs. */
  maxLength: 4 | 6;
}

/**
 * Numeric PIN field with a reveal/hide toggle. Strips non-digits as you type
 * and hard-caps the length, so callers only ever receive a valid partial PIN.
 */
export const PinInput = forwardRef<HTMLInputElement, PinInputProps>(
  ({ value, onChange, maxLength, className, ...props }, ref) => {
    const [visible, setVisible] = useState(false);
    return (
      <div className="relative w-full">
        <Input
          ref={ref}
          type={visible ? "text" : "password"}
          inputMode="numeric"
          autoComplete="off"
          maxLength={maxLength}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, maxLength))}
          className={cn("pr-11 text-center font-mono tracking-[0.4em]", className)}
          {...props}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide PIN" : "Show PIN"}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    );
  },
);
PinInput.displayName = "PinInput";
