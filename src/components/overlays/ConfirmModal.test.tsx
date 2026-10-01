import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'ink-testing-library'
import stripAnsi from 'strip-ansi'
import chalk from 'chalk'
import { FrameworkProvider } from '../../FrameworkProvider.js'
import { MouseLayout } from '../../interaction/mouse/MouseLayout.js'
import { ScreenRegistry } from '../../screens/registry.js'
import { ConfirmModal } from './ConfirmModal.js'

const registry = new ScreenRegistry()
registry.register({ id: 'test', title: 'Test', component: () => null })

function findMarker(frame: string, marker: string): { x: number; y: number } {
  const lines = stripAnsi(frame).split('\n')
  for (let y = 0; y < lines.length; y++) {
    const x = lines[y]!.indexOf(marker)
    if (x !== -1) return { x, y }
  }
  throw new Error(`Marker not found: ${marker}`)
}

function delay(ms = 50) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const originalChalkLevel = chalk.level
afterEach(() => {
  chalk.level = originalChalkLevel
})

async function moveAt(
  stdin: { write: (data: string) => void },
  x: number,
  y: number,
) {
  stdin.write(`\u001B[<35;${x + 1};${y + 1}M`)
  await delay()
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

describe('ConfirmModal measured choices', () => {
  it('shows a hover cue without confirming until clicked', async () => {
    chalk.level = 1
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    const { stdin, lastFrame } = render(
      <FrameworkProvider registry={registry} defaultScreen="test">
        <MouseLayout origin={{ x: 0, y: 0 }}>
          <ConfirmModal
            message="Continue?"
            onConfirm={onConfirm}
            onCancel={onCancel}
          />
        </MouseLayout>
      </FrameworkProvider>,
    )

    await delay()
    const initial = lastFrame() ?? ''
    const confirm = findMarker(initial, '[Yes]')
    await moveAt(stdin, confirm.x, confirm.y)
    const hovered = lastFrame() ?? ''
    expect(hovered).not.toBe(initial)
    expect(stripAnsi(hovered)).toBe(stripAnsi(initial))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()

    await moveAt(stdin, 50, 50)
    expect(lastFrame()).toBe(initial)

    await clickAt(stdin, confirm.x, confirm.y)
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })
})
