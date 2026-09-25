import Skeleton from "./Skeleton";

export default function LoadingState({
  variant = "cards",
  rows = 4,
  className = "",
}) {
  const loadingProps = {
    role: "status",
    "aria-label": "Loading",
    "aria-live": "polite",
  };

  /* ============================================================
     TABLE
     ============================================================ */

  if (variant === "table") {
    return (
      <div className={`space-y-2 ${className}`} {...loadingProps}>
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-11 w-full" />
        ))}
      </div>
    );
  }

  /* ============================================================
     LIST
     ============================================================ */

  if (variant === "list") {
    return (
      <div className={`space-y-3 ${className}`} {...loadingProps}>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton
              className="
                h-10
                w-10
                shrink-0
                rounded-full
              "
            />

            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-1/3" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  /* ============================================================
     PAGE
     ============================================================ */

  if (variant === "page") {
    return (
      <div className={`space-y-6 ${className}`} {...loadingProps}>
        {/* Page heading */}
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-md" />
          ))}
        </div>

        {/* Main content */}
        <Skeleton className="h-64 w-full rounded-md" />
      </div>
    );
  }

  /* ============================================================
     CARDS — DEFAULT
     ============================================================ */

  return (
    <div
      className={`
        grid
        grid-cols-1
        gap-4
        sm:grid-cols-2
        lg:grid-cols-3
        ${className}
      `}
      {...loadingProps}
    >
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-28 rounded-md" />
      ))}
    </div>
  );
}
