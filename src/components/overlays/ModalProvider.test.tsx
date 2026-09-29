import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render } from 'ink-testing-library'
import { Text } from 'ink'
import type { ReactElement } from 'react'
import stripAnsi from 'strip-ansi'
import { ThemeProvider } from '../../design-system/ThemeProvider.js'
import { FrameworkProvider } from '../../FrameworkProvider.js'
import { ScreenRegistry } from '../../screens/registry.js'
import {
  NavigationProvider,
  useNavigation,
} from '../../navigation/NavigationProvider.js'
import { KeyboardScopeProvider } from '../../interaction/keyboard/KeyboardScopeProvider.js'
import { MouseLayout } from '../../interaction/mouse/MouseLayout.js'
import { ModalProvider } from './ModalProvider.js'
import { ConfirmModal } from './ConfirmModal.js'
import { InfoModal } from './InfoModal.js'

function createTestRegistry() {
  const r = new ScreenRegistry()
  r.register({
    id: 'dashboard',
    title: 'Dashboard',
    component: () => <Text>Dashboard Content</Text>,
    category: 'main',
    sidebar: true,
  })
  r.register({
    id: 'confirm-dialog',
    title: 'Confirm',
    component: () => (
      <ConfirmModal
        message="Are you sure?"
        danger
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    ),
    category: 'system',
    sidebar: false,
  })
  r.register({
    id: 'info-dialog',
    title: 'Info',
    component: () => (
      <InfoModal
        message="Operation complete"
        details="All tasks finished successfully"
        onDismiss={() => {}}
      />
    ),
    category: 'system',
    sidebar: false,
  })
  return r
}

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

describe('ModalProvider', () => {
  let registry: ScreenRegistry

  beforeEach(() => {
    registry = createTestRegistry()
  })

  it('renders children when no modal is open', () => {
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider>
        <NavigationProvider registry={registry} defaultScreen="dashboard">
          <ModalProvider>
            <Text>main content</Text>
          </ModalProvider>
        </NavigationProvider>
      </KeyboardScopeProvider>,
    )
    expect(lastFrame()).toContain('main content')
    expect(lastFrame()).not.toContain('Are you sure?')
  })

  it('renders modal content when modal is pushed', async () => {
    let nav: ReturnType<typeof useNavigation> | null = null
    function Harness() {
      nav = useNavigation()
      return (
        <ModalProvider>
          <Text>main content</Text>
        </ModalProvider>
      )
    }

    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider>
        <NavigationProvider registry={registry} defaultScreen="dashboard">
          <Harness />
        </NavigationProvider>
      </KeyboardScopeProvider>,
    )

    expect(lastFrame()).toContain('main content')

    nav!.pushModal('confirm-dialog')
    await delay()
    const frame = lastFrame()
    expect(frame).toContain('Are you sure?')
    expect(frame).not.toContain('main content')
    expect(frame).toContain('Confirm')
  })

  it('closes modal on Escape', async () => {
    let nav: ReturnType<typeof useNavigation> | null = null
    function Harness() {
      nav = useNavigation()
      return (
        <ModalProvider>
          <Text>main content</Text>
        </ModalProvider>
      )
    }

    const { lastFrame, stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="modal">
        <NavigationProvider registry={registry} defaultScreen="dashboard">
          <Harness />
        </NavigationProvider>
      </KeyboardScopeProvider>,
    )

    nav!.pushModal('confirm-dialog')
    await delay()
    expect(lastFrame()).toContain('Are you sure?')

    stdin.write('\u001b')
    await delay()
    expect(lastFrame()).toContain('main content')
    expect(lastFrame()).not.toContain('Are you sure?')
  })

  it('shows stacked modal count', async () => {
    let nav: ReturnType<typeof useNavigation> | null = null
    function Harness() {
      nav = useNavigation()
      return (
        <ModalProvider>
          <Text>main content</Text>
        </ModalProvider>
      )
    }

    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider>
        <NavigationProvider registry={registry} defaultScreen="dashboard">
          <Harness />
        </NavigationProvider>
      </KeyboardScopeProvider>,
    )

    nav!.pushModal('confirm-dialog')
    await delay()
    expect(lastFrame()).not.toContain('more modal')

    nav!.pushModal('info-dialog')
    await delay()
    expect(lastFrame()).toContain('1 more modal')
  })
})

describe('ConfirmModal', () => {
  it('renders title and message', () => {
    const { lastFrame } = renderInTheme(
      <ConfirmModal
        title="Delete?"
        message="This cannot be undone"
        onConfirm={() => {}}
        onCancel={() => {}}
        danger
      />,
    )
    const frame = lastFrame()
    expect(frame).toContain('Delete?')
    expect(frame).toContain('This cannot be undone')
  })

  it('shows confirm and cancel labels', () => {
    const { lastFrame } = renderInTheme(
      <ConfirmModal
        message="Proceed?"
        confirmLabel="OK"
        cancelLabel="Cancel"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    )
    const frame = lastFrame()
    expect(frame).toContain('[OK]')
    expect(frame).toContain('[Cancel]')
  })

  it('renders with default labels', () => {
    const { lastFrame } = renderInTheme(
      <ConfirmModal
        message="Default labels"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    )
    const frame = lastFrame()
    expect(frame).toContain('[Yes]')
    expect(frame).toContain('[No]')
  })

  it('keeps its original Text output without measured mouse geometry', () => {
    const { lastFrame } = renderInTheme(
      <ConfirmModal
        title="Question"
        message="Ready?"
        confirmLabel="Yes"
        cancelLabel="No"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(stripAnsi(lastFrame() ?? '').trimEnd()).toBe(
      'Question\nReady?\n[Yes] / [No]',
    )
  })
})

describe('InfoModal', () => {
  it('renders title and message', () => {
    const { lastFrame } = renderInTheme(
      <InfoModal
        title="Success"
        message="Operation completed"
        onDismiss={() => {}}
      />,
    )
    const frame = lastFrame()
    expect(frame).toContain('Success')
    expect(frame).toContain('Operation completed')
  })

  it('renders details when provided', () => {
    const { lastFrame } = renderInTheme(
      <InfoModal
        message="Done"
        details="3 items updated"
        onDismiss={() => {}}
      />,
    )
    expect(lastFrame()).toContain('3 items updated')
  })

  it('renders dismiss label', () => {
    const { lastFrame } = renderInTheme(
      <InfoModal
        message="Done"
        dismissLabel="Got it"
        onDismiss={() => {}}
      />,
    )
    expect(lastFrame()).toContain('[Got it]')
  })

  it('renders with default dismiss label', () => {
    const { lastFrame } = renderInTheme(
      <InfoModal
        message="Done"
        onDismiss={() => {}}
      />,
    )
    expect(lastFrame()).toContain('[OK]')
  })

  it('keeps its original Text output without measured mouse geometry', () => {
    const { lastFrame } = renderInTheme(
      <InfoModal
        title="Success"
        message="All done"
        details="3 items updated"
        dismissLabel="Got it"
        onDismiss={() => {}}
      />,
    )
    expect(stripAnsi(lastFrame() ?? '').trimEnd()).toBe(
      'Success\nAll done\n3 items updated\n[Got it] — Press Enter or Escape',
    )
  })

  it('hits confirm and cancel labels through an externally anchored modal host', async () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    const modalRegistry = new ScreenRegistry()
    modalRegistry.register({
      id: 'home',
      title: 'Home',
      component: () => <Text>Home</Text>,
    })
    modalRegistry.register({
      id: 'confirm',
      title: 'Confirm',
      category: 'system',
      component: () => (
        <ConfirmModal
          title="Decision"
          message="Continue?"
          confirmLabel="Approve"
          cancelLabel="Reject"
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      ),
    })

    let nav: ReturnType<typeof useNavigation> | null = null
    function NavigationCapture() {
      nav = useNavigation()
      return null
    }

    const { stdin, lastFrame } = render(
      <MouseLayout origin={{ x: 0, y: 0 }}>
        <FrameworkProvider registry={modalRegistry} defaultScreen="home">
          <NavigationCapture />
        </FrameworkProvider>
      </MouseLayout>,
    )

    nav!.pushModal('confirm')
    await delay()
    let frame = lastFrame() ?? ''
    await clickAt(
      stdin,
      findMarker(frame, '[Approve]').x + 1,
      findMarker(frame, '[Approve]').y,
    )
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()

    frame = lastFrame() ?? ''
    const reject = findMarker(frame, '[Reject]')
    await clickAt(stdin, reject.x + 1, reject.y)
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('hits the InfoModal dismiss label through an externally anchored modal host', async () => {
    const onDismiss = vi.fn()
    const modalRegistry = new ScreenRegistry()
    modalRegistry.register({
      id: 'home',
      title: 'Home',
      component: () => <Text>Home</Text>,
    })
    modalRegistry.register({
      id: 'info',
      title: 'Info',
      category: 'system',
      component: () => (
        <InfoModal
          title="Finished"
          message="Saved"
          dismissLabel="Got it"
          onDismiss={onDismiss}
        />
      ),
    })

    let nav: ReturnType<typeof useNavigation> | null = null
    function NavigationCapture() {
      nav = useNavigation()
      return null
    }

    const { stdin, lastFrame } = render(
      <MouseLayout origin={{ x: 0, y: 0 }}>
        <FrameworkProvider registry={modalRegistry} defaultScreen="home">
          <NavigationCapture />
        </FrameworkProvider>
      </MouseLayout>,
    )

    nav!.pushModal('info')
    await delay()
    const dismiss = findMarker(lastFrame() ?? '', '[Got it]')
    await clickAt(stdin, dismiss.x + 1, dismiss.y)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
