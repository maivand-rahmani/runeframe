import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { Text } from 'ink'
import type { ReactElement } from 'react'
import { ThemeProvider } from '../../design-system/ThemeProvider.js'
import { ToastProvider, useToast } from './ToastProvider.js'

function renderInTheme(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>)
}

function delay(ms = 50) {
  return new Promise((r) => setTimeout(r, ms))
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
})
