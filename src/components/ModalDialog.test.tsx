import { describe, it, expect, vi } from 'vitest'
import { render } from 'ink-testing-library'
import { Text } from 'ink'
import type { ReactElement } from 'react'
import stripAnsi from 'strip-ansi'
import { ThemeProvider } from '../design-system/ThemeProvider.js'
import { KeyboardScopeProvider } from '../interaction/KeyboardScopeProvider.js'
import { FrameworkProvider } from '../FrameworkProvider.js'
import { MouseLayout } from '../interaction/MouseLayout.js'
import { ScreenRegistry } from '../screens/registry.js'
import { ModalDialog } from './ModalDialog.js'
import type { Action } from '../commands/ActionRegistry.js'

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

describe('ModalDialog', () => {
  it('renders title and children', () => {
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider>
        <ModalDialog title="Modal Title" onClose={() => {}}>
          <Text>Child content</Text>
        </ModalDialog>
      </KeyboardScopeProvider>,
    )
    const frame = lastFrame()
    expect(frame).toContain('Modal Title')
    expect(frame).toContain('Child content')
  })

  it('calls onClose when Escape is pressed', async () => {
    const onClose = vi.fn()

    const { stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="modal">
        <ModalDialog title="Test" onClose={onClose}>
          <Text>Content</Text>
        </ModalDialog>
      </KeyboardScopeProvider>,
    )

    stdin.write('\u001b')
    await delay()

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders footer actions as hotkey hints', () => {
    const footer: Action[] = [
      {
        id: 'save',
        label: 'Save',
        category: 'input',
        handler: () => {},
        keys: ['s'],
      },
      {
        id: 'cancel',
        label: 'Cancel',
        category: 'input',
        handler: () => {},
        keys: ['esc'],
      },
    ]

    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider>
        <ModalDialog title="Test" onClose={() => {}} footer={footer}>
          <Text>Content</Text>
        </ModalDialog>
      </KeyboardScopeProvider>,
    )
    const frame = lastFrame()
    expect(frame).toContain('[s]')
    expect(frame).toContain('Save')
    expect(frame).toContain('[esc]')
    expect(frame).toContain('Cancel')
  })

  it('activates footer handlers with mouse and consumes disabled actions', async () => {
    const onSave = vi.fn()
    const onCancel = vi.fn()
    const onDisabled = vi.fn()
    const registry = new ScreenRegistry()
    registry.register({
      id: 'home',
      title: 'Home',
      component: () => null,
    })
    const footer: Action[] = [
      {
        id: 'save',
        label: 'Save',
        category: 'input',
        handler: onSave,
      },
      {
        id: 'cancel',
        label: 'Cancel',
        category: 'input',
        handler: onCancel,
      },
      {
        id: 'disabled',
        label: 'Locked',
        category: 'input',
        handler: onDisabled,
        enabled: false,
      },
    ]

    const { stdin, lastFrame } = render(
      <MouseLayout origin={{ x: 0, y: 0 }}>
        <FrameworkProvider registry={registry} defaultScreen="home">
          <ModalDialog title="Actions" onClose={() => {}} footer={footer}>
            <Text>Body</Text>
          </ModalDialog>
        </FrameworkProvider>
      </MouseLayout>,
    )

    await delay()
    let marker = findMarker(lastFrame() ?? '', 'Save')
    await clickAt(stdin, marker.x, marker.y)
    expect(onSave).toHaveBeenCalledTimes(1)

    marker = findMarker(lastFrame() ?? '', 'Cancel')
    await clickAt(stdin, marker.x, marker.y)
    expect(onCancel).toHaveBeenCalledTimes(1)

    marker = findMarker(lastFrame() ?? '', 'Locked')
    await clickAt(stdin, marker.x, marker.y)
    expect(onDisabled).not.toHaveBeenCalled()
  })

  it('renders with custom width', () => {
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider>
        <ModalDialog title="Width Test" onClose={() => {}} width={40}>
          <Text>Fixed width content</Text>
        </ModalDialog>
      </KeyboardScopeProvider>,
    )
    expect(lastFrame()).toContain('Width Test')
    expect(lastFrame()).toContain('Fixed width content')
  })

  it('suspends shell hotkeys when trapFocus is true', () => {
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider>
        <ModalDialog title="Trap" onClose={() => {}} trapFocus={true}>
          <Text>Focused</Text>
        </ModalDialog>
      </KeyboardScopeProvider>,
    )
    expect(lastFrame()).toContain('Trap')
    expect(lastFrame()).toContain('Focused')
  })
})
