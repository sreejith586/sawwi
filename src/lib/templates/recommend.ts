import type { Profile } from "@/lib/profile/profile";
import type { Template } from "./types";

export function isApplicable(template: Template, profile: Profile): boolean {
  const { channels, payments, b2bPayments, requiresB2B, requiresMarketplaceFulfilment, requiresCreditTerms } =
    template.appliesTo;
  if (!channels.some((c) => profile.channels.includes(c))) return false;
  if (payments && !payments.some((p) => profile.payments.includes(p))) return false;
  if (b2bPayments && !b2bPayments.some((p) => profile.b2bPayments.includes(p))) return false;
  if (requiresB2B && !profile.sellsB2B) return false;
  if (requiresCreditTerms && !profile.givesCreditTerms) return false;
  if (requiresMarketplaceFulfilment && !profile.usesMarketplaceFulfilment) return false;
  return true;
}

/**
 * Splits the catalogue into templates that fit this seller and the rest.
 * Recommended templates are ordered by how central the user's role is to them,
 * then featured edge cases, then catalogue order.
 */
export function recommendTemplates(templates: Template[], profile: Profile) {
  const score = (t: Template) => {
    const roleRank = t.roles.indexOf(profile.role);
    return (roleRank === -1 ? 0 : 10 - roleRank) + (t.featured ? 1 : 0);
  };

  const recommended = templates
    .map((t, index) => ({ t, index }))
    .filter(({ t }) => isApplicable(t, profile))
    .sort((a, b) => score(b.t) - score(a.t) || a.index - b.index)
    .map(({ t }) => t);

  const others = templates.filter((t) => !recommended.includes(t));
  return { recommended, others };
}
