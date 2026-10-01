import { describe, it, expect, afterEach, vi } from 'vitest'
import { render } from 'ink-testing-library'
import chalk from 'chalk'
import { Text } from 'ink'
import { ThemeProvider } from '../../design-system/ThemeProvider.js'
import type { ThemeOverrides } from '../../types.js'
import { EmptyState } from './EmptyState.js'
import { LoadingState } from './LoadingState.js'
import { ToastProvider, useToast } from './ToastProvider.js'

function plain(frame: string | undefined): string {
  return (frame ?? '').replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
}

function frameLines(frame: string | undefined): string[] {
  const lines = plain(frame).split('\n')
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

function renderToasts(theme?: ThemeOverrides) {
  let toastFn: ReturnType<typeof useToast>['toast'] | null = null

  function Harness() {
    toastFn = useToast().toast
    return <Text>content</Text>
  }

  const app = render(
    <ThemeProvider theme={theme}>
      <ToastProvider>
        <Harness />
      </ToastProvider>
    </ThemeProvider>,
  )

  return {
    lastFrame: app.lastFrame,
    getToast: () => toastFn!,
  }
}

const originalChalkLevel = chalk.level
afterEach(() => {
  chalk.level = originalChalkLevel
})

describe('feedback theme consumption', () => {
  it('consumes per-component Toast colors', async () => {
    chalk.level = 1
    const app = renderToasts({
      components: { toast: { colors: { success: 'magenta' } } },
    })

    app.getToast()('success', 'Saved!')
    await vi.waitFor(() => {
      const frame = app.lastFrame() ?? ''
      expect(frame).toContain('Saved!')
      expect(frame).toContain('\u001B[35m')
    })
  })

  it('consumes per-component Toast visibility limits', async () => {
    const app = renderToasts({
      components: { toast: { layout: { maxVisible: 1 } } },
    })

    app.getToast()('info', 'First message')
    app.getToast()('info', 'Second message')
    await vi.waitFor(() => {
      expect(plain(app.lastFrame())).toContain('Second message')
    })

    expect(plain(app.lastFrame())).not.toContain('First message')
  })

  it('keeps default Toast colors without a theme', async () => {
    chalk.level = 1
    const app = renderToasts()

    app.getToast()('success', 'Saved!')
    await vi.waitFor(() => {
      expect(app.lastFrame()).toContain('Saved!')
    })

    expect(app.lastFrame()).toContain('\u001B[32m')
  })

  it('keeps EmptyState default spacing without a theme', () => {
    const { lastFrame } = render(
      <ThemeProvider>
        <EmptyState
          title="Nothing here"
          description="No items"
          hint="Add one"
        />
      </ThemeProvider>,
    )

    expect(frameLines(lastFrame())).toEqual([
      'Nothing here',
      '',
      'No items',
      '',
      'Add one',
    ])
  })

  it('consumes per-component EmptyState spacing and colors', () => {
    chalk.level = 1
    const { lastFrame } = render(
      <ThemeProvider
        theme={{
          components: {
            emptyState: {
              spacing: { titleMarginBottom: 0, hintMarginTop: 0 },
              colors: { title: 'magenta' },
            },
          },
        }}
      >
        <EmptyState
          title="Nothing here"
          description="No items"
          hint="Add one"
        />
      </ThemeProvider>,
    )

    expect(frameLines(lastFrame())).toEqual([
      'Nothing here',
      'No items',
      'Add one',
    ])
    expect(lastFrame()).toContain('\u001B[35m')
  })

  it('consumes per-component LoadingState colors', () => {
    chalk.level = 1
    const { lastFrame } = render(
      <ThemeProvider
        theme={{ components: { loadingState: { colors: { text: 'magenta' } } } }}
      >
        <LoadingState label="dashboard" />
      </ThemeProvider>,
    )

    expect(plain(lastFrame())).toContain('Loading dashboard...')
    expect(lastFrame()).toContain('\u001B[35m')
  })
})
