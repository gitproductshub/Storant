/**
 * Single source of truth for the product brand. Screens, print templates, titles and
 * exports read the name from here, so there is no hardcoded brand text elsewhere.
 */
export const brand = {
  name: 'Storant',
  shortName: 'Storant',
  tagline: 'Point of sale for restaurants, cafés, cloud kitchens and retail stores.',
  /** Appended to inner-page browser tab titles: "<Page> | Storant". */
  titleSuffix: ' | Storant',
  colors: {
    light: { background: '#FBF9FF', primary: '#51218A' },
    dark: { background: '#130D26', surface: '#241443' },
  },
} as const;

export const BRAND_NAME = brand.name;

/** "<Page> | Storant", or just "Storant" when there is no page name. */
export function pageTitle(page?: string | null): string {
  return page ? `${page}${brand.titleSuffix}` : brand.name;
}
