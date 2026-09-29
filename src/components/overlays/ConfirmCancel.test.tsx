import { describe, it, expect, vi } from 'vitest'
import { render } from 'ink-testing-library'
import type { ReactElement } from 'react'
import stripAnsi from 'strip-ansi'
import { ThemeProvider } from '../../design-system/ThemeProvider.js'
import { KeyboardScopeProvider } from '../../interaction/keyboard/KeyboardScopeProvider.js'
import { FrameworkProvider } from '../../FrameworkProvider.js'
import { MouseLayout } from '../../interaction/mouse/MouseLayout.js'
import { ScreenRegistry } from '../../screens/registry.js'
import { ConfirmCancel } from './ConfirmCancel.js'

function renderInTheme(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>)
}

function delay(ms = 50) {
  return new Promise((r) => setTimeout(r, ms))
}

function findMarker(frame: string, marker: string): { x: number; y: number } {
  const lines = stripAnsi(frame).split('\n')
  for (let y = 0; y < lines.length; y++) {
    const x = lines[y]!.indexOf(marker)
    if (x !== -1) return { x, y }
  }
  throw new Error(`Marker not found: ${marker}`)
}

async function clickAt(
  stdin: { write: (data: string) => void },
  x: number,
  y: number,
) {
  stdin.write(`\u001B[<0;${x + 1};${y + 1}M`)
  await delay()
  stdin.write(`\u001B[<0;${x + 1};${y + 1}m`)
  await delay()
}

describe('ConfirmCancel', () => {
  it('renders title and message', () => {
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider>
        <ConfirmCancel
          title="Delete?"
          message="Are you sure?"
          onConfirm={() => {}}
          onCancel={() => {}}
        />
      </KeyboardScopeProvider>,
    )
    const frame = lastFrame()
    expect(frame).toContain('Delete?')
    expect(frame).toContain('Are you sure?')
  })

  it('shows default confirm and cancel labels', () => {
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider>
        <ConfirmCancel
          title="Confirm"
          message="Proceed?"
          onConfirm={() => {}}
          onCancel={() => {}}
        />
      </KeyboardScopeProvider>,
    )
    const frame = lastFrame()
    expect(frame).toContain('[enter]')
    expect(frame).toContain('Confirm')
    expect(frame).toContain('[esc]')
    expect(frame).toContain('Cancel')
  })

  it('shows custom confirm and cancel labels', () => {
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider>
        <ConfirmCancel
          title="Prompt"
          message="Go ahead?"
          confirmLabel="Yes"
          cancelLabel="No"
          onConfirm={() => {}}
          onCancel={() => {}}
        />
      </KeyboardScopeProvider>,
    )
    const frame = lastFrame()
    expect(frame).toContain('[enter]')
    expect(frame).toContain('Yes')
    expect(frame).toContain('[esc]')
    expect(frame).toContain('No')
  })

  it('calls onConfirm when Enter is pressed', async () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()

    const { stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="modal">
        <ConfirmCancel
          title="Confirm"
          message="Are you sure?"
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      </KeyboardScopeProvider>,
    )

    stdin.write('\r')
    await delay()

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('calls onCancel when Escape is pressed', async () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()

    const { stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="modal">
        <ConfirmCancel
          title="Confirm"
          message="Are you sure?"
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      </KeyboardScopeProvider>,
    )

    stdin.write('\u001b')
    await delay()

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('routes footer mouse clicks through the same confirm and cancel callbacks', async () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    const registry = new ScreenRegistry()
    registry.register({
      id: 'home',
      title: 'Home',
      component: () => null,
    })

    const { stdin, lastFrame } = render(
      <MouseLayout origin={{ x: 0, y: 0 }}>
        <FrameworkProvider registry={registry} defaultScreen="home">
          <ConfirmCancel
            title="Delete entry?"
            message="Are you sure?"
            confirmLabel="Remove"
            cancelLabel="Keep"
            onConfirm={onConfirm}
            onCancel={onCancel}
          />
        </FrameworkProvider>
      </MouseLayout>,
    )

    await delay()
    let marker = findMarker(lastFrame() ?? '', 'Remove')
    await clickAt(stdin, marker.x, marker.y)
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()

    marker = findMarker(lastFrame() ?? '', 'Keep')
    await clickAt(stdin, marker.x, marker.y)
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('renders danger variant', () => {
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider>
        <ConfirmCancel
          title="Delete?"
          message="This cannot be undone"
          onConfirm={() => {}}
          onCancel={() => {}}
          danger
        />
      </KeyboardScopeProvider>,
    )
    const frame = lastFrame()
    expect(frame).toContain('Delete?')
    expect(frame).toContain('This cannot be undone')
    expect(frame).toContain('[enter]')
    expect(frame).toContain('[esc]')
  })
})
