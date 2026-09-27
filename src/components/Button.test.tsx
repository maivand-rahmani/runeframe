import { describe, it, expect, vi } from 'vitest'
import { render } from 'ink-testing-library'
import type { ReactElement } from 'react'
import { ThemeProvider } from '../design-system/ThemeProvider.js'
import {
  borderStyles,
  semanticColors,
  spacing,
  typography,
} from '../design-system/tokens.js'
import type { ThemeTokens } from '../types.js'
import { Button, resolveButtonAppearance } from './Button.js'
import { FrameworkProvider } from '../FrameworkProvider.js'
import { ScreenRegistry } from '../screens/registry.js'

function renderInTheme(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>)
}

const interactionRegistry = new ScreenRegistry()
interactionRegistry.register({
  id: 'test',
  title: 'Test',
  component: () => null,
})

function renderInFramework(ui: ReactElement) {
  return render(
    <FrameworkProvider registry={interactionRegistry} defaultScreen="test">
      {ui}
    </FrameworkProvider>,
  )
}

function delay(ms = 50) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function clickAt(stdin: { write: (data: string) => void }, x: number, y: number) {
  stdin.write(`\u001B[<0;${x};${y}M`)
  await delay()
  stdin.write(`\u001B[<0;${x};${y}m`)
  await delay()
}

const theme: ThemeTokens = {
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
}

describe('Button', () => {
  it('renders default variant', () => {
    const { lastFrame } = renderInTheme(<Button>Default</Button>)

    expect(lastFrame()).toContain('[Default]')
  })

  it('renders primary, danger, and ghost variants', () => {
    const { lastFrame } = renderInTheme(
      <>
        <Button variant="primary">Primary</Button>
        <Button variant="danger">Danger</Button>
        <Button variant="ghost">Ghost</Button>
      </>,
    )

    const frame = lastFrame() ?? ''
    expect(frame).toContain('[Primary]')
    expect(frame).toContain('[Danger]')
    expect(frame).toContain('[Ghost]')
  })

  it('renders focused and disabled states', () => {
    const { lastFrame } = renderInTheme(
      <>
        <Button focused>Focused</Button>
        <Button disabled>Disabled</Button>
      </>,
    )

    const frame = lastFrame() ?? ''
    expect(frame).toContain('[Focused]')
    expect(frame).toContain('[Disabled]')
  })

  it('does not crash when optional props are omitted', () => {
    const { lastFrame } = renderInTheme(<Button>Safe Defaults</Button>)

    expect(lastFrame()).toContain('[Safe Defaults]')
  })

  it('activates a focused button with Enter and within explicit mouse bounds', async () => {
    const onActivate = vi.fn()
    const { stdin } = renderInFramework(
      <Button
        focused
        onActivate={onActivate}
        mouseBounds={{ x: 2, y: 3, width: 4, height: 1 }}
      >
        Save
      </Button>,
    )

    await delay()
    stdin.write('\r')
    await delay()
    expect(onActivate).toHaveBeenCalledTimes(1)

    await clickAt(stdin, 3, 4)
    expect(onActivate).toHaveBeenCalledTimes(2)
  })

  it('keeps keyboard-only activation available without mouse bounds', async () => {
    const onActivate = vi.fn()
    const { stdin } = renderInFramework(
      <Button focused onActivate={onActivate}>
        Continue
      </Button>,
    )

    await delay()
    stdin.write('\r')
    await delay()

    expect(onActivate).toHaveBeenCalledTimes(1)
  })

  it('does not activate from Enter while unfocused', async () => {
    const onActivate = vi.fn()
    const { stdin } = renderInFramework(
      <Button onActivate={onActivate}>Continue</Button>,
    )

    await delay()
    stdin.write('\r')
    await delay()

    expect(onActivate).not.toHaveBeenCalled()
  })

  it('does not activate a disabled button from keyboard or mouse', async () => {
    const onActivate = vi.fn()
    const { stdin } = renderInFramework(
      <Button
        focused
        disabled
        onActivate={onActivate}
        mouseBounds={{ x: 0, y: 0, width: 3, height: 1 }}
      >
        Locked
      </Button>,
    )

    await delay()
    stdin.write('\r')
    await delay()
    await clickAt(stdin, 1, 1)
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('resolves variant and state appearance from theme tokens', () => {
    expect(resolveButtonAppearance(theme, 'default', false, false)).toEqual({
      color: theme.colors.text.primary,
    })

    expect(resolveButtonAppearance(theme, 'primary', false, false)).toEqual({
      color: theme.colors.status.info,
    })

    expect(resolveButtonAppearance(theme, 'danger', false, false)).toEqual({
      color: theme.colors.status.error,
    })

    expect(resolveButtonAppearance(theme, 'ghost', false, false)).toEqual({
      color: theme.colors.text.secondary,
      dimColor: true,
    })

    expect(resolveButtonAppearance(theme, 'default', true, false)).toEqual({
      color: theme.colors.focus.ring,
      bold: true,
    })

    expect(resolveButtonAppearance(theme, 'primary', true, true)).toEqual({
      color: theme.colors.text.secondary,
      dimColor: true,
    })
  })
})
