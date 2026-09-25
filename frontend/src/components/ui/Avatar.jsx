const SIZES = {
  sm: "w-8 h-8 text-xs",
  md: "w-10 h-10 text-sm",
};

function initials(name = "") {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export default function Avatar({ name, src, size = "md", className = "" }) {
  const sizeClass = SIZES[size] || SIZES.md;

  if (src) {
    return (
      <img
        src={src}
        alt={name || "Avatar"}
        className={`
          ${sizeClass}
          shrink-0
          rounded-full
          object-cover
          border
          border-border
          bg-card
          ${className}
        `}
      />
    );
  }

  return (
    <div
      className={`
        ${sizeClass}
        shrink-0
        rounded-full
        border
        border-primary/20
        bg-primary/10
        text-primary
        font-semibold
        flex
        items-center
        justify-center
        ${className}
      `}
      aria-hidden={!name}
    >
      {initials(name) || "?"}
    </div>
  );
}
