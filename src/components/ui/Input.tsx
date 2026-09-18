import { forwardRef, useId } from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, hint, leading, trailing, id, ...props }, ref) => {
    const generated = useId();
    const inputId = id ?? generated;
    return (
      <div className="space-y-1.5">
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-ink-700 dark:text-ink-200">
            {label}
          </label>
        )}
        <div className="relative">
          {leading && (
            <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-ink-400">
              {leading}
            </span>
          )}
          <input
            id={inputId}
            ref={ref}
            className={cn("input", leading && "pl-10", trailing && "pr-10", className)}
            {...props}
          />
          {trailing && (
            <span className="absolute inset-y-0 right-2.5 flex items-center text-ink-400">{trailing}</span>
          )}
        </div>
        {hint && <p className="text-xs text-ink-500 dark:text-ink-400">{hint}</p>}
      </div>
    );
  },
);
Input.displayName = "Input";
