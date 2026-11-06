import {
  ACCOUNTING_SYSTEMS,
  B2B_PAYMENT_METHODS,
  CHANNELS,
  COUNTRIES,
  MARKETPLACES,
  PAYMENT_METHODS,
  ROLES,
  WEBSTORE_PLATFORMS,
  type AccountingSystem,
  type B2BPaymentMethod,
  type Channel,
  type Country,
  type Marketplace,
  type Option,
  type PaymentMethod,
  type Role,
  type WebstorePlatform,
} from "./options";

export type Profile = {
  company: string;
  role: Role;
  countries: Country[];
  accountingSystems: AccountingSystem[];
  channels: Channel[];
  marketplaces: Marketplace[];
  sellsB2B: boolean;
  usesMarketplaceFulfilment: boolean;
  platforms: WebstorePlatform[];
  payments: PaymentMethod[];
  b2bPayments: B2BPaymentMethod[];
  givesCreditTerms: boolean;
};

export const PROFILE_COOKIE = "sawwi_profile";

export type ProfileErrors = Partial<Record<keyof Profile, string>>;

function pickMany<T extends string>(options: readonly Option<T>[], raw: unknown): T[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set(options.map((o) => o.value));
  return [...new Set(raw.filter((v): v is T => typeof v === "string" && allowed.has(v as T)))];
}

function pickOne<T extends string>(options: readonly Option<T>[], raw: unknown): T | undefined {
  return options.find((o) => o.value === raw)?.value;
}

/**
 * Validates untrusted input (form data or cookie JSON) into a Profile.
 * Channel-specific answers are dropped when that channel is not selected.
 */
export function parseProfile(raw: unknown): { profile?: Profile; errors: ProfileErrors } {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const errors: ProfileErrors = {};

  const company = typeof input.company === "string" ? input.company.trim().slice(0, 120) : "";
  const role = pickOne(ROLES, input.role);
  const countries = pickMany(COUNTRIES, input.countries);
  const accountingSystems = pickMany(ACCOUNTING_SYSTEMS, input.accountingSystems);
  const channels = pickMany(CHANNELS, input.channels);
  const sellsOnMarketplace = channels.includes("marketplace");
  const sellsOnWebstore = channels.includes("webstore");
  const sellsDirectB2B = channels.includes("b2b");
  const marketplaces = sellsOnMarketplace ? pickMany(MARKETPLACES, input.marketplaces) : [];
  const platforms = sellsOnWebstore ? pickMany(WEBSTORE_PLATFORMS, input.platforms) : [];
  const payments = sellsOnWebstore ? pickMany(PAYMENT_METHODS, input.payments) : [];
  const b2bPayments = sellsDirectB2B ? pickMany(B2B_PAYMENT_METHODS, input.b2bPayments) : [];

  if (!company) errors.company = "Enter your company name.";
  if (!role) errors.role = "Pick your role.";
  if (countries.length === 0) errors.countries = "Pick at least one country.";
  if (accountingSystems.length === 0) errors.accountingSystems = "Pick where you keep your books.";
  if (channels.length === 0) errors.channels = "Pick where you sell.";
  if (sellsOnMarketplace && marketplaces.length === 0) errors.marketplaces = "Pick at least one marketplace.";
  if (sellsOnWebstore && platforms.length === 0) errors.platforms = "Pick your webstore platform.";
  if (sellsOnWebstore && payments.length === 0) errors.payments = "Pick how customers pay.";
  if (sellsDirectB2B && b2bPayments.length === 0) errors.b2bPayments = "Pick how business customers pay.";

  if (Object.keys(errors).length > 0) return { errors };

  return {
    errors,
    profile: {
      company,
      role: role!,
      countries,
      accountingSystems,
      channels,
      marketplaces,
      sellsB2B: sellsOnMarketplace && input.sellsB2B === true,
      usesMarketplaceFulfilment: sellsOnMarketplace && input.usesMarketplaceFulfilment === true,
      platforms,
      payments,
      b2bPayments,
      givesCreditTerms: sellsDirectB2B && input.givesCreditTerms === true,
    },
  };
}

export function decodeProfileCookie(value: string | undefined): Profile | undefined {
  if (!value) return undefined;
  try {
    return parseProfile(JSON.parse(value)).profile;
  } catch {
    return undefined;
  }
}
