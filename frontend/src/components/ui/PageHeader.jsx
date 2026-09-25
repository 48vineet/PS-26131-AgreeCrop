import { ChevronLeft } from "lucide-react";
import { Link } from "react-router-dom";

export default function PageHeader({
  title,
  subtitle,
  actions,
  backTo,
  className = "",
}) {
  return (
    <div
      className={`
        flex
        flex-col
        gap-4
        sm:flex-row
        sm:items-start
        sm:justify-between
        ${className}
      `}
    >
      <div className="min-w-0">
        {backTo && (
          <Link
            to={backTo}
            className="
              -ml-1
              mb-2
              inline-flex
              items-center
              gap-1
              rounded-sm
              px-1
              text-sm
              font-medium
              text-muted-foreground
              transition-colors
              duration-150
              hover:text-primary
              focus-visible:outline-none
              focus-visible:ring-2
              focus-visible:ring-primary
              focus-visible:ring-offset-2
              focus-visible:ring-offset-background
            "
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            Back
          </Link>
        )}

        <h1
          className="
            text-2xl
            font-semibold
            tracking-tight
            text-foreground
            md:text-3xl
          "
        >
          {title}
        </h1>

        {subtitle && (
          <p
            className="
              mt-1.5
              max-w-2xl
              text-sm
              leading-relaxed
              text-muted-foreground
              md:text-base
            "
          >
            {subtitle}
          </p>
        )}
      </div>

      {actions && (
        <div
          className="
            flex
            shrink-0
            items-center
            gap-2
          "
        >
          {actions}
        </div>
      )}
    </div>
  );
}
