import { describe, it, expect, afterEach } from 'vitest'
import { render } from 'ink-testing-library'
import chalk from 'chalk'
import { Text } from 'ink'
import type { ReactElement } from 'react'
import { ThemeProvider } from '../../design-system/ThemeProvider.js'
import type { ThemeOverrides } from '../../types.js'
import { Badge } from './Badge.js'
import { Button } from './Button.js'
import { Divider } from './Divider.js'
import { Panel } from './Panel.js'
import { Spacer } from './Spacer.js'
import { Table, type Column } from './Table.js'

function renderThemed(ui: ReactElement, theme?: ThemeOverrides) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

function plain(frame: string | undefined): string {
  return (frame ?? '').replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
}

function frameLines(frame: string | undefined): string[] {
  const lines = plain(frame).split('\n')
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

const originalChalkLevel = chalk.level
afterEach(() => {
  chalk.level = originalChalkLevel
})

function withColorOutput(run: () => void) {
  chalk.level = 1
  run()
}

describe('primitives theme consumption', () => {
  it('keeps built-in defaults when no theme is provided', () => {
    const { lastFrame } = renderThemed(
      <>
        <Button>Go</Button>
        <Badge variant="info">New</Badge>
        <Divider />
      </>,
    )

    const frame = plain(lastFrame())
    expect(frame).toContain('[Go]')
    expect(frame).toContain('[New]')
    expect(frame).toContain('\u2500'.repeat(28))
  })

  it('consumes global symbols', () => {
    const { lastFrame } = renderThemed(
      <>
        <Button>Go</Button>
        <Badge variant="info">New</Badge>
        <Divider />
      </>,
      {
        symbols: {
          button: { open: '<', close: '>' },
          badge: { open: '\u00ab', close: '\u00bb' },
          divider: { horizontal: '=' },
        },
      },
    )

    const frame = plain(lastFrame())
    expect(frame).toContain('<Go>')
    expect(frame).toContain('\u00abNew\u00bb')
    expect(frame).toContain('='.repeat(28))
  })

  it('prefers per-component symbols over global symbols', () => {
    const { lastFrame } = renderThemed(<Button>Go</Button>, {
      symbols: { button: { open: '<', close: '>' } },
      components: { button: { symbols: { open: '(', close: ')' } } },
    })

    expect(plain(lastFrame())).toContain('(Go)')
  })

  it('consumes global layout metrics', () => {
    const { lastFrame } = renderThemed(<Divider />, {
      layout: { dividerWidth: 5 },
    })

    const frame = plain(lastFrame())
    expect(frame).toContain('\u2500'.repeat(5))
    expect(frame).not.toContain('\u2500'.repeat(28))
  })

  it('prefers per-component layout over global layout', () => {
    const { lastFrame } = renderThemed(<Divider />, {
      layout: { dividerWidth: 5 },
      components: { divider: { layout: { width: 3 } } },
    })

    const frame = plain(lastFrame())
    expect(frame).toContain('\u2500'.repeat(3))
    expect(frame).not.toContain('\u2500'.repeat(5))
  })

  it('consumes per-component spacing', () => {
    const defaultFrame = renderThemed(
      <>
        <Text>a</Text>
        <Spacer />
        <Text>b</Text>
      </>,
    )
    expect(frameLines(defaultFrame.lastFrame())).toEqual([
      'a',
      '',
      '',
      '',
      'b',
    ])

    const compactFrame = renderThemed(
      <>
        <Text>a</Text>
        <Spacer />
        <Text>b</Text>
      </>,
      { components: { spacer: { spacing: { md: 0 } } } },
    )
    expect(frameLines(compactFrame.lastFrame())).toEqual(['a', 'b'])
  })

  it('consumes per-component colors while keeping untouched variant defaults', () => {
    withColorOutput(() => {
      const { lastFrame } = renderThemed(
        <>
          <Button variant="primary">Go</Button>
          <Button variant="danger">Stop</Button>
        </>,
        { components: { button: { colors: { primary: 'magenta' } } } },
      )

      const frame = lastFrame() ?? ''
      expect(frame).toContain('\u001B[35m')
      // Untouched variants keep the global semantic color (red).
      expect(frame).toContain('\u001B[31m')
    })
  })

  it('consumes per-component border styles and border colors', () => {
    const { lastFrame } = renderThemed(
      <Panel title="Settings">
        <Text>inside</Text>
      </Panel>,
      { components: { panel: { borderStyle: 'double' } } },
    )

    const frame = plain(lastFrame())
    expect(frame).toContain('\u2554')
    expect(frame).not.toContain('\u256d')
  })

  it('keeps global border style tokens for panel', () => {
    const { lastFrame } = renderThemed(
      <Panel title="Settings">
        <Text>inside</Text>
      </Panel>,
      { borderStyles: { panel: 'double' } },
    )

    expect(plain(lastFrame())).toContain('\u2554')
  })

  it('consumes global layout breakpoints for tables', () => {
    const columns: Column<Record<string, unknown>>[] = [
      { key: 'name', label: 'Name', width: 16 },
      { key: 'role', label: 'Role', width: 18, priority: 'low' },
      { key: 'team', label: 'Team', width: 16 },
    ]
    const rows = [
      { name: 'Alice', role: 'HiddenRole', team: 'Platform' },
    ]

    const defaultFrame = renderThemed(
      <Table columns={columns} rows={rows} width={40} />,
    )
    expect(plain(defaultFrame.lastFrame())).not.toContain('HiddenRole')

    const wideFrame = renderThemed(
      <Table columns={columns} rows={rows} width={40} />,
      { layout: { mediumColumns: 30 } },
    )
    expect(plain(wideFrame.lastFrame())).toContain('HiddenRole')
  })

  it('consumes per-component table border styles', () => {
    const columns: Column<Record<string, unknown>>[] = [
      { key: 'name', label: 'Name', width: 16 },
    ]
    const rows = [{ name: 'Alice' }]

    const { lastFrame } = renderThemed(
      <Table columns={columns} rows={rows} width={40} />,
      { components: { table: { borderStyle: 'double' } } },
    )

    expect(plain(lastFrame())).toContain('\u2554')
  })
})
