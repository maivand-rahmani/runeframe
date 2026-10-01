// ── Focus Scopes ──
export type BuiltinFocusScope =
  | 'navigation'
  | 'list'
  | 'command'
  | 'modal'
  | 'textinput'
  | 'process'

/**
 * Framework consumers can introduce additional scopes by using string literals.
 * Built-ins are still strongly typed for the default interaction model.
 */
export type FocusScope = BuiltinFocusScope | (string & {})

// ── v2: Normalized Key Event (maps Ink's raw (input, key) into a predictable shape) ──
export interface NormalizedKeyEvent {
  /** Printable character string (empty for non-printable keys). */
  text: string
  /** Lowercase letter for a-z, or key name for specials: 'enter','escape','tab','backspace','delete','up','down','left','right','space' */
  key: string
  /** Physical key code (same as event.key). */
  code: string
  /** True if this key produces visible text. */
  isPrintable: boolean
  /** Semantic flags for common actions. */
  backspace: boolean
  enter: boolean
  escape: boolean
  tab: boolean
  space: boolean
  up: boolean
  down: boolean
  left: boolean
  right: boolean
  /** Modifier states. */
  ctrl: boolean
  shift: boolean
  alt: boolean
  meta: boolean
  /** Original Ink input string. */
  rawInput: string
}

// ── v2: Structured Consumption Result ──
export enum InputConsumptionResult {
  /** Event not consumed; should continue to next handler. */
  NotConsumed = 0,
  /** Event consumed; stop propagation to siblings but allow unrelated scopes. */
  Consumed = 1,
  /** Event consumed AND trapped; no further propagation to any scope. */
  ConsumedAndTrapped = 2,
}

// ── v2: Scope Entry (describes one level in the scope stack) ──
export interface ScopeEntry {
  /** Unique scope identifier (e.g. 'modal', 'textinput', 'practice'). */
  id: FocusScope
  /** Priority within the stack (lower = higher precedence for same-depth scopes). */
  priority: number
  /** When true, prevents events from bubbling past this scope. */
  trapsInput: boolean
  /** When true, unconsumed events may bubble to parent scopes. */
  allowsBubbling: boolean
  /** When false, shell/global shortcuts are suspended while this scope is deepest active. */
  globalShortcutsEnabled: boolean
}

// ── v2: Focus Tree Node ──
export type FocusNodeType = 'zone' | 'group' | 'focusable'

export interface FocusNodeInfo {
  id: string
  type: FocusNodeType
  parentId: string | null
  isActive: boolean
  label?: string
}

// ── v2: Action / Hotkey Categories ──
export type ActionCategory = 'system' | 'navigation' | 'context' | 'input'

// ── Theme Tokens Interface ──
export interface ThemeTokens {
  colors: {
    text: { primary: string; secondary: string; muted: string; inverse: string }
    status: { success: string; warning: string; error: string; info: string }
    focus: { ring: string; active: string; selected: string }
    surface: { base: string; elevated: string; overlay: string }
    border: { default: string; focus: string; error: string }
  }
  spacing: Record<string, number>
  typography: Record<string, string>
  borderStyles: Record<string, string>
  /** Optional so existing ThemeTokens literals keep compiling. */
  density?: ThemeDensity
  /** Optional so existing ThemeTokens literals keep compiling. */
  symbols?: ThemeSymbols
  /** Optional so existing ThemeTokens literals keep compiling. */
  layout?: ThemeLayout
  /** Optional so existing ThemeTokens literals keep compiling. */
  components?: ThemeComponentOverrides
  /** Optional so existing ThemeTokens literals keep compiling. */
  extensions?: Record<string, unknown>
}

// ── Theme System ──

/** Dark/light mode selector accepted by `ThemeProvider`/`FrameworkProvider`. */
export type ThemeMode = 'dark' | 'light'

/** Spacing density presets. `comfortable` preserves the historical scale. */
export type ThemeDensity = 'compact' | 'comfortable' | 'spacious'

/** Decorative symbols rendered by built-in widgets. */
export interface ThemeSymbols {
  button: { open: string; close: string }
  badge: { open: string; close: string }
  divider: { horizontal: string }
  list: { marker: string }
  radioList: { selected: string; unselected: string }
  sidebar: { active: string; item: string }
  tabs: { separator: string }
  input: { open: string; close: string; separator: string }
  stepFlow: { back: string; next: string }
}

/** Layout metrics used by the built-in shell and widgets. */
export interface ThemeLayout {
  narrowColumns: number
  mediumColumns: number
  sidebarMaxItems: number
  listMaxVisible: number
  sidebarWidth: number
  dividerWidth: number
  modalPaddingX: number
  modalPaddingY: number
  modalMarginY: number
  statusBarBorderStyle: string
  modalBorderStyle: string
  commandPaletteBorderStyle: string
  debugInspectorBorderStyle: string
  choicePromptMarginBottom: number
}

/**
 * Per-component semantic overrides. Component names are open strings so app
 * authors can target custom widgets; only semantic token groups are exposed,
 * never arbitrary Ink props.
 */
export interface ThemeComponentOverride {
  colors?: Record<string, string>
  spacing?: Record<string, number>
  symbols?: Record<string, string>
  layout?: Record<string, string | number>
  borderStyle?: string
}

/** Open map of component-name → semantic overrides. */
export type ThemeComponentOverrides = Record<string, ThemeComponentOverride>

/**
 * Recursively optional view of a token group: nested plain objects merge
 * deeply, leaves replace. Used to type the partial `colors`/`symbols` groups.
 */
type ThemeGroupOverrides<T> = {
  [K in keyof T]?: T[K] extends Record<string, unknown>
    ? ThemeGroupOverrides<T[K]>
    : T[K]
}

/**
 * Deep partial theme override accepted by `ThemeProvider` and
 * `FrameworkProvider`. Plain objects merge recursively, arrays replace,
 * `undefined` inherits, and `0`/`''` are retained.
 */
export interface ThemeOverrides {
  /** Partial nested color overrides. */
  colors?: ThemeGroupOverrides<ThemeTokens['colors']>
  /** Spacing overrides; keys stay open so custom widgets can add tokens. */
  spacing?: Record<string, number | undefined>
  typography?: Record<string, string | undefined>
  borderStyles?: Record<string, string | undefined>
  density?: ThemeDensity
  /** Partial nested symbol overrides. */
  symbols?: ThemeGroupOverrides<ThemeSymbols>
  layout?: Record<string, string | number | undefined>
  /** Per-component semantic overrides keyed by component name. */
  components?: ThemeComponentOverrides
  /** Free-form namespace for custom widget/theme extensions. */
  extensions?: Record<string, unknown>
}

/** Fully resolved theme returned by `useTheme()`; extras are required. */
export interface ResolvedThemeTokens extends ThemeTokens {
  density: ThemeDensity
  symbols: ThemeSymbols
  layout: ThemeLayout
  components: ThemeComponentOverrides
  extensions: Record<string, unknown>
}

// ── Keyboard Shortcut ──
export interface KeyboardShortcut {
  keys: string
  description: string
  scope: FocusScope
}
