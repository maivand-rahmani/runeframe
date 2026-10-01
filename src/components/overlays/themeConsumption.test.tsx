import { describe, it, expect, afterEach, vi } from 'vitest'
import { render } from 'ink-testing-library'
import chalk from 'chalk'
import { Text } from 'ink'
import type { ReactElement } from 'react'
import { ThemeProvider } from '../../design-system/ThemeProvider.js'
import { KeyboardScopeProvider } from '../../interaction/keyboard/KeyboardScopeProvider.js'
import { ScreenRegistry } from '../../screens/registry.js'
import {
  NavigationProvider,
  useNavigation,
} from '../../navigation/NavigationProvider.js'
import type { Action } from '../../commands/actions/ActionRegistry.js'
import type { ThemeOverrides } from '../../types.js'
import { ConfirmCancel } from './ConfirmCancel.js'
import { ConfirmModal } from './ConfirmModal.js'
import { InfoModal } from './InfoModal.js'
import { ModalDialog } from './ModalDialog.js'
import { ModalProvider } from './ModalProvider.js'

function renderThemed(ui: ReactElement, theme?: ThemeOverrides) {
  return render(
    <ThemeProvider theme={theme}>
      <KeyboardScopeProvider>{ui}</KeyboardScopeProvider>
    </ThemeProvider>,
  )
}

function plain(frame: string | undefined): string {
  return (frame ?? '').replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
}

function lineWith(frame: string | undefined, text: string): string {
  const line = plain(frame)
    .split(/\r?\n/)
    .find((candidate) => candidate.includes(text))
  if (line == null) {
    throw new Error(`Could not find ${JSON.stringify(text)} in frame`)
  }
  return line
}

const footer: Action[] = [
  {
    id: 'ok',
    label: 'OK',
    category: 'input',
    handler: () => {},
    keys: ['enter'],
  },
]

const originalChalkLevel = chalk.level
afterEach(() => {
  chalk.level = originalChalkLevel
})

describe('overlay theme consumption', () => {
  it('keeps ModalDialog defaults without a theme', () => {
    const { lastFrame } = renderThemed(
      <ModalDialog title="Confirm" onClose={() => {}} footer={footer}>
        <Text>Body</Text>
      </ModalDialog>,
    )

    const frame = plain(lastFrame())
    expect(frame).toContain('\u256d')
    expect(frame).toContain('[enter] OK')
  })

  it('consumes the global modal border style', () => {
    const { lastFrame } = renderThemed(
      <ModalDialog title="Confirm" onClose={() => {}} footer={footer}>
        <Text>Body</Text>
      </ModalDialog>,
      { layout: { modalBorderStyle: 'double' } },
    )

    expect(plain(lastFrame())).toContain('\u2554')
  })

  it('prefers the per-component ModalDialog border style over global layout', () => {
    const { lastFrame } = renderThemed(
      <ModalDialog title="Confirm" onClose={() => {}} footer={footer}>
        <Text>Body</Text>
      </ModalDialog>,
      {
        layout: { modalBorderStyle: 'double' },
        components: { modalDialog: { borderStyle: 'single' } },
      },
    )

    const frame = plain(lastFrame())
    expect(frame).toContain('\u250c')
    expect(frame).not.toContain('\u2554')
  })

  it('consumes per-component ModalDialog symbols and spacing', () => {
    const { lastFrame } = renderThemed(
      <ModalDialog title="Confirm" onClose={() => {}} footer={footer}>
        <Text>Body</Text>
      </ModalDialog>,
      {
        components: {
          modalDialog: {
            symbols: { keyOpen: '\u00ab', keyClose: '\u00bb' },
            spacing: { paddingX: 3 },
          },
        },
      },
    )

    expect(plain(lastFrame())).toContain('\u00abenter\u00bb')
    // Border (1) + paddingX (3) puts the title at column 4.
    expect(lineWith(lastFrame(), 'Confirm').indexOf('Confirm')).toBe(4)
  })

  it('consumes per-component ModalProvider border styles', async () => {
    const registry = new ScreenRegistry()
    registry.register({
      id: 'dashboard',
      title: 'Dashboard',
      component: () => <Text>Dashboard Content</Text>,
      category: 'main',
      sidebar: true,
    })
    registry.register({
      id: 'info-dialog',
      title: 'Info',
      component: () => <InfoModal message="Operation complete" onDismiss={() => {}} />,
      category: 'system',
      sidebar: false,
    })

    let nav: ReturnType<typeof useNavigation> | null = null
    function Harness() {
      nav = useNavigation()
      return (
        <ModalProvider>
          <Text>main content</Text>
        </ModalProvider>
      )
    }

    const { lastFrame } = render(
      <ThemeProvider
        theme={{ components: { modal: { borderStyle: 'double' } } }}
      >
        <KeyboardScopeProvider>
          <NavigationProvider registry={registry} defaultScreen="dashboard">
            <Harness />
          </NavigationProvider>
        </KeyboardScopeProvider>
      </ThemeProvider>,
    )

    nav!.pushModal('info-dialog')
    await vi.waitFor(() => {
      const frame = plain(lastFrame())
      expect(frame).toContain('Operation complete')
      expect(frame).toContain('\u2554')
    })
  })

  it('consumes per-component ConfirmModal symbols and colors', () => {
    chalk.level = 1
    const { lastFrame } = renderThemed(
      <ConfirmModal
        message="Are you sure?"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
      {
        components: {
          confirmModal: {
            symbols: {
              open: '\u00ab',
              close: '\u00bb',
              separator: ' ~ ',
            },
            colors: { title: 'magenta' },
          },
        },
      },
    )

    const frame = lastFrame() ?? ''
    expect(frame).toContain('\u00abYes\u00bb')
    expect(frame).toContain(' ~ ')
    expect(frame).toContain('\u001B[35m')
  })

  it('consumes per-component InfoModal symbols', () => {
    const { lastFrame } = renderThemed(
      <InfoModal message="Done" onDismiss={() => {}} />,
      {
        components: {
          infoModal: {
            symbols: {
              open: '<',
              close: '>',
              dismissHint: ' (enter)',
            },
          },
        },
      },
    )

    const frame = plain(lastFrame())
    expect(frame).toContain('<OK> (enter)')
  })

  it('consumes per-component ConfirmCancel message colors', () => {
    chalk.level = 1
    const { lastFrame } = renderThemed(
      <ConfirmCancel
        title="Delete?"
        message="Are you sure?"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
      { components: { confirmCancel: { colors: { message: 'magenta' } } } },
    )

    const frame = lastFrame() ?? ''
    expect(frame).toContain('Are you sure?')
    expect(frame).toContain('\u001B[35m')
  })
})
