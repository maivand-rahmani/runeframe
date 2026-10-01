import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { Text } from 'ink'
import type { ReactElement } from 'react'
import { ThemeProvider } from '../../design-system/ThemeProvider.js'
import {
  ToastProvider,
  useToast,
  useToastVisibleRows,
} from './ToastProvider.js'

function renderInTheme(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>)
}

function delay(ms = 50) {
  return new Promise((r) => setTimeout(r, ms))
}

function setTerminalRows(stdout: unknown, rows: number): void {
  const target = stdout as { rows: number; emit: (event: string) => boolean }
  target.rows = rows
  target.emit('resize')
}

function frameLines(frame: string | undefined): string[] {
  const normalized = (frame ?? '').replace(/\n+$/, '')
  return normalized.length === 0 ? [] : normalized.split('\n')
}

function renderRowsHarness() {
  let toastFn: ReturnType<typeof useToast>['toast'] | null = null
  let observedRows = -1
  let observedHookRows = -1

  function Harness() {
    const { toast, visibleRows } = useToast()
    const hookRows = useToastVisibleRows()
    toastFn = toast
    observedRows = visibleRows
    observedHookRows = hookRows
    return <Text>{`visible:${visibleRows} hook:${hookRows}`}</Text>
  }

  const app = renderInTheme(
    <ToastProvider>
      <Harness />
    </ToastProvider>,
  )

  return {
    app,
    getToast: () => toastFn!,
    getRows: () => observedRows,
    getHookRows: () => observedHookRows,
  }
}

describe('ToastProvider', () => {
  it('renders children when no toasts are present', () => {
    const { lastFrame } = renderInTheme(
      <ToastProvider>
        <Text>main content</Text>
      </ToastProvider>,
    )
    expect(lastFrame()).toContain('main content')
  })

  it('adds and displays a toast', async () => {
    let toastFn: ReturnType<typeof useToast>['toast'] | null = null
    function Harness() {
      const { toast } = useToast()
      toastFn = toast
      return <Text>content</Text>
    }

    const { lastFrame } = renderInTheme(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    )

    toastFn!('success', 'Saved!')
    await delay()
    expect(lastFrame()).toContain('Saved!')
    expect(lastFrame()).toContain('content')
  })

  it('dismisses a toast via returned dismiss function', async () => {
    let toastFn: ReturnType<typeof useToast>['toast'] | null = null
    function Harness() {
      const { toast } = useToast()
      toastFn = toast
      return null
    }

    const { lastFrame } = renderInTheme(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    )

    const result = toastFn!('warning', 'Warning message')
    await delay()
    expect(lastFrame()).toContain('Warning message')

    result.dismiss()
    await delay()
    expect(lastFrame()).not.toContain('Warning message')
  })

  it('caps stack at 3 and discards oldest when full', async () => {
    let toastFn: ReturnType<typeof useToast>['toast'] | null = null
    function Harness() {
      const { toast } = useToast()
      toastFn = toast
      return null
    }

    const { lastFrame } = renderInTheme(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    )

    toastFn!('info', 'Toast 1')
    toastFn!('info', 'Toast 2')
    toastFn!('info', 'Toast 3')
    toastFn!('info', 'Toast 4')
    await delay()

    const frame = lastFrame()
    expect(frame).not.toContain('Toast 1')
    expect(frame).toContain('Toast 2')
    expect(frame).toContain('Toast 3')
    expect(frame).toContain('Toast 4')
  })

  it('renders all variant labels within cap', async () => {
    let toastFn: ReturnType<typeof useToast>['toast'] | null = null
    function Harness() {
      const { toast } = useToast()
      toastFn = toast
      return null
    }

    const { lastFrame } = renderInTheme(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    )

    toastFn!('success', 'Success!')
    toastFn!('error', 'Error!')
    toastFn!('info', 'Info!')
    await delay()

    const frame = lastFrame()
    expect(frame).toContain('Success!')
    expect(frame).toContain('Error!')
    expect(frame).toContain('Info!')
  })

  describe('auto-dismiss', () => {
    it('auto-dismisses a toast after the specified timeout', async () => {
      let toastFn: ReturnType<typeof useToast>['toast'] | null = null
      function Harness() {
        const { toast } = useToast()
        toastFn = toast
        return null
      }

      const { lastFrame } = renderInTheme(
        <ToastProvider>
          <Harness />
        </ToastProvider>,
      )

      toastFn!('success', 'Auto dismiss', 100)
      await delay(30)
      expect(lastFrame()).toContain('Auto dismiss')

      await delay(150)
      expect(lastFrame()).not.toContain('Auto dismiss')
    })

    it('does not auto-dismiss when timeout is zero', async () => {
      let toastFn: ReturnType<typeof useToast>['toast'] | null = null
      function Harness() {
        const { toast } = useToast()
        toastFn = toast
        return null
      }

      const { lastFrame } = renderInTheme(
        <ToastProvider>
          <Harness />
        </ToastProvider>,
      )

      toastFn!('info', 'Persistent', 0)
      await delay(50)
      expect(lastFrame()).toContain('Persistent')

      await delay(200)
      expect(lastFrame()).toContain('Persistent')
    })

    it('does not auto-dismiss when timeout is undefined', async () => {
      let toastFn: ReturnType<typeof useToast>['toast'] | null = null
      function Harness() {
        const { toast } = useToast()
        toastFn = toast
        return null
      }

      const { lastFrame } = renderInTheme(
        <ToastProvider>
          <Harness />
        </ToastProvider>,
      )

      toastFn!('warning', 'Sticky')
      await delay(50)
      expect(lastFrame()).toContain('Sticky')

      await delay(200)
      expect(lastFrame()).toContain('Sticky')
    })

    it('manually dismissing a toast clears its auto-dismiss timer', async () => {
      let toastFn: ReturnType<typeof useToast>['toast'] | null = null
      function Harness() {
        const { toast } = useToast()
        toastFn = toast
        return null
      }

      const { lastFrame } = renderInTheme(
        <ToastProvider>
          <Harness />
        </ToastProvider>,
      )

      const result = toastFn!('error', 'Manual', 100)
      await delay(30)
      expect(lastFrame()).toContain('Manual')

      result.dismiss()
      await delay(50)
      expect(lastFrame()).not.toContain('Manual')

      await delay(150)
      expect(lastFrame()).not.toContain('Manual')
    })
  })

  describe('visible row reservation', () => {
    it('reports one visible row per toast at 24 terminal rows', async () => {
      const harness = renderRowsHarness()
      setTerminalRows(harness.app.stdout, 24)
      await delay()

      harness.getToast()('info', 'First toast')
      await delay()
      expect(harness.getRows()).toBe(1)
      expect(harness.getHookRows()).toBe(1)
      expect(harness.app.lastFrame()).toContain('visible:1 hook:1')
      expect(frameLines(harness.app.lastFrame())).toHaveLength(2)

      harness.getToast()('success', 'Second toast')
      harness.getToast()('error', 'Third toast')
      await delay()
      expect(harness.getRows()).toBe(3)
      expect(harness.getHookRows()).toBe(3)
      expect(harness.app.lastFrame()).toContain('visible:3 hook:3')
      expect(frameLines(harness.app.lastFrame())).toHaveLength(4)
    })

    it('never wraps a long toast into more than one row', async () => {
      const harness = renderRowsHarness()
      setTerminalRows(harness.app.stdout, 24)
      await delay()

      const longMessage = `long-${'x'.repeat(300)}-tail`
      harness.getToast()('warning', longMessage)
      await delay()

      expect(harness.getRows()).toBe(1)
      const lines = frameLines(harness.app.lastFrame())
      expect(lines).toHaveLength(2)
      expect(lines[0]).toContain('long-')
      expect(lines[0]).toContain('…')
      expect(lines[0]).not.toContain('-tail')
    })

    it('renders a multi-line message as a single physical row', async () => {
      const harness = renderRowsHarness()
      setTerminalRows(harness.app.stdout, 24)
      await delay()

      harness.getToast()('error', 'line one\nline two')
      await delay()

      expect(harness.getRows()).toBe(1)
      expect(frameLines(harness.app.lastFrame())).toHaveLength(2)
      expect(harness.app.lastFrame()).toContain('line one line two')
    })

    it('bounds the host by rows - 1 and hides toasts when no row is free', async () => {
      const harness = renderRowsHarness()
      setTerminalRows(harness.app.stdout, 2)
      await delay()

      harness.getToast()('info', 'Older toast')
      harness.getToast()('info', 'Newer toast')
      await delay()

      expect(harness.getRows()).toBe(1)
      expect(harness.app.lastFrame()).toContain('Newer toast')
      expect(harness.app.lastFrame()).not.toContain('Older toast')
      expect(frameLines(harness.app.lastFrame())).toHaveLength(2)

      setTerminalRows(harness.app.stdout, 1)
      await delay()

      expect(harness.getRows()).toBe(0)
      expect(harness.getHookRows()).toBe(0)
      expect(harness.app.lastFrame()).not.toContain('Newer toast')
      expect(frameLines(harness.app.lastFrame())).toHaveLength(1)
    })

    it('updates visibleRows when a toast is dismissed', async () => {
      const harness = renderRowsHarness()
      setTerminalRows(harness.app.stdout, 24)
      await delay()

      harness.getToast()('info', 'One')
      harness.getToast()('info', 'Two')
      const third = harness.getToast()('info', 'Three')
      await delay()
      expect(harness.getRows()).toBe(3)
      expect(frameLines(harness.app.lastFrame())).toHaveLength(4)

      third.dismiss()
      await delay()
      expect(harness.getRows()).toBe(2)
      expect(harness.getHookRows()).toBe(2)
      expect(harness.app.lastFrame()).toContain('visible:2 hook:2')
      expect(frameLines(harness.app.lastFrame())).toHaveLength(3)
    })

    it('useToastVisibleRows returns 0 outside a ToastProvider', () => {
      function OutsideProvider() {
        const rows = useToastVisibleRows()
        return <Text>{`outside:${rows}`}</Text>
      }

      const { lastFrame } = renderInTheme(<OutsideProvider />)
      expect(lastFrame()).toContain('outside:0')
    })
  })
})
