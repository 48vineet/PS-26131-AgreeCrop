import { forwardRef, useId } from "react";
import Field from "./Field";

const Textarea = forwardRef(function Textarea(
  { label, error, hint, required, className = "", id, rows = 4, ...props },
  ref,
) {
  const generatedId = useId();
  const textareaId = id || generatedId;

  const descriptionId = error
    ? `${textareaId}-error`
    : hint
      ? `${textareaId}-hint`
      : undefined;

  return (
    <Field
      label={label}
      htmlFor={textareaId}
      required={required}
      error={error}
      hint={hint}
    >
      <textarea
        ref={ref}
        id={textareaId}
        rows={rows}
        aria-invalid={!!error}
        aria-describedby={descriptionId}
        className={`
          w-full
          rounded-md
          border
          bg-card
          px-3
          py-2.5
          text-sm
          leading-relaxed
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

          resize-none

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

export default Textarea;
