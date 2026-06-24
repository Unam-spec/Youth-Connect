import { forwardRef } from "react";
import { PhoneInput as ReactPhoneInput, defaultCountries } from "react-international-phone";
import "react-international-phone/style.css";
import { cn } from "@/lib/utils";

interface PhoneInputProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
}

export const PhoneInput = forwardRef<HTMLInputElement, PhoneInputProps>(
  ({ value, onChange, className, disabled }, _ref) => {
    return (
      <ReactPhoneInput
        defaultCountry="za"
        countries={defaultCountries}
        value={value}
        onChange={onChange}
        disabled={disabled}
        inputClassName={cn(
          "flex h-10 w-full rounded-r-md border border-l-0 border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          "!border-l-0" // override library style
        )}
        countrySelectorStyleProps={{
          buttonClassName: cn(
            "flex h-10 items-center justify-center rounded-l-md border border-input bg-muted/50 px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
            "!h-10 !rounded-l-md !bg-muted/50"
          ),
        }}
        className={cn("flex w-full", className)}
      />
    );
  },
);
PhoneInput.displayName = "PhoneInput";
