import { describe, it, expect, vi } from 'vitest'
import { render } from 'ink-testing-library'
import { Text } from 'ink'
import type { ReactElement } from 'react'
import stripAnsi from 'strip-ansi'
import { ThemeProvider } from '../../design-system/ThemeProvider.js'
import {
  borderStyles,
  semanticColors,
  spacing,
  typography,
} from '../../design-system/tokens.js'
import type { ThemeTokens } from '../../types.js'
import { Button, resolveButtonAppearance } from './Button.js'
import { FrameworkProvider } from '../../FrameworkProvider.js'
import { ScreenRegistry } from '../../screens/registry.js'
import { MouseLayout } from '../../interaction/mouse/MouseLayout.js'

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
  return render(wrapInFramework(ui))
}

/** Wrap a tree in the framework providers for `rerender` calls. */
function wrapInFramework(ui: ReactElement) {
  return (
    <FrameworkProvider registry={interactionRegistry} defaultScreen="test">
      {ui}
    </FrameworkProvider>
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

/** Locate a rendered marker and return its zero-based terminal cell. */
function findMarker(frame: string, marker: string): { x: number; y: number } {
  const lines = stripAnsi(frame).split('\n')
  for (let y = 0; y < lines.length; y++) {
    const x = lines[y]!.indexOf(marker)
    if (x !== -1) return { x, y }
  }
  throw new Error(`Marker not found in frame: ${marker}`)
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

  it('activates once from automatic geometry only after the anchored tree measured', async () => {
    const onActivate = vi.fn()
    const { stdin, lastFrame } = renderInFramework(
      <MouseLayout origin={{ x: 0, y: 0 }}>
        <Button onActivate={onActivate}>Auto</Button>
      </MouseLayout>,
    )

    // Before layout/effects have settled, the automatic target must be inert.
    stdin.write('\u001B[<0;1;1M')
    stdin.write('\u001B[<0;1;1m')
    await delay()
    expect(onActivate).not.toHaveBeenCalled()

    await delay()
    const cell = findMarker(lastFrame() ?? '', '[Auto]')
    await clickAt(stdin, cell.x + 1, cell.y + 1)
    expect(onActivate).toHaveBeenCalledTimes(1)

    await clickAt(stdin, cell.x + 1, cell.y + 1)
    expect(onActivate).toHaveBeenCalledTimes(2)
  })

  it('keeps explicit mouseBounds authoritative beneath an anchored MouseLayout', async () => {
    const onActivate = vi.fn()
    const { stdin, lastFrame } = renderInFramework(
      <MouseLayout origin={{ x: 0, y: 0 }}>
        <Button
          onActivate={onActivate}
          mouseBounds={{ x: 5, y: 2, width: 2, height: 1 }}
        >
          Explicit
        </Button>
      </MouseLayout>,
    )

    await delay()
    const cell = findMarker(lastFrame() ?? '', '[Explicit]')

    // The automatic location stays inert while explicit bounds are supplied.
    await clickAt(stdin, cell.x + 1, cell.y + 1)
    expect(onActivate).not.toHaveBeenCalled()

    await clickAt(stdin, 6, 3)
    expect(onActivate).toHaveBeenCalledTimes(1)
  })

  it('calls the latest committed automatic callback after a committed rerender', async () => {
    const first = vi.fn()
    const second = vi.fn()

    const { rerender, stdin, lastFrame } = renderInFramework(
      <MouseLayout origin={{ x: 0, y: 0 }}>
        <Button onActivate={first}>Swap</Button>
      </MouseLayout>,
    )

    await delay()
    const cell = findMarker(lastFrame() ?? '', '[Swap]')
    await clickAt(stdin, cell.x + 1, cell.y + 1)
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()

    rerender(
      wrapInFramework(
        <MouseLayout origin={{ x: 0, y: 0 }}>
          <Button onActivate={second}>Swap</Button>
        </MouseLayout>,
      ),
    )
    await delay()

    // The commit installs the new callback; the old one is never reused.
    await clickAt(stdin, cell.x + 1, cell.y + 1)
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).toHaveBeenCalledTimes(1)

    // A committed disabled flip is installed by the same commit phase.
    rerender(
      wrapInFramework(
        <MouseLayout origin={{ x: 0, y: 0 }}>
          <Button disabled onActivate={second}>
            Swap
          </Button>
        </MouseLayout>,
      ),
    )
    await delay()
    await clickAt(stdin, cell.x + 1, cell.y + 1)
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('calls the latest committed explicit callback after a committed rerender', async () => {
    const first = vi.fn()
    const second = vi.fn()
    const mouseBounds = { x: 1, y: 1, width: 4, height: 1 }

    const { rerender, stdin } = renderInFramework(
      <Button onActivate={first} mouseBounds={mouseBounds}>
        Explicit
      </Button>,
    )

    await delay()
    await clickAt(stdin, 2, 2)
    expect(first).toHaveBeenCalledTimes(1)

    rerender(
      wrapInFramework(
        <Button onActivate={second} mouseBounds={mouseBounds}>
          Explicit
        </Button>,
      ),
    )
    await delay()

    await clickAt(stdin, 2, 2)
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).toHaveBeenCalledTimes(1)
  })

  it('uses the measured Box layout in a tightly constrained row', async () => {
    const automatic = renderInFramework(
      <MouseLayout origin={{ x: 0, y: 0 }} width={7} flexDirection="row">
        <Text>LEFT</Text>
        <Button onActivate={() => {}}>Go</Button>
      </MouseLayout>,
    )
    const explicit = renderInFramework(
      <MouseLayout origin={{ x: 0, y: 0 }} width={7} flexDirection="row">
        <Text>LEFT</Text>
        <Button
          onActivate={() => {}}
          mouseBounds={{ x: 0, y: 0, width: 1, height: 1 }}
        >
          Go
        </Button>
      </MouseLayout>,
    )

    await delay()

    // Automatic measurement needs a real Ink Box around Text. The consumer
    // approved this opt-in flex reflow; keep it visible in the test contract.
    expect(stripAnsi(automatic.lastFrame() ?? '')).toBe('LEF[Go]\nT')
    expect(stripAnsi(explicit.lastFrame() ?? '')).toBe('LEF[Go]\n')
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
