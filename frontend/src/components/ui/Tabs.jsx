import { useRef } from "react";

export default function Tabs({ tabs, active, onChange, className = "" }) {
  const tabRefs = useRef([]);

  const focusAndChange = (index) => {
    const tab = tabs[index];

    if (!tab) return;

    tabRefs.current[index]?.focus();
    onChange(tab.key);
  };

  const handleKeyDown = (event, index) => {
    switch (event.key) {
      case "ArrowRight":
        event.preventDefault();
        focusAndChange((index + 1) % tabs.length);
        break;

      case "ArrowLeft":
        event.preventDefault();
        focusAndChange((index - 1 + tabs.length) % tabs.length);
        break;

      case "Home":
        event.preventDefault();
        focusAndChange(0);
        break;

      case "End":
        event.preventDefault();
        focusAndChange(tabs.length - 1);
        break;

      default:
        break;
    }
  };

  return (
    <div
      role="tablist"
      className={`
        flex
        overflow-x-auto
        border-b
        border-border
        ${className}
      `}
    >
      {tabs.map(({ key, label, icon: Icon }, index) => {
        const isActive = key === active;

        return (
          <button
            key={key}
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            type="button"
            role="tab"
            id={`tab-${key}`}
            aria-selected={isActive}
            aria-controls={`tabpanel-${key}`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(key)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={`
              -mb-px
              mr-6
              flex
              shrink-0
              items-center
              gap-1.5
              border-b-2
              border-b-transparent
              px-1
              pb-3
              text-sm
              font-medium
              transition-colors
              duration-150
              last:mr-0

              focus-visible:outline-none
              focus-visible:ring-2
              focus-visible:ring-primary
              focus-visible:ring-offset-2
              focus-visible:ring-offset-background

              ${
                isActive
                  ? `
                    border-b-primary
                    text-primary
                  `
                  : `
                    text-muted-foreground
                    hover:border-b-border
                    hover:text-foreground
                  `
              }
            `}
          >
            {Icon ? <Icon className="h-4 w-4" aria-hidden="true" /> : null}

            {label}
          </button>
        );
      })}
    </div>
  );
}
