import { Loader2 } from "lucide-react";
import { forwardRef } from "react";

const VARIANTS = {
  primary: `
    bg-primary
    text-white
    hover:bg-secondary
    active:bg-secondary
    disabled:bg-muted
    disabled:text-muted-foreground
  `,

  secondary: `
    bg-card
    border
    border-border
    text-foreground
    hover:bg-background
    hover:border-muted-foreground/40
    active:bg-muted
    disabled:text-muted-foreground
  `,

  danger: `
    bg-destructive
    text-white
    hover:bg-red-700
    active:bg-red-800
    disabled:bg-muted
    disabled:text-muted-foreground
  `,

  ghost: `
    text-muted-foreground
    hover:bg-muted
    hover:text-foreground
    active:bg-border
  `,
};

const SIZES = {
  sm: "h-8 px-3 text-sm gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-5 text-base gap-2",
};

const Button = forwardRef(function Button(
  {
    variant = "primary",
    size = "md",
    loading = false,
    icon: Icon,
    iconPosition = "left",
    className = "",
    disabled,
    children,
    ...props
  },
  ref,
) {
  const variantClass = VARIANTS[variant] || VARIANTS.primary;

  const sizeClass = SIZES[size] || SIZES.md;

  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`
        inline-flex
        items-center
        justify-center
        font-medium
        rounded-md
        transition-colors
        duration-150

        disabled:cursor-not-allowed
        disabled:opacity-60

        focus-visible:outline-none
        focus-visible:ring-2
        focus-visible:ring-primary
        focus-visible:ring-offset-2
        focus-visible:ring-offset-background

        ${variantClass}
        ${sizeClass}
        ${className}
      `}
      {...props}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : Icon && iconPosition === "left" ? (
        <Icon className="h-4 w-4" aria-hidden="true" />
      ) : null}

      {children}

      {!loading && Icon && iconPosition === "right" && (
        <Icon className="h-4 w-4" aria-hidden="true" />
      )}
    </button>
  );
});

export default Button;
