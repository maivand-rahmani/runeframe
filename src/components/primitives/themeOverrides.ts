import type { ThemeComponentOverride, ThemeTokens } from '../../types.js'

/**
 * Resolved component override bag for `componentKey` (e.g. `button`, `panel`,
 * `appShell`). The provider-resolved theme always carries `components`; the
 * optional access keeps standalone `ThemeTokens` literals (tests, custom
 * providers) working with the built-in defaults.
 *
 * Precedence applied by consumers:
 * component override > global semantic theme token > built-in default.
 */
export function componentOverrides(
  theme: ThemeTokens,
  componentKey: string,
): ThemeComponentOverride | undefined {
  return theme.components?.[componentKey]
}

/**
 * Numeric component layout value. Component `layout` values are open
 * `string | number`, so numeric consumers fall back unless the override is a
 * finite number.
 */
export function componentLayoutNumber(
  theme: ThemeTokens,
  componentKey: string,
  key: string,
  fallback: number,
): number {
  const value = theme.components?.[componentKey]?.layout?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** String component layout value (e.g. a border style name). */
export function componentLayoutString(
  theme: ThemeTokens,
  componentKey: string,
  key: string,
  fallback: string,
): string {
  const value = theme.components?.[componentKey]?.layout?.[key]
  return typeof value === 'string' ? value : fallback
}
