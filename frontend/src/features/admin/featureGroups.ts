import type { FeatureGroup } from '@/api/platform';
import { t } from '@/i18n';

/**
 * Section heading to show above row `i` of a feature list, or null. The server lists plan modules first and the Home
 * dashboard extras after them; a list with one section only gets no headings.
 */
export function featureGroupHeading(list: { group?: FeatureGroup }[], i: number): string | null {
  const group = list[i]?.group ?? 'modules';
  const prev = i > 0 ? (list[i - 1]?.group ?? 'modules') : null;
  if (group === prev) return null;
  if (i === 0 && list.every((f) => (f.group ?? 'modules') === group)) return null;
  return group === 'dashboard' ? t('admin.featureGroups.dashboard') : t('admin.featureGroups.modules');
}
