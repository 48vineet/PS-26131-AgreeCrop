import { Sparkles } from "lucide-react";

// Renders the `ai_fallback` block the backend attaches only when the curated
// advisory library (advisories.py) had nothing for this crop/condition. Kept
// visually distinct from AdvisoryStepPanel on purpose -- dashed border, its own
// badge, its own disclaimer -- so it's never mistaken for a sourced advisory.
export default function AiFallbackPanel({ fallback, className = "" }) {
  if (!fallback) return null;

  if (!fallback.available) {
    return (
      <div
        className={`rounded-md border border-dashed border-border bg-card p-5 text-sm text-muted-foreground ${className}`}
      >
        {fallback.reason || "AI guidance isn't available right now."}
      </div>
    );
  }

  const guidance = fallback.guidance || {};
  const lists = [
    { key: "symptoms_to_check", label: "Symptoms to check for" },
    { key: "non_chemical_steps", label: "Non-chemical steps" },
    { key: "cultural_practices", label: "Cultural practice" },
  ];

  return (
    <div
      className={`rounded-md border border-dashed border-muted-foreground/40 bg-card p-5 ${className}`}
    >
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
          <Sparkles className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        </span>
        <h4 className="text-base font-semibold tracking-tight text-foreground">
          AI-generated guidance
        </h4>
      </div>

      {guidance.summary && (
        <p className="mt-4 text-sm leading-relaxed text-foreground">
          {guidance.summary}
        </p>
      )}

      <div className="mt-4 space-y-4">
        {lists.map(
          ({ key, label }) =>
            guidance[key]?.length > 0 && (
              <div key={key}>
                <p className="text-xs font-medium text-muted-foreground">
                  {label}
                </p>
                <ul className="mt-2 space-y-1.5">
                  {guidance[key].map((item, idx) => (
                    <li
                      key={idx}
                      className="flex items-start gap-2 text-sm leading-relaxed text-foreground"
                    >
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ),
        )}
      </div>

      {guidance.when_to_seek_help && (
        <p className="mt-4 border-t border-border pt-4 text-sm leading-relaxed text-muted-foreground">
          {guidance.when_to_seek_help}
        </p>
      )}

      {fallback.disclaimer && (
        <p className="mt-4 rounded-md bg-muted/60 px-3.5 py-3 text-xs leading-5 text-muted-foreground">
          {fallback.disclaimer}
        </p>
      )}
    </div>
  );
}
