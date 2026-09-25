const STATUS = {
  healthy: {
    dot: "bg-primary",
    text: "text-primary",
    bg: "bg-primary/10",
  },

  warning: {
    dot: "bg-accent",
    text: "text-accent-foreground",
    bg: "bg-accent/15",
  },

  danger: {
    dot: "bg-destructive",
    text: "text-destructive",
    bg: "bg-destructive/10",
  },

  info: {
    dot: "bg-muted-foreground",
    text: "text-foreground",
    bg: "bg-muted",
  },

  neutral: {
    dot: "bg-muted-foreground",
    text: "text-muted-foreground",
    bg: "bg-muted/60",
  },

  pending: {
    dot: "bg-muted-foreground",
    text: "text-muted-foreground",
    bg: "bg-muted/60",
  },
};

export default function StatusBadge({
  status = "neutral",
  children,
  className = "",
}) {
  const s = STATUS[status] || STATUS.neutral;

  return (
    <span
      className={`
        inline-flex
        items-center
        gap-1.5
        rounded-full
        px-2.5
        py-1
        text-xs
        font-medium
        leading-none
        ${s.bg}
        ${s.text}
        ${className}
      `}
    >
      <span
        className={`
          h-1.5
          w-1.5
          shrink-0
          rounded-full
          ${s.dot}
        `}
        aria-hidden="true"
      />

      {children}
    </span>
  );
}
