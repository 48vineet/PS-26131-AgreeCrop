export default function Card({
  interactive = false,
  padding = "p-6",
  className = "",
  children,
  ...props
}) {
  return (
    <div
      className={`
        bg-card
        text-card-foreground
        border
        border-border
        rounded-md
        transition-colors
        duration-150

        ${padding}

        ${
          interactive
            ? `
              cursor-pointer
              hover:border-primary/50
            `
            : `
              hover:border-muted-foreground/30
            `
        }

        ${className}
      `}
      {...props}
    >
      {children}
    </div>
  );
}
