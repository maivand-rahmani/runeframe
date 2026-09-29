import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import type { ReactElement } from 'react'
import { ThemeProvider } from '../../design-system/ThemeProvider.js'
import { LAYOUT } from '../../constants.js'
import { Table, type Column } from './Table.js'

function renderInTheme(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>)
}

type UserRow = Record<string, unknown> & {
  name: string
  role: string
  team: string
  notes: string
}

describe('Table', () => {
  it('renders a single-border table with title, headers, and row data', () => {
    const columns: Column<UserRow>[] = [
      { key: 'name', label: 'Name', width: 12 },
      { key: 'role', label: 'Role', width: 12 },
    ]
    const rows: UserRow[] = [{ name: 'Alice', role: 'Engineer', team: 'Core', notes: 'Ready' }]

    const { lastFrame } = renderInTheme(
      <Table title="Roster" columns={columns} rows={rows} width={40} />,
    )

    const frame = lastFrame() ?? ''
    expect(frame).toContain('┌')
    expect(frame).toContain('Roster')
    expect(frame).toContain('Name')
    expect(frame).toContain('Role')
    expect(frame).toContain('Alice')
    expect(frame).toContain('Engineer')
  })

  it('truncates overflowing cell content within allocated widths', () => {
    const columns: Column<UserRow>[] = [
      { key: 'name', label: 'Name', width: 6 },
      { key: 'notes', label: 'Notes', width: 10 },
    ]
    const rows: UserRow[] = [
      {
        name: 'Alexandria',
        role: 'Engineer',
        team: 'Core',
        notes: 'Very descriptive text',
      },
    ]

    const { lastFrame } = renderInTheme(
      <Table columns={columns} rows={rows} width={18} />,
    )

    const frame = lastFrame() ?? ''
    expect(frame).toContain('Alex…')
    expect(frame).toContain('Very de…')
    expect(frame).not.toContain('Alexandria')
    expect(frame).not.toContain('Very descriptive text')
  })

  it('hides low-priority columns below the medium layout breakpoint', () => {
    const columns: Column<UserRow>[] = [
      { key: 'name', label: 'Name', width: 16 },
      { key: 'role', label: 'Role', width: 18, priority: 'low' },
      { key: 'team', label: 'Team', width: 16 },
    ]
    const rows: UserRow[] = [
      {
        name: 'Alice',
        role: 'HiddenRole',
        team: 'Platform',
        notes: 'Ready',
      },
    ]

    const { lastFrame } = renderInTheme(
      <Table
        columns={columns}
        rows={rows}
        width={LAYOUT.medium - 1}
      />,
    )

    const frame = lastFrame() ?? ''
    expect(frame).toContain('Name')
    expect(frame).toContain('Team')
    expect(frame).toContain('Alice')
    expect(frame).toContain('Platform')
    expect(frame).not.toContain('Role')
    expect(frame).not.toContain('HiddenRole')
  })
})
