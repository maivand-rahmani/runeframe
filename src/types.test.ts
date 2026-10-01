import { describe, it, expect } from 'vitest'
import type {
  FocusScope,
  ThemeTokens,
  KeyboardShortcut,
  ThemeMode,
  ThemeDensity,
  ThemeSymbols,
  ThemeLayout,
  ThemeComponentOverride,
  ThemeComponentOverrides,
  ThemeOverrides,
  ResolvedThemeTokens,
} from './types.js'
import type {
  ThemeMode as BarrelThemeMode,
  ThemeDensity as BarrelThemeDensity,
  ThemeSymbols as BarrelThemeSymbols,
  ThemeLayout as BarrelThemeLayout,
  ThemeComponentOverride as BarrelThemeComponentOverride,
  ThemeComponentOverrides as BarrelThemeComponentOverrides,
  ThemeOverrides as BarrelThemeOverrides,
  ResolvedThemeTokens as BarrelResolvedThemeTokens,
} from './index.js'
import {
  LAYOUT,
  FOCUS_SCOPE_PRIORITY,
  getScopePriority,
} from './constants.js'
import {
  borderStyles,
  semanticColors,
  spacing,
  themeLayout,
  themeSymbols,
  typography,
} from './design-system/tokens.js'
import {
  themeLayout as rootThemeLayout,
  themeSymbols as rootThemeSymbols,
} from './index.js'

const _focusScopeValues: FocusScope[] = [
  'navigation',
  'list',
  'command',
  'modal',
  'textinput',
  'process',
]

const _shortcut: KeyboardShortcut = { keys: 'l', description: 'Lessons', scope: 'navigation' }

// Legacy literal: required fields only. Optional theme groups must not
// break existing consumer ThemeTokens literals.
const _themeTokens: ThemeTokens = {
  colors: {
    text: { primary: '', secondary: '', muted: '', inverse: '' },
    status: { success: '', warning: '', error: '', info: '' },
    focus: { ring: '', active: '', selected: '' },
    surface: { base: '', elevated: '', overlay: '' },
    border: { default: '', focus: '', error: '' },
  },
  spacing: { xs: 1 },
  typography: { body: '' },
  borderStyles: { thin: '' },
}

// Extended literal: the new optional groups stay optional and additive.
const _themeTokensWithOptionalGroups: ThemeTokens = {
  ..._themeTokens,
  density: 'compact',
  symbols: {
    button: { open: '[', close: ']' },
    badge: { open: '[', close: ']' },
    divider: { horizontal: '─' },
    list: { marker: '•' },
    radioList: { selected: '•', unselected: '○' },
    sidebar: { active: '›', item: '•' },
    tabs: { separator: '|' },
    input: { open: '[', close: ']', separator: '|' },
    stepFlow: { back: '[←]', next: '[→/Enter]' },
  },
  layout: {
    narrowColumns: 80,
    mediumColumns: 100,
    sidebarMaxItems: 8,
    listMaxVisible: 10,
    sidebarWidth: 20,
    dividerWidth: 28,
    modalPaddingX: 1,
    modalPaddingY: 1,
    modalMarginY: 1,
    statusBarBorderStyle: 'single',
    modalBorderStyle: 'round',
    commandPaletteBorderStyle: 'round',
    debugInspectorBorderStyle: 'single',
    choicePromptMarginBottom: 1,
  },
  components: { button: { colors: { text: 'red' } } },
  extensions: { customWidget: { accent: 'cyan' } },
}

// Resolved tokens require the extra groups.
const _resolvedThemeTokens: ResolvedThemeTokens = {
  colors: {
    text: { ...semanticColors.text },
    status: { ...semanticColors.status },
    focus: { ...semanticColors.focus },
    surface: { ...semanticColors.surface },
    border: { ...semanticColors.border },
  },
  spacing: { ...spacing },
  typography: { ...typography },
  borderStyles: { ...borderStyles },
  density: 'comfortable',
  symbols: { ...themeSymbols },
  layout: { ...themeLayout },
  components: {},
  extensions: {},
}

// @ts-expect-error resolved tokens require every extra group (missing density)
const _resolvedThemeMissingDensity: ResolvedThemeTokens = {
  ..._themeTokens,
  symbols: { ...themeSymbols },
  layout: { ...themeLayout },
  components: {},
  extensions: {},
}

// Component overrides expose only semantic groups, never arbitrary Ink props.
const _componentOverride: ThemeComponentOverride = {
  colors: { text: 'red' },
  spacing: { md: 2 },
  symbols: { open: '<' },
  layout: { sidebarWidth: 30 },
  borderStyle: 'single',
}
// @ts-expect-error arbitrary Ink props are not part of ThemeComponentOverride
const _invalidComponentOverride: ThemeComponentOverride = { paddingX: 2 }

const _componentOverrides: ThemeComponentOverrides = {
  button: _componentOverride,
  'my-widget': { colors: { accent: 'cyan' } },
}

const _themeOverrides: ThemeOverrides = {
  colors: { text: { primary: 'red' } },
  spacing: { md: 9 },
  typography: { heading: 'bold' },
  borderStyles: { panel: 'double' },
  density: 'compact',
  symbols: { button: { open: '<' } },
  layout: { sidebarWidth: 30 },
  components: _componentOverrides,
  extensions: { customWidget: { accent: 'cyan' } },
}

const _mode: ThemeMode = 'dark'
const _density: ThemeDensity = 'spacious'
const _symbols: ThemeSymbols = { ...themeSymbols }
const _layout: ThemeLayout = { ...themeLayout }

// The root barrel must expose the new public theme types.
const _barrelMode: BarrelThemeMode = _mode
const _barrelDensity: BarrelThemeDensity = _density
const _barrelSymbols: BarrelThemeSymbols = _symbols
const _barrelLayout: BarrelThemeLayout = _layout
const _barrelComponentOverride: BarrelThemeComponentOverride = _componentOverride
const _barrelComponentOverrides: BarrelThemeComponentOverrides = _componentOverrides
const _barrelOverrides: BarrelThemeOverrides = _themeOverrides
const _barrelResolved: BarrelResolvedThemeTokens = _resolvedThemeTokens

void _themeTokensWithOptionalGroups
void _resolvedThemeMissingDensity
void _invalidComponentOverride
void _barrelMode
void _barrelDensity
void _barrelSymbols
void _barrelLayout
void _barrelComponentOverride
void _barrelComponentOverrides
void _barrelOverrides
void _barrelResolved

describe('LAYOUT', () => {
  it('has narrow breakpoint at 80', () => { expect(LAYOUT.narrow).toBe(80) })
  it('has medium breakpoint at 100', () => { expect(LAYOUT.medium).toBe(100) })
  it('has sidebar max items at 8', () => { expect(LAYOUT.sidebarMaxItems).toBe(8) })
  it('has list max visible at 10', () => { expect(LAYOUT.listMaxVisible).toBe(10) })
})

describe('root theme barrel', () => {
  it('exposes the theme symbol/layout defaults', () => {
    expect(rootThemeSymbols).toBe(themeSymbols)
    expect(rootThemeLayout).toBe(themeLayout)
  })
})

describe('FOCUS_SCOPE_PRIORITY', () => {
  it('assigns modal the highest priority (0)', () => { expect(FOCUS_SCOPE_PRIORITY.modal).toBe(0) })
  it('assigns process priority 1', () => { expect(FOCUS_SCOPE_PRIORITY.process).toBe(1) })
  it('assigns command priority 2', () => { expect(FOCUS_SCOPE_PRIORITY.command).toBe(2) })
  it('assigns textinput priority 3', () => { expect(FOCUS_SCOPE_PRIORITY.textinput).toBe(3) })
  it('assigns list priority 4', () => { expect(FOCUS_SCOPE_PRIORITY.list).toBe(4) })
  it('assigns navigation the lowest priority (5)', () => { expect(FOCUS_SCOPE_PRIORITY.navigation).toBe(5) })
  it('covers all FocusScope values', () => {
    const scopes = Object.keys(FOCUS_SCOPE_PRIORITY).sort()
    expect(scopes).toEqual(_focusScopeValues.sort())
  })
  it('has unique priority values (no ties)', () => {
    const priorities = Object.values(FOCUS_SCOPE_PRIORITY)
    expect(new Set(priorities).size).toBe(priorities.length)
  })
  it('assigns low precedence to custom scopes', () => {
    expect(getScopePriority('my-custom-scope' as FocusScope)).toBe(100)
  })
})
