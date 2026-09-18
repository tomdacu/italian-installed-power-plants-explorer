import { forwardRef, useId } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectOption {
  label: string;
  value: string;
  disabled?: boolean;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
  options: SelectOption[];
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, hint, options, placeholder, id, ...props }, ref) => {
    const generated = useId();
    const selectId = id ?? generated;
    return (
      <div className="space-y-1.5">
        {label && (
          <label htmlFor={selectId} className="text-sm font-medium text-ink-700 dark:text-ink-200">
            {label}
          </label>
        )}
        <div className="relative">
          <select
            id={selectId}
            ref={ref}
            className={cn("input appearance-none pr-9", className)}
            {...props}
          >
            {placeholder !== undefined && <option value="">{placeholder}</option>}
            {options.map((o) => (
              <option key={o.value} value={o.value} disabled={o.disabled}>
                {o.label}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute inset-y-0 right-3 my-auto h-4 w-4 text-ink-400" />
        </div>
        {hint && <p className="text-xs text-ink-500 dark:text-ink-400">{hint}</p>}
      </div>
    );
  },
);
Select.displayName = "Select";

export function toOptions(values: Array<string | number | null | undefined>): SelectOption[] {
  return (values.filter(Boolean) as Array<string | number>).map((v) => ({
    label: String(v),
    value: String(v),
  }));
}
