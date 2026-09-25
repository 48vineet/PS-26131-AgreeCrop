import { ChevronDown } from "lucide-react";
import { forwardRef, useId } from "react";
import Field from "./Field";

const Select = forwardRef(function Select(
  { label, error, hint, required, className = "", id, children, ...props },
  ref,
) {
  const generatedId = useId();
  const selectId = id || generatedId;

  const descriptionId = error
    ? `${selectId}-error`
    : hint
      ? `${selectId}-hint`
      : undefined;

  return (
    <Field
      label={label}
      htmlFor={selectId}
      required={required}
      error={error}
      hint={hint}
    >
      <div className="relative">
        <select
          ref={ref}
          id={selectId}
          aria-invalid={!!error}
          aria-describedby={descriptionId}
          className={`
            h-10
            w-full
            appearance-none
            rounded-md
            border
            bg-card
            pl-3
            pr-9
            text-sm
            text-foreground

            transition-colors
            duration-150

            focus:border-primary
            focus:outline-none
            focus:ring-2
            focus:ring-primary/25

            disabled:cursor-not-allowed
            disabled:bg-muted/40
            disabled:text-muted-foreground
            disabled:opacity-80

            ${
              error
                ? `
                  border-destructive
                  focus:border-destructive
                  focus:ring-destructive/20
                `
                : "border-border"
            }

            ${className}
          `}
          {...props}
        >
          {children}
        </select>

        <ChevronDown
          className="
            pointer-events-none
            absolute
            right-3
            top-1/2
            h-4
            w-4
            -translate-y-1/2
            text-muted-foreground
          "
          aria-hidden="true"
        />
      </div>
    </Field>
  );
});

export default Select;
