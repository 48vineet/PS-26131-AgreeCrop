const VARIANTS = {
  neutral: "bg-muted/60 text-muted-foreground",

  primary: "bg-primary/10 text-primary",

  success: "bg-primary/10 text-primary",

  warning: "bg-accent/15 text-accent-foreground",

  danger: "bg-destructive/10 text-destructive",

  info: "bg-muted text-foreground",
};

export default function Badge({
  variant = "neutral",
  className = "",
  children,
  ...props
}) {
  const variantClass = VARIANTS[variant] || VARIANTS.neutral;

  return (
    <span
      className={`
        inline-flex
        items-center
        whitespace-nowrap
        px-2.5
        py-1
        text-xs
        font-medium
        leading-none
        rounded-full
        ${variantClass}
        ${className}
      `}
      {...props}
    >
      {children}
    </span>
  );
}
