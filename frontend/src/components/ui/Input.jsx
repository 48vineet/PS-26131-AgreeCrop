import { forwardRef } from "react";
import Field from "./Field";

const Input = forwardRef(function Input(
  { label, error, hint, required, className = "", id, ...props },
  ref,
) {
  const descriptionId = error
    ? `${id}-error`
    : hint
      ? `${id}-hint`
      : undefined;

  return (
    <Field label={label} htmlFor={id} required={required} error={error} hint={hint}>
      <input
        ref={ref}
        id={id}
        aria-invalid={!!error}
        aria-describedby={descriptionId}
        className={`
          h-10
          w-full
          rounded-md
          border
          bg-card
          px-3
          text-sm
          text-foreground
          placeholder:text-muted-foreground

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
      />
    </Field>
  );
});

export default Input;
