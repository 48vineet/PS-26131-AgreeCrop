// Shared helpers for turning /advisories API responses into UI-ready shapes.
// Used by both the Advisories library page and the disease screening result view.

// i18n keys for the backend's seven IPM categories. Resolved at the render
// site with t(categoryKey(c)) so the label follows the active language.
export const CATEGORY_LABEL_KEY = {
  monitoring: "advisories.ipmCategory.monitoring",
  sanitation: "advisories.ipmCategory.sanitation",
  cultural: "advisories.ipmCategory.cultural",
  resistant_variety: "advisories.ipmCategory.resistantVariety",
  mechanical: "advisories.ipmCategory.mechanical",
  biological: "advisories.ipmCategory.biological",
  chemical: "advisories.ipmCategory.chemical",
};

export function categoryKey(category) {
  return CATEGORY_LABEL_KEY[category] || category;
}

// AdvisoryStepPanel only knows three visual tiers.
const CATEGORY_TIER = {
  monitoring: "cultural",
  sanitation: "cultural",
  cultural: "cultural",
  resistant_variety: "cultural",
  mechanical: "cultural",
  biological: "biological",
  chemical: "chemical",
};

// Turns the API's category groups into AdvisoryStepPanel's step shape.
// `t` is the caller's translator; `title` stays a key so the panel can render
// the active language (DiseaseScreening passes the panel a t-aware renderer).
export function buildSteps(groups, t) {
  const steps = [];
  let order = 0;

  groups.forEach((group) => {
    const label = t(categoryKey(group.category));

    group.advisories.forEach((advisory, index) => {
      order += 1;

      steps.push({
        order,
        tier: CATEGORY_TIER[group.category] || "cultural",
        title:
          group.advisories.length > 1
            ? `${label} — ${t("advisories.optionNumber", { number: index + 1 })}`
            : label,
        recommended: group.category !== "chemical",
        description: advisory.recommendation,
        safetyNotes: advisory.safety
          ? [
              advisory.safety.check_the_label_and_registration,
              advisory.safety.consult_before_applying,
            ]
          : undefined,
      });
    });
  });

  return steps;
}
