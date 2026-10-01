import { createContext, useContext, type ReactNode } from 'react'
import {
  semanticColors,
  spacing,
  typography,
  borderStyles,
  themeSymbols,
  themeLayout,
} from './tokens.js'
import type {
  ResolvedThemeTokens,
  ThemeDensity,
  ThemeMode,
  ThemeOverrides,
  ThemeTokens,
} from '../types.js'

interface ThemeProviderProps {
  mode?: ThemeMode
  theme?: ThemeOverrides
  children: ReactNode
}

const ThemeContext = createContext<ResolvedThemeTokens | null>(null)
// Internal channel: lets a nested provider inherit the resolved mode while
// `useTheme()` keeps returning only the resolved tokens.
const ThemeModeContext = createContext<ThemeMode | null>(null)

const DENSITY_FACTORS: Record<ThemeDensity, number> = {
  compact: 0.75,
  comfortable: 1,
  spacious: 1.5,
}

const DEFAULT_DENSITY: ThemeDensity = 'comfortable'

function resolveColors(mode: ThemeMode): ThemeTokens['colors'] {
  if (mode === 'dark') {
    return {
      text: { ...semanticColors.text },
      status: { ...semanticColors.status },
      focus: { ...semanticColors.focus },
      surface: { ...semanticColors.surface },
      border: { ...semanticColors.border },
    }
  }

  // Light mode: invert surface and text roles
  return {
    text: {
      primary: 'black',
      secondary: 'gray',
      muted: 'dim',
      inverse: 'white',
    },
    status: { ...semanticColors.status },
    focus: { ...semanticColors.focus },
    surface: {
      base: 'white',
      elevated: 'gray',
      overlay: 'white',
    },
    border: { ...semanticColors.border },
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * Structural clone so resolved themes never share mutable state with caller
 * input, parent providers, or the module-level default token objects.
 * Arrays and non-plain objects are copied by value where practical and
 * otherwise returned as-is.
 */
function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneValue(entry)) as T
  }
  if (isPlainObject(value)) {
    const copy: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      copy[key] = cloneValue(entry)
    }
    return copy as T
  }
  return value
}

/**
 * Deep-merges plain objects (arrays replace, `undefined` inherits, `0` and
 * `''` are retained) without mutating either input.
 */
function deepMerge<T extends object>(base: T, overrides: object): T {
  const merged: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(base)) {
    merged[key] = cloneValue(entry)
  }
  for (const [key, entry] of Object.entries(overrides)) {
    if (entry === undefined) continue
    const current = merged[key]
    merged[key] =
      isPlainObject(current) && isPlainObject(entry)
        ? deepMerge(current, entry)
        : cloneValue(entry)
  }
  return merged as T
}

function createDefaultTheme(mode: ThemeMode): ResolvedThemeTokens {
  return {
    colors: resolveColors(mode),
    spacing: { ...spacing },
    typography: { ...typography },
    borderStyles: { ...borderStyles },
    density: DEFAULT_DENSITY,
    symbols: cloneValue(themeSymbols),
    layout: cloneValue(themeLayout),
    components: {},
    extensions: {},
  }
}

/**
 * Scales spacing relative to the previous density so nested density changes
 * compose (e.g. compact → spacious doubles the inherited scale).
 */
function scaleSpacing(
  spacingTokens: Record<string, number>,
  from: ThemeDensity,
  to: ThemeDensity,
): Record<string, number> {
  const factor = DENSITY_FACTORS[to] / DENSITY_FACTORS[from]
  const scaled: Record<string, number> = {}
  for (const [key, value] of Object.entries(spacingTokens)) {
    scaled[key] =
      typeof value === 'number' ? Math.round(value * factor) : value
  }
  return scaled
}

function resolveTheme(
  parent: ResolvedThemeTokens | null,
  mode: ThemeMode,
  modeExplicit: boolean,
  overrides: ThemeOverrides | undefined,
): ResolvedThemeTokens {
  // 1. Base: fresh mode defaults at the root, otherwise a clone of the
  //    parent's resolved theme.
  const base =
    parent === null ? createDefaultTheme(mode) : deepMerge(parent, {})

  if (parent !== null && modeExplicit) {
    // An explicit nested mode swaps the color base for that mode's defaults
    // while every non-color group keeps inheriting from the parent.
    base.colors = resolveColors(mode)
  }

  // 2. Density adjusts inherited/default spacing before local overrides.
  const density = overrides?.density ?? base.density
  if (density !== base.density) {
    base.spacing = scaleSpacing(base.spacing, base.density, density)
    base.density = density
  }

  // 3. The theme prop wins, deep-merged on top of the adjusted base.
  return overrides === undefined ? base : deepMerge(base, overrides)
}

export function ThemeProvider({
  mode,
  theme,
  children,
}: ThemeProviderProps) {
  const parentTheme = useContext(ThemeContext)
  const parentMode = useContext(ThemeModeContext)

  const resolvedMode: ThemeMode = mode ?? parentMode ?? 'dark'
  const resolvedTheme = resolveTheme(
    parentTheme,
    resolvedMode,
    mode !== undefined,
    theme,
  )

  return (
    <ThemeModeContext.Provider value={resolvedMode}>
      <ThemeContext.Provider value={resolvedTheme}>
        {children}
      </ThemeContext.Provider>
    </ThemeModeContext.Provider>
  )
}

export function useTheme<TExtensions = Record<string, unknown>>():
  Omit<ResolvedThemeTokens, 'extensions'> & { extensions: TExtensions } {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error(
      'useTheme() must be used within a <ThemeProvider>. ' +
      'Wrap your application in <ThemeProvider> at the root level.',
    )
  }
  return context as Omit<ResolvedThemeTokens, 'extensions'> & {
    extensions: TExtensions
  }
}
