"use client";

import { useRef } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type SearchInputProps = {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  "aria-label"?: string;
  /** Classes for the inner <input> (height, radius, colors). */
  className?: string;
  /** Classes for the wrapping relative container (width, margins). */
  containerClassName?: string;
  /** Colour/position override for the leading search icon. */
  iconClassName?: string;
  /** Colour override for the clear button (dark themes). */
  clearClassName?: string;
};

// Search field with a leading magnifier and a functional clear (X) button that
// only appears when there is text. Clearing resets the value and refocuses the
// input so the user can keep typing. type="text" (not "search") so we render our
// own clear control instead of the inconsistent native one.
export function SearchInput({
  value,
  onValueChange,
  placeholder,
  "aria-label": ariaLabel,
  className,
  containerClassName,
  iconClassName,
  clearClassName,
}: SearchInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const hasValue = value.length > 0;

  return (
    <div className={cn("relative", containerClassName)}>
      <Search
        className={cn(
          "pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground",
          iconClassName,
        )}
      />
      <Input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={cn("pl-10", hasValue && "pr-10", className)}
      />
      {hasValue && (
        <button
          type="button"
          onClick={() => {
            onValueChange("");
            inputRef.current?.focus();
          }}
          aria-label="Clear search"
          className={cn(
            "absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
            clearClassName,
          )}
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}
