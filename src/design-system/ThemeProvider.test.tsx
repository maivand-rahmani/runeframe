import { describe, it, expect, expectTypeOf } from 'vitest'
import { render } from 'ink-testing-library'
import { Text } from 'ink'
import type { ReactNode } from 'react'
import { ThemeProvider, useTheme } from './ThemeProvider.js'
import type { ResolvedThemeTokens, ThemeOverrides } from '../types.js'
import {
  borderStyles,
  semanticColors,
  spacing,
  themeLayout,
  themeSymbols,
  typography,
} from './tokens.js'

function ThemeConsumer({ field }: { field: string }) {
  const theme = useTheme()
  const color = field.split('.').reduce((acc: Record<string, unknown> | string, key: string) => {
    if (typeof acc === 'object' && acc !== null) {
      return (acc as Record<string, unknown>)[key] as string
    }
    return acc
  }, theme as unknown as Record<string, unknown>) as string

  return <Text color={color}>colored</Text>
}

function ThemeSpy({
  onTheme,
}: {
  onTheme: (theme: ResolvedThemeTokens) => void
}) {
  const theme = useTheme()
  onTheme(theme)
  return null
}

function captureTheme(
  renderTree: (spy: ReactNode) => ReactNode,
): ResolvedThemeTokens {
  const captured: ResolvedThemeTokens[] = []
  render(
    <>{renderTree(<ThemeSpy onTheme={(theme) => captured.push(theme)} />)}</>,
  )
  const theme = captured.at(-1)
  if (theme === undefined) throw new Error('useTheme() did not run')
  return theme
}

describe('ThemeProvider', () => {
  it('renders children', () => {
    const { lastFrame } = render(
      <ThemeProvider>
        <Text>hello</Text>
      </ThemeProvider>,
    )
    expect(lastFrame()).toContain('hello')
  })

  it('provides theme context via useTheme()', () => {
    const { lastFrame } = render(
      <ThemeProvider>
        <ThemeConsumer field="colors.text.primary" />
      </ThemeProvider>,
    )
    expect(lastFrame()).toContain('colored')
  })

  it('defaults to dark mode', () => {
    const { lastFrame } = render(
      <ThemeProvider>
        <ThemeConsumer field="colors.surface.base" />
      </ThemeProvider>,
    )
    expect(lastFrame()).toBeDefined()
  })

  it('light mode inverts surface colors', () => {
    const { lastFrame } = render(
      <ThemeProvider mode="light">
        <ThemeConsumer field="colors.text.primary" />
      </ThemeProvider>,
    )
    expect(lastFrame()).toContain('colored')
  })

  it('provides spacing tokens', () => {
    const { lastFrame } = render(
      <ThemeProvider>
        <SpacingConsumer />
      </ThemeProvider>,
    )
    expect(lastFrame()).toContain('spacing')
  })

  it('provides typography tokens', () => {
    const { lastFrame } = render(
      <ThemeProvider>
        <TypographyConsumer />
      </ThemeProvider>,
    )
    expect(lastFrame()).toContain('bold')
  })

  it('provides border style tokens', () => {
    const { lastFrame } = render(
      <ThemeProvider>
        <BorderConsumer />
      </ThemeProvider>,
    )
    expect(lastFrame()).toContain('round')
  })
})

describe('default resolution parity', () => {
  it('root with omitted mode stays dark and matches the historical tokens', () => {
    const theme = captureTheme((spy) => <ThemeProvider>{spy}</ThemeProvider>)

    expect(theme.colors).toEqual({
      text: { ...semanticColors.text },
      status: { ...semanticColors.status },
      focus: { ...semanticColors.focus },
      surface: { ...semanticColors.surface },
      border: { ...semanticColors.border },
    })
    expect(theme.spacing).toEqual({ ...spacing })
    expect(theme.typography).toEqual({ ...typography })
    expect(theme.borderStyles).toEqual({ ...borderStyles })
    expect(theme.density).toBe('comfortable')
    expect(theme.symbols).toEqual(themeSymbols)
    expect(theme.layout).toEqual(themeLayout)
    expect(theme.components).toEqual({})
    expect(theme.extensions).toEqual({})
  })

  it('root theme prop does not change the default dark mode', () => {
    const theme = captureTheme((spy) => (
      <ThemeProvider theme={{ spacing: { md: 9 } }}>{spy}</ThemeProvider>
    ))
    expect(theme.colors.text.primary).toBe(semanticColors.text.primary)
    expect(theme.colors.surface.base).toBe(semanticColors.surface.base)
  })

  it('light mode matches the historical inversion and keeps other groups', () => {
    const theme = captureTheme((spy) => (
      <ThemeProvider mode="light">{spy}</ThemeProvider>
    ))

    expect(theme.colors.text).toEqual({
      primary: 'black',
      secondary: 'gray',
      muted: 'dim',
      inverse: 'white',
    })
    expect(theme.colors.surface).toEqual({
      base: 'white',
      elevated: 'gray',
      overlay: 'white',
    })
    expect(theme.colors.status).toEqual({ ...semanticColors.status })
    expect(theme.colors.focus).toEqual({ ...semanticColors.focus })
    expect(theme.colors.border).toEqual({ ...semanticColors.border })
    expect(theme.spacing).toEqual({ ...spacing })
    expect(theme.symbols).toEqual(themeSymbols)
    expect(theme.layout).toEqual(themeLayout)
  })
})

describe('theme overrides', () => {
  it('deep-merges partial nested colors and keeps untouched siblings', () => {
    const theme = captureTheme((spy) => (
      <ThemeProvider
        theme={{
          colors: {
            text: { primary: 'red' },
            border: { focus: 'magenta' },
          },
        }}
      >
        {spy}
      </ThemeProvider>
    ))

    expect(theme.colors.text.primary).toBe('red')
    expect(theme.colors.text.secondary).toBe(semanticColors.text.secondary)
    expect(theme.colors.text.muted).toBe(semanticColors.text.muted)
    expect(theme.colors.text.inverse).toBe(semanticColors.text.inverse)
    expect(theme.colors.border.focus).toBe('magenta')
    expect(theme.colors.border.default).toBe(semanticColors.border.default)
    expect(theme.colors.status).toEqual({ ...semanticColors.status })
  })

  it('inherits parent overrides and applies local overrides on top', () => {
    const parentThemes: ResolvedThemeTokens[] = []
    const childThemes: ResolvedThemeTokens[] = []

    render(
      <ThemeProvider
        theme={{
          colors: { text: { primary: 'red' } },
          spacing: { md: 7 },
          symbols: { list: { marker: '*' } },
          components: { button: { colors: { text: 'green' } } },
          extensions: { widget: { accent: 'cyan' } },
        }}
      >
        <ThemeSpy onTheme={(theme) => parentThemes.push(theme)} />
        <ThemeProvider
          theme={{
            colors: { text: { secondary: 'blue' } },
            spacing: { lg: 9 },
            components: { button: { spacing: { md: 2 } } },
            extensions: { widget: { enabled: true } },
          }}
        >
          <ThemeSpy onTheme={(theme) => childThemes.push(theme)} />
        </ThemeProvider>
      </ThemeProvider>,
    )

    const parent = parentThemes.at(-1)!
    const child = childThemes.at(-1)!

    expect(parent.colors.text.primary).toBe('red')
    expect(parent.spacing.md).toBe(7)

    // Inherited parent values.
    expect(child.colors.text.primary).toBe('red')
    expect(child.spacing.md).toBe(7)
    expect(child.symbols.list.marker).toBe('*')

    // Local values win.
    expect(child.colors.text.secondary).toBe('blue')
    expect(child.spacing.lg).toBe(9)

    // Untouched defaults survive.
    expect(child.colors.text.muted).toBe(semanticColors.text.muted)
    expect(child.spacing.sm).toBe(spacing.sm)

    // Nested providers never mutate the parent's resolved theme.
    expect(parent.colors.text.secondary).toBe(semanticColors.text.secondary)
    expect(parent.spacing.lg).toBe(spacing.lg)

    // Components and extensions deep-merge across providers.
    expect(child.components.button).toEqual({
      colors: { text: 'green' },
      spacing: { md: 2 },
    })
    expect(child.extensions.widget).toEqual({ accent: 'cyan', enabled: true })
  })

  it('inherits the parent mode when the nested mode is omitted', () => {
    const theme = captureTheme((spy) => (
      <ThemeProvider mode="light">
        <ThemeProvider theme={{ spacing: { md: 9 } }}>{spy}</ThemeProvider>
      </ThemeProvider>
    ))

    expect(theme.colors.text.primary).toBe('black')
    expect(theme.spacing.md).toBe(9)
  })

  it('explicit nested mode replaces colors but preserves non-color values', () => {
    const theme = captureTheme((spy) => (
      <ThemeProvider
        mode="dark"
        theme={{
          colors: { text: { primary: 'red' } },
          spacing: { md: 7 },
          symbols: { list: { marker: '*' } },
          layout: { sidebarWidth: 30 },
          extensions: { widget: 'yes' },
        }}
      >
        <ThemeProvider mode="light">{spy}</ThemeProvider>
      </ThemeProvider>
    ))

    // Colors reset to the explicit mode's defaults, not the parent's.
    expect(theme.colors.text.primary).toBe('black')
    expect(theme.colors.surface.base).toBe('white')

    // Non-color groups keep inheriting.
    expect(theme.spacing.md).toBe(7)
    expect(theme.symbols.list.marker).toBe('*')
    expect(theme.layout.sidebarWidth).toBe(30)
    expect(theme.extensions.widget).toBe('yes')
  })

  it('applies local colors on top of an explicit nested mode base', () => {
    const theme = captureTheme((spy) => (
      <ThemeProvider theme={{ colors: { text: { primary: 'red' } } }}>
        <ThemeProvider
          mode="light"
          theme={{ colors: { text: { primary: 'purple' } } }}
        >
          {spy}
        </ThemeProvider>
      </ThemeProvider>
    ))

    expect(theme.colors.text.primary).toBe('purple')
    expect(theme.colors.text.secondary).toBe('gray')
    expect(theme.colors.surface.base).toBe('white')
  })

  it('resolves partial symbol overrides without dropping other groups', () => {
    const theme = captureTheme((spy) => (
      <ThemeProvider
        theme={{
          symbols: {
            button: { open: '<', close: '>' },
            list: { marker: '*' },
          },
        }}
      >
        {spy}
      </ThemeProvider>
    ))

    expect(theme.symbols.button).toEqual({ open: '<', close: '>' })
    expect(theme.symbols.list.marker).toBe('*')
    expect(theme.symbols.badge).toEqual({ open: '[', close: ']' })
    expect(theme.symbols.input).toEqual({ open: '[', close: ']', separator: '|' })
  })

  it('resolves layout overrides', () => {
    const theme = captureTheme((spy) => (
      <ThemeProvider
        theme={{
          layout: {
            sidebarWidth: 30,
            dividerWidth: 40,
            modalBorderStyle: 'double',
          },
        }}
      >
        {spy}
      </ThemeProvider>
    ))

    expect(theme.layout.sidebarWidth).toBe(30)
    expect(theme.layout.dividerWidth).toBe(40)
    expect(theme.layout.modalBorderStyle).toBe('double')
    expect(theme.layout.statusBarBorderStyle).toBe('single')
    expect(theme.layout.listMaxVisible).toBe(10)
  })

  it('keeps the component override map open by component name', () => {
    const theme = captureTheme((spy) => (
      <ThemeProvider
        theme={{
          components: {
            button: {
              colors: { text: 'green' },
              spacing: { md: 2 },
              symbols: { open: '<' },
              layout: { sidebarWidth: 30 },
              borderStyle: 'double',
            },
            'my-widget': { colors: { accent: 'cyan' } },
          },
        }}
      >
        {spy}
      </ThemeProvider>
    ))

    expect(theme.components.button).toEqual({
      colors: { text: 'green' },
      spacing: { md: 2 },
      symbols: { open: '<' },
      layout: { sidebarWidth: 30 },
      borderStyle: 'double',
    })
    expect(theme.components['my-widget']).toEqual({
      colors: { accent: 'cyan' },
    })
    expect(theme.components.card).toBeUndefined()
  })

  it('exposes typed extensions through the useTheme generic', () => {
    interface WidgetExtensions extends Record<string, unknown> {
      widget: { accent: string; enabled: boolean }
    }

    function TypedConsumer() {
      const theme = useTheme<WidgetExtensions>()
      const accent: string = theme.extensions.widget.accent
      return <Text>{accent}</Text>
    }

    const { lastFrame } = render(
      <ThemeProvider
        theme={{ extensions: { widget: { accent: 'cyan', enabled: true } } }}
      >
        <TypedConsumer />
      </ThemeProvider>,
    )

    expect(lastFrame()).toContain('cyan')

    const theme = captureTheme((spy) => (
      <ThemeProvider
        theme={{ extensions: { widget: { accent: 'cyan', enabled: true } } }}
      >
        {spy}
      </ThemeProvider>
    ))
    expect(theme.extensions.widget).toEqual({ accent: 'cyan', enabled: true })
  })

  it('types the resolved theme and generic extensions', () => {
    function useResolvedTheme(): ResolvedThemeTokens {
      return useTheme()
    }

    function useWidgetExtensionTheme() {
      return useTheme<{ widget: { accent: string } }>()
    }

    expectTypeOf<ReturnType<typeof useResolvedTheme>>().toMatchTypeOf<
      ResolvedThemeTokens
    >()
    expectTypeOf<
      ReturnType<typeof useWidgetExtensionTheme>
    >().toMatchTypeOf<{ extensions: { widget: { accent: string } } }>()
  })
})

describe('density', () => {
  it('comfortable density preserves the historical spacing exactly', () => {
    const theme = captureTheme((spy) => <ThemeProvider>{spy}</ThemeProvider>)
    expect(theme.density).toBe('comfortable')
    expect(theme.spacing).toEqual({ ...spacing })
  })

  it('compact scales default spacing by 0.75 relative to comfortable', () => {
    const theme = captureTheme((spy) => (
      <ThemeProvider theme={{ density: 'compact' }}>{spy}</ThemeProvider>
    ))
    expect(theme.spacing).toEqual({
      xs: 1,
      sm: 2,
      md: 2,
      lg: 3,
      xl: 4,
      xxl: 6,
    })
  })

  it('spacious scales default spacing by 1.5 relative to comfortable', () => {
    const theme = captureTheme((spy) => (
      <ThemeProvider theme={{ density: 'spacious' }}>{spy}</ThemeProvider>
    ))
    expect(theme.spacing).toEqual({
      xs: 2,
      sm: 3,
      md: 5,
      lg: 6,
      xl: 8,
      xxl: 12,
    })
  })

  it('composes nested density changes relative to the previous density', () => {
    const theme = captureTheme((spy) => (
      <ThemeProvider theme={{ density: 'compact' }}>
        <ThemeProvider theme={{ density: 'spacious' }}>{spy}</ThemeProvider>
      </ThemeProvider>
    ))
    // compact × (1.5 / 0.75) === double the compact scale.
    expect(theme.spacing).toEqual({
      xs: 2,
      sm: 4,
      md: 4,
      lg: 6,
      xl: 8,
      xxl: 12,
    })
  })

  it('spacious → comfortable returns to the historical spacing', () => {
    const theme = captureTheme((spy) => (
      <ThemeProvider theme={{ density: 'spacious' }}>
        <ThemeProvider theme={{ density: 'comfortable' }}>{spy}</ThemeProvider>
      </ThemeProvider>
    ))
    expect(theme.spacing).toEqual({ ...spacing })
  })

  it('explicit spacing in the same theme prop wins over density scaling', () => {
    const theme = captureTheme((spy) => (
      <ThemeProvider theme={{ density: 'compact', spacing: { md: 9, xs: 0 } }}>
        {spy}
      </ThemeProvider>
    ))
    expect(theme.spacing.md).toBe(9)
    expect(theme.spacing.xs).toBe(0)
    expect(theme.spacing.sm).toBe(2)
  })

  it('scales inherited custom spacing keys and inherited overrides', () => {
    const theme = captureTheme((spy) => (
      <ThemeProvider theme={{ spacing: { md: 10, custom: 4 } }}>
        <ThemeProvider theme={{ density: 'compact' }}>{spy}</ThemeProvider>
      </ThemeProvider>
    ))
    expect(theme.spacing.md).toBe(8) // round(10 × 0.75)
    expect(theme.spacing.custom).toBe(3)
  })
})

describe('merge semantics', () => {
  it('retains valid 0 and empty string values', () => {
    const theme = captureTheme((spy) => (
      <ThemeProvider
        theme={{
          colors: { text: { primary: '' } },
          spacing: { xs: 0 },
          borderStyles: { panel: '' },
          symbols: { list: { marker: '' } },
        }}
      >
        {spy}
      </ThemeProvider>
    ))

    expect(theme.colors.text.primary).toBe('')
    expect(theme.spacing.xs).toBe(0)
    expect(theme.borderStyles.panel).toBe('')
    expect(theme.symbols.list.marker).toBe('')
  })

  it('treats undefined as inherit', () => {
    const theme = captureTheme((spy) => (
      <ThemeProvider
        theme={{
          colors: { text: { primary: undefined } },
          spacing: { md: undefined },
          density: undefined,
        }}
      >
        {spy}
      </ThemeProvider>
    ))

    expect(theme.colors.text.primary).toBe(semanticColors.text.primary)
    expect(theme.spacing.md).toBe(spacing.md)
    expect(theme.density).toBe('comfortable')
  })

  it('replaces arrays instead of merging them', () => {
    const theme = captureTheme((spy) => (
      <ThemeProvider theme={{ extensions: { steps: ['a', 'b'] } }}>
        <ThemeProvider theme={{ extensions: { steps: ['c'] } }}>
          {spy}
        </ThemeProvider>
      </ThemeProvider>
    ))

    expect(theme.extensions.steps).toEqual(['c'])
  })

  it('does not mutate caller input', () => {
    const overrides: ThemeOverrides = {
      density: 'compact',
      colors: { text: { primary: 'red' } },
      spacing: { md: 9 },
      symbols: { button: { open: '<' } },
      layout: { sidebarWidth: 30 },
      components: { button: { colors: { text: 'green' } } },
      extensions: { widget: { accent: 'cyan' } },
    }
    const snapshot = JSON.stringify(overrides)

    const theme = captureTheme((spy) => (
      <ThemeProvider theme={overrides}>{spy}</ThemeProvider>
    ))

    expect(JSON.stringify(overrides)).toBe(snapshot)
    expect(theme.colors.text.primary).toBe('red')
    expect(theme.spacing.md).toBe(9)
    expect(theme.symbols.button.open).toBe('<')
    expect(theme.layout.sidebarWidth).toBe(30)
    expect(theme.components.button).toEqual({ colors: { text: 'green' } })
    expect(theme.extensions.widget).toEqual({ accent: 'cyan' })
  })

  it('returns fresh structures that cannot corrupt defaults', () => {
    const first = captureTheme((spy) => <ThemeProvider>{spy}</ThemeProvider>)
    first.spacing.md = 999
    first.symbols.list.marker = 'X'
    first.layout.sidebarWidth = 999
    first.components.injected = { colors: { text: 'red' } }
    first.extensions.injected = true

    const second = captureTheme((spy) => <ThemeProvider>{spy}</ThemeProvider>)
    expect(second.spacing.md).toBe(spacing.md)
    expect(second.symbols.list.marker).toBe('•')
    expect(second.layout.sidebarWidth).toBe(20)
    expect(second.components).toEqual({})
    expect(second.extensions).toEqual({})
  })
})

describe('useTheme()', () => {
  it('throws when used outside ThemeProvider', () => {
    const { lastFrame } = render(
      <ThemeConsumer field="colors.text.primary" />,
    )
    expect(lastFrame()).not.toContain('colored')
  })
})

function SpacingConsumer() {
  const theme = useTheme()
  return <Text>spacing: {theme.spacing.md}</Text>
}

function TypographyConsumer() {
  const theme = useTheme()
  return <Text>{theme.typography.heading}</Text>
}

function BorderConsumer() {
  const theme = useTheme()
  return <Text>{theme.borderStyles.panel}</Text>
}
