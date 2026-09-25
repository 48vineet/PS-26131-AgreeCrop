export default function SectionHeader({
  title,
  subtitle,
  action,
  className = "",
}) {
  return (
    <div
      className={`
        mb-4
        flex
        items-center
        justify-between
        gap-4
        ${className}
      `}
    >
      <div className="min-w-0">
        <h2
          className="
            text-lg
            font-semibold
            tracking-tight
            text-foreground
            md:text-xl
          "
        >
          {title}
        </h2>

        {subtitle && (
          <p
            className="
              mt-0.5
              text-sm
              leading-relaxed
              text-muted-foreground
            "
          >
            {subtitle}
          </p>
        )}
      </div>

      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
