import { forwardRef, useId } from "react";

const Checkbox = forwardRef(function Checkbox(
  { label, error, className = "", id, ...props },
  ref,
) {
  const generatedId = useId();
  const checkboxId = id || generatedId;

  return (
    <div className={className}>
      <div className="flex items-start gap-2.5">
        <input
          ref={ref}
          type="checkbox"
          id={checkboxId}
          className="
            mt-0.5
            h-4
            w-4
            shrink-0
            cursor-pointer
            rounded-sm
            border-border
            bg-card
            text-primary

            accent-primary

            focus:outline-none
            focus:ring-2
            focus:ring-primary/25
            focus:ring-offset-0

            disabled:cursor-not-allowed
            disabled:opacity-50

            transition-colors
            duration-150
          "
          {...props}
        />

        {label && (
          <label
            htmlFor={checkboxId}
            className="
              cursor-pointer
              select-none
              text-sm
              leading-5
              text-foreground
            "
          >
            {label}
          </label>
        )}
      </div>

      {error && (
        <p
          className="
            mt-1.5
            text-xs
            leading-5
            text-destructive
          "
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
});

export default Checkbox;
