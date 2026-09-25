const STATUS = {
  success: {
    bg: "bg-primary/10",
    icon: "text-primary",
    dot: "bg-primary",
  },

  warning: {
    bg: "bg-accent/15",
    icon: "text-accent-foreground",
    dot: "bg-accent",
  },

  danger: {
    bg: "bg-destructive/10",
    icon: "text-destructive",
    dot: "bg-destructive",
  },

  info: {
    bg: "bg-muted",
    icon: "text-foreground",
    dot: "bg-muted-foreground",
  },

  neutral: {
    bg: "bg-muted/60",
    icon: "text-muted-foreground",
    dot: "bg-muted-foreground",
  },
};

export default function Timeline({ items, className = "" }) {
  if (!items || items.length === 0) {
    return (
      <div
        className={`
          text-sm
          text-muted-foreground
          ${className}
        `}
      >
        No history yet.
      </div>
    );
  }

  return (
    <div className={className}>
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        const s = STATUS[item.status] || STATUS.neutral;
        const Icon = item.icon;

        return (
          <div
            key={item.id}
            className="
              relative
              flex
              gap-3
              pb-6
              last:pb-0
            "
          >
            {/* Timeline connector */}
            {!isLast && (
              <span
                className="
                  absolute
                  bottom-0
                  left-4
                  top-8
                  border-l-2
                  border-border
                "
                aria-hidden="true"
              />
            )}

            {/* Status marker */}
            <span
              className={`
                relative
                z-10
                flex
                h-8
                w-8
                shrink-0
                items-center
                justify-center
                rounded-full
                ${s.bg}
              `}
            >
              {Icon ? (
                <Icon
                  className={`
                    h-4
                    w-4
                    ${s.icon}
                  `}
                  aria-hidden="true"
                />
              ) : (
                <span
                  className={`
                    h-2
                    w-2
                    rounded-full
                    ${s.dot}
                  `}
                  aria-hidden="true"
                />
              )}
            </span>

            {/* Content */}
            <div className="min-w-0 flex-1 pt-1">
              <p className="text-sm font-medium text-foreground">
                {item.title}
              </p>

              {item.description && (
                <p
                  className="
                    mt-0.5
                    text-sm
                    leading-relaxed
                    text-muted-foreground
                  "
                >
                  {item.description}
                </p>
              )}

              <p
                className="
                  mt-1
                  text-xs
                  tabular-nums
                  text-muted-foreground
                "
              >
                {item.timestamp}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
