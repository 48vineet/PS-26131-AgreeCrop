export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
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
      {Icon && (
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
            border-border
            bg-muted/50
          "
        >
          <Icon className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
        </div>
      )}

      <p className="text-base font-semibold tracking-tight text-foreground">
        {title}
      </p>

      {description && (
        <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}

      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
