import { AlertCircle } from "lucide-react";
import Button from "./Button";

export default function ErrorState({
  title = "Something went wrong",
  description = "We could not load this. Please try again.",
  onRetry,
  className = "",
}) {
  return (
    <div
      className={`
        flex
        flex-col
        items-center
        justify-center
        px-6
        py-12
        text-center
        ${className}
      `}
    >
      <div
        className="
          mb-4
          flex
          h-12
          w-12
          items-center
          justify-center
          rounded-full
          border
          border-destructive/20
          bg-destructive/10
        "
      >
        <AlertCircle className="h-6 w-6 text-destructive" aria-hidden="true" />
      </div>

      <p className="text-base font-semibold tracking-tight text-foreground">
        {title}
      </p>

      <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">
        {description}
      </p>

      {onRetry && (
        <div className="mt-5">
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}
