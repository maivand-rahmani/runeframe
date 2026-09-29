import { describe, it, expect, vi } from 'vitest'
import { render } from 'ink-testing-library'
import { Box, Text, type DOMElement } from 'ink'
import type { ReactNode } from 'react'
import stripAnsi from 'strip-ansi'
import { Button } from '../../components/primitives/Button.js'
import { ThemeProvider } from '../../design-system/ThemeProvider.js'
import { NavigationProvider, useNavigation } from '../../navigation/NavigationProvider.js'
import { ScreenRegistry } from '../../screens/registry.js'
import {
  KeyboardScopeProvider,
  useKeyboardScope,
} from '../keyboard/KeyboardScopeProvider.js'
import { MouseArea } from './MouseArea.js'
import { MouseLayout } from './MouseLayout.js'
import type { MouseGeometryValue } from './MouseGeometryContext.js'
import {
  MouseProvider,
  type MouseWheelDirection,
} from './MouseProvider.js'
import {
  MouseScrollLayout,
  resolveMouseScrollViewport,
} from './MouseScrollLayout.js'
import { useKeyHandler } from '../keyboard/useKeyHandler.js'

const appRegistry = new ScreenRegistry()
appRegistry.register({
  id: 'home',
  title: 'Home',
  component: () => null,
  sidebar: true,
  category: 'main',
})
appRegistry.register({
  id: 'modal-screen',
  title: 'Modal',
  component: () => null,
  sidebar: false,
  category: 'system',
})

function harness(children: ReactNode) {
  return (
    <ThemeProvider>
      <KeyboardScopeProvider>
        <NavigationProvider registry={appRegistry} defaultScreen="home">
          <MouseProvider>{children}</MouseProvider>
        </NavigationProvider>
      </KeyboardScopeProvider>
    </ThemeProvider>
  )
}

function delay(ms = 50) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface WritableStdin {
  write: (data: string) => void
}

/** Locate a rendered marker and return its zero-based terminal cell. */
function findMarker(frame: string, marker: string): { x: number; y: number } {
  const lines = stripAnsi(frame).split('\n')
  for (let y = 0; y < lines.length; y++) {
    const x = lines[y]!.indexOf(marker)
    if (x !== -1) return { x, y }
  }
  throw new Error(`Marker not found in frame: ${marker}`)
}

const WHEEL_UP = 64
const WHEEL_DOWN = 65

async function wheelAtCell(
  stdin: WritableStdin,
  x: number,
  y: number,
  button = WHEEL_UP,
) {
  stdin.write(`\u001B[<${button};${x + 1};${y + 1}M`)
  await delay()
}

async function pressAtCell(stdin: WritableStdin, x: number, y: number) {
  stdin.write(`\u001B[<0;${x + 1};${y + 1}M`)
  await delay()
}

async function releaseAtCell(stdin: WritableStdin, x: number, y: number) {
  stdin.write(`\u001B[<0;${x + 1};${y + 1}m`)
  await delay()
}

async function clickAtCell(stdin: WritableStdin, x: number, y: number) {
  await pressAtCell(stdin, x, y)
  await releaseAtCell(stdin, x, y)
}

// ── Pure viewport resolution ────────────────────────────────────────────

describe('resolveMouseScrollViewport', () => {
  const parent: MouseGeometryValue = {
    origin: { x: 10, y: 4 },
    clip: { x: 0, y: 0, width: 40, height: 12 },
    scrollAncestors: [7],
  }
  const measured = {
    left: 2,
    top: 1,
    width: 8,
    height: 3,
    hasMeasured: true,
  }

  it('composes absolute bounds, clip and explicit ancestry', () => {
    const viewport = resolveMouseScrollViewport(parent, measured, 9)
    expect(viewport.bounds).toEqual({ x: 12, y: 5, width: 8, height: 3 })
    expect(viewport.geometry).toEqual({
      origin: { x: 12, y: 5 },
      clip: { x: 12, y: 5, width: 8, height: 3 },
      scrollAncestors: [7, 9],
    })
    // The explicit nearest enclosing id, never inferred from order.
    expect(viewport.wheelParentId).toBe(7)
  })

  it('stays inert without an anchored measured parent chain', () => {
    const unanchored: Array<MouseGeometryValue | null> = [
      null,
      {
        origin: null,
        clip: { x: 0, y: 0, width: 10, height: 10 },
        scrollAncestors: [],
      },
      { origin: { x: 0, y: 0 }, clip: null, scrollAncestors: [] },
    ]
    for (const geometry of unanchored) {
      const viewport = resolveMouseScrollViewport(geometry, measured, 3)
      expect(viewport.bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 })
      expect(viewport.geometry.origin).toBeNull()
      expect(viewport.wheelParentId).toBeNull()
    }

    const unmeasured = resolveMouseScrollViewport(
      parent,
      { ...measured, hasMeasured: false },
      9,
    )
    expect(unmeasured.bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 })
    expect(unmeasured.geometry.origin).toBeNull()
  })

  it('starts a new ancestry root outside any enclosing scroll region', () => {
    const viewport = resolveMouseScrollViewport(
      {
        origin: { x: 0, y: 0 },
        clip: { x: 0, y: 0, width: 10, height: 10 },
        scrollAncestors: [],
      },
      measured,
      4,
    )
    expect(viewport.wheelParentId).toBeNull()
    expect(viewport.geometry.scrollAncestors).toEqual([4])
  })

  it('clips partially visible viewports and refuses fully clipped ones', () => {
    const enclosing: MouseGeometryValue = {
      origin: { x: 0, y: 0 },
      clip: { x: 0, y: 0, width: 5, height: 2 },
      scrollAncestors: [],
    }

    const partial = resolveMouseScrollViewport(
      enclosing,
      { left: 3, top: 1, width: 6, height: 4, hasMeasured: true },
      1,
    )
    expect(partial.bounds).toEqual({ x: 3, y: 1, width: 2, height: 1 })
    expect(partial.geometry.clip).toEqual({ x: 3, y: 1, width: 2, height: 1 })

    const hidden = resolveMouseScrollViewport(
      enclosing,
      { left: 9, top: 0, width: 2, height: 1, hasMeasured: true },
      1,
    )
    expect(hidden.bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 })
    expect(hidden.geometry.clip).toBeNull()
  })

  it('rounds fractional layout values onto the terminal cell grid', () => {
    const viewport = resolveMouseScrollViewport(
      {
        origin: { x: 1, y: 1 },
        clip: { x: 0, y: 0, width: 20, height: 10 },
        scrollAncestors: [],
      },
      { left: 1.4, top: 2.6, width: 3.2, height: 1.6, hasMeasured: true },
      1,
    )
    expect(viewport.bounds).toEqual({ x: 2, y: 4, width: 3, height: 2 })
  })
})

// ── Layout parity ───────────────────────────────────────────────────────

describe('MouseScrollLayout layout parity', () => {
  it('renders exactly one Ink Box, preserves props and forwards the consumer ref', async () => {
    const consumerRef: { current: DOMElement | null } = { current: null }
    let outerNode: DOMElement | null = null

    const layout = render(
      harness(
        <Box
          ref={(node) => {
            outerNode = node
          }}
          width={24}
        >
          <MouseScrollLayout
            ref={consumerRef}
            onWheel={() => true}
            borderStyle="single"
            paddingX={2}
            paddingY={1}
            flexDirection="column"
            gap={1}
            width={18}
          >
            <Text>inside</Text>
          </MouseScrollLayout>
        </Box>,
      ),
    )
    const plain = render(
      harness(
        <Box width={24}>
          <Box
            borderStyle="single"
            paddingX={2}
            paddingY={1}
            flexDirection="column"
            gap={1}
            width={18}
          >
            <Text>inside</Text>
          </Box>
        </Box>,
      ),
    )

    await delay()

    // Layout parity: identical rendered output with and without the adapter.
    expect(layout.lastFrame()).toBe(plain.lastFrame())

    // Structure parity: the consumer ref points at the one Box the adapter
    // renders, directly under the consumer's own layout node.
    expect(consumerRef.current).not.toBeNull()
    expect(consumerRef.current?.nodeName).toBe('ink-box')
    expect(consumerRef.current?.parentNode).toBe(outerNode)
    expect(consumerRef.current?.childNodes).toHaveLength(1)
    expect(consumerRef.current?.childNodes[0]?.nodeName).toBe('ink-text')
  })
})

// ── Wheel protocol ──────────────────────────────────────────────────────

describe('MouseScrollLayout wheel routing', () => {
  it('routes wheel up/down presses immediately without a release, modifiers included', async () => {
    const directions: MouseWheelDirection[] = []
    const keyboard: string[] = []

    function KeyLog() {
      useKeyHandler((event) => {
        keyboard.push(event.rawInput)
      }, 'navigation')
      return null
    }

    const { stdin } = render(
      harness(
        <MouseLayout origin={{ x: 0, y: 0 }} flexDirection="column">
          <KeyLog />
          <MouseScrollLayout
            width={12}
            height={2}
            onWheel={(direction) => {
              directions.push(direction)
              return true
            }}
          >
            <Text>[Scroll]</Text>
          </MouseScrollLayout>
        </MouseLayout>,
      ),
    )
    await delay()

    // Bare up/down dispatch on the press report alone, with no release pair.
    await wheelAtCell(stdin, 1, 0, WHEEL_UP)
    await wheelAtCell(stdin, 1, 0, WHEEL_DOWN)
    await wheelAtCell(stdin, 1, 0, 68) // Shift + up
    await wheelAtCell(stdin, 1, 0, 93) // Shift + Meta + Ctrl + down
    expect(directions).toEqual(['up', 'down', 'up', 'down'])

    // A release-form wheel code is not a wheel event and adds nothing.
    stdin.write('\u001B[<64;2;1m')
    await delay()
    expect(directions).toHaveLength(4)

    // Unsupported valid codes (horizontal wheel, motion wheel) stay consumed.
    await wheelAtCell(stdin, 1, 0, 66)
    await wheelAtCell(stdin, 1, 0, 97)
    expect(directions).toHaveLength(4)

    // Routing still works after those reports.
    await wheelAtCell(stdin, 1, 0, WHEEL_UP)
    expect(directions).toEqual(['up', 'down', 'up', 'down', 'up'])

    // Every valid wheel report was consumed before the keyboard dispatcher.
    expect(keyboard).toEqual([])
  })

  it('consumes wheel reports that hit no viewport', async () => {
    const onWheel = vi.fn(() => true)
    const onClick = vi.fn()
    const { stdin } = render(
      harness(
        <MouseLayout origin={{ x: 0, y: 0 }} flexDirection="column">
          <MouseScrollLayout width={4} height={1} onWheel={onWheel}>
            <Text>[V]</Text>
          </MouseScrollLayout>
          <MouseArea
            bounds={{ x: 20, y: 20, width: 2, height: 2 }}
            onClick={onClick}
          />
        </MouseLayout>,
      ),
    )
    await delay()

    await wheelAtCell(stdin, 30, 10)
    expect(onWheel).not.toHaveBeenCalled()
    expect(onClick).not.toHaveBeenCalled()
  })

  it('gives the deepest eligible viewport the first chance and bubbles on false', async () => {
    const calls: string[] = []
    let innerMoves = false
    const inner = vi.fn(() => {
      calls.push('inner')
      return innerMoves
    })
    const outer = vi.fn(() => {
      calls.push('outer')
      return false
    })

    const { stdin, lastFrame } = render(
      harness(
        <MouseLayout origin={{ x: 0, y: 0 }} flexDirection="column">
          <MouseScrollLayout width={20} height={4} onWheel={outer}>
            <MouseScrollLayout width={10} height={2} onWheel={inner}>
              <Text>[Inner]</Text>
            </MouseScrollLayout>
            <Text>[OuterTail]</Text>
          </MouseScrollLayout>
        </MouseLayout>,
      ),
    )
    await delay()

    const frame = lastFrame() ?? ''
    const innerCell = findMarker(frame, '[Inner]')
    const tailCell = findMarker(frame, '[OuterTail]')

    // Child first, then the explicit parent when the child cannot move.
    await wheelAtCell(stdin, innerCell.x + 1, innerCell.y)
    expect(calls).toEqual(['inner', 'outer'])

    // A moved child stops routing: the parent is never asked.
    calls.length = 0
    innerMoves = true
    await wheelAtCell(stdin, innerCell.x + 1, innerCell.y)
    expect(calls).toEqual(['inner'])

    // A cell only inside the parent goes straight to the parent.
    calls.length = 0
    await wheelAtCell(stdin, tailCell.x + 1, tailCell.y)
    expect(calls).toEqual(['outer'])
  })

  it('never infers nested depth from registration order', async () => {
    // React runs child layout effects before parent ones, so the inner
    // viewport registers first and the outer viewport has the newer
    // registration order. Depth must still come from the explicit ancestry:
    // the inner viewport wins regardless of order.
    const calls: string[] = []
    const inner = vi.fn(() => {
      calls.push('inner')
      return true
    })
    const outer = vi.fn(() => {
      calls.push('outer')
      return true
    })

    const { stdin, lastFrame } = render(
      harness(
        <MouseLayout origin={{ x: 0, y: 0 }} flexDirection="column">
          <MouseScrollLayout width={20} height={4} onWheel={outer}>
            <MouseScrollLayout width={10} height={2} onWheel={inner}>
              <Text>[Inner]</Text>
            </MouseScrollLayout>
          </MouseScrollLayout>
        </MouseLayout>,
      ),
    )
    await delay()

    const cell = findMarker(lastFrame() ?? '', '[Inner]')
    await wheelAtCell(stdin, cell.x, cell.y)
    expect(calls).toEqual(['inner'])
    expect(outer).not.toHaveBeenCalled()
  })

  it('consumes at the outer boundary without reaching siblings or clicks', async () => {
    const boundary = vi.fn(() => false)
    const sibling = vi.fn(() => true)
    const onClick = vi.fn()

    const { stdin, lastFrame } = render(
      harness(
        <MouseLayout origin={{ x: 0, y: 0 }} flexDirection="column">
          <MouseScrollLayout width={10} height={2} onWheel={boundary}>
            <Text>[Boundary]</Text>
          </MouseScrollLayout>
          <MouseScrollLayout width={10} height={2} onWheel={sibling}>
            <Text>[Sibling]</Text>
          </MouseScrollLayout>
          <MouseArea
            bounds={{ x: 0, y: 0, width: 4, height: 2 }}
            onClick={onClick}
          />
        </MouseLayout>,
      ),
    )
    await delay()

    const frame = lastFrame() ?? ''
    const boundaryCell = findMarker(frame, '[Boundary]')
    const siblingCell = findMarker(frame, '[Sibling]')

    await wheelAtCell(stdin, boundaryCell.x, boundaryCell.y)
    expect(boundary).toHaveBeenCalledTimes(1)
    expect(sibling).not.toHaveBeenCalled()
    expect(onClick).not.toHaveBeenCalled()

    await wheelAtCell(stdin, siblingCell.x, siblingCell.y)
    expect(sibling).toHaveBeenCalledTimes(1)
    expect(boundary).toHaveBeenCalledTimes(1)

    // The consumed wheel left no residue: clicks still work.
    await clickAtCell(stdin, boundaryCell.x, boundaryCell.y)
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

// ── Scope and modal eligibility ─────────────────────────────────────────

describe('MouseScrollLayout eligibility', () => {
  it('gates viewports on the active scope and falls back to an eligible parent', async () => {
    const scoped = vi.fn(() => true)
    const background = vi.fn(() => true)
    let keyboard: ReturnType<typeof useKeyboardScope> | null = null

    function Capture() {
      keyboard = useKeyboardScope()
      return null
    }

    const { stdin, lastFrame } = render(
      harness(
        <MouseLayout origin={{ x: 0, y: 0 }} flexDirection="column">
          <MouseScrollLayout width={12} height={3} onWheel={background}>
            <MouseScrollLayout
              scope="list"
              width={10}
              height={2}
              onWheel={scoped}
            >
              <Text>[Scoped]</Text>
            </MouseScrollLayout>
          </MouseScrollLayout>
          <Capture />
        </MouseLayout>,
      ),
    )
    await delay()

    const cell = findMarker(lastFrame() ?? '', '[Scoped]')

    // `list` inactive: the explicit-scope viewport is dormant, the eligible
    // enclosing viewport receives the wheel.
    await wheelAtCell(stdin, cell.x, cell.y)
    expect(scoped).not.toHaveBeenCalled()
    expect(background).toHaveBeenCalledTimes(1)

    keyboard!.pushScope('list')
    await delay()
    await wheelAtCell(stdin, cell.x, cell.y)
    expect(scoped).toHaveBeenCalledTimes(1)
    expect(background).toHaveBeenCalledTimes(1)

    keyboard!.popScope('list')
    await delay()
    await wheelAtCell(stdin, cell.x, cell.y)
    expect(scoped).toHaveBeenCalledTimes(1)
    expect(background).toHaveBeenCalledTimes(2)
  })

  it('blocks background viewports while a modal is open and never escapes to them', async () => {
    const background = vi.fn(() => true)
    const modalScoped = vi.fn(() => false)
    let navigation: ReturnType<typeof useNavigation> | null = null

    function Capture() {
      navigation = useNavigation()
      return null
    }

    const { stdin, lastFrame } = render(
      harness(
        <MouseLayout origin={{ x: 0, y: 0 }} flexDirection="column">
          <MouseScrollLayout width={12} height={3} onWheel={background}>
            <MouseScrollLayout
              scope="modal"
              width={10}
              height={2}
              onWheel={modalScoped}
            >
              <Text>[Overlay]</Text>
            </MouseScrollLayout>
          </MouseScrollLayout>
          <Capture />
        </MouseLayout>,
      ),
    )
    await delay()

    const cell = findMarker(lastFrame() ?? '', '[Overlay]')

    // No modal: the modal-scope viewport is dormant, background handles it.
    await wheelAtCell(stdin, cell.x, cell.y)
    expect(background).toHaveBeenCalledTimes(1)
    expect(modalScoped).not.toHaveBeenCalled()

    navigation!.pushModal('modal-screen')
    await delay()

    // Modal open: the background region is ineligible even though it contains
    // the pointer; only the modal viewport may move.
    await wheelAtCell(stdin, cell.x, cell.y)
    expect(background).toHaveBeenCalledTimes(1)
    expect(modalScoped).toHaveBeenCalledTimes(1)

    // The modal viewport could not move and its explicit background parent is
    // ineligible, so the wheel is consumed instead of escaping the modal.
    expect(background).toHaveBeenCalledTimes(1)

    navigation!.popModal()
    await delay()
    await wheelAtCell(stdin, cell.x, cell.y)
    expect(background).toHaveBeenCalledTimes(2)
  })

  it('lets a viewport registered while a modal is open join the modal layer', async () => {
    const background = vi.fn(() => true)
    const modalContent = vi.fn(() => false)
    let navigation: ReturnType<typeof useNavigation> | null = null

    function Capture() {
      navigation = useNavigation()
      return null
    }

    function ModalLayerViewport() {
      const { isModalOpen } = useNavigation()
      if (!isModalOpen) return null
      return (
        <MouseScrollLayout width={8} height={1} onWheel={modalContent}>
          <Text>[Layer]</Text>
        </MouseScrollLayout>
      )
    }

    const { stdin, lastFrame } = render(
      harness(
        <MouseLayout origin={{ x: 0, y: 0 }} flexDirection="column">
          <MouseScrollLayout
            width={12}
            height={3}
            flexDirection="column"
            onWheel={background}
          >
            <Text>[Back]</Text>
            <ModalLayerViewport />
          </MouseScrollLayout>
          <Capture />
        </MouseLayout>,
      ),
    )
    await delay()

    const backCell = findMarker(lastFrame() ?? '', '[Back]')
    await wheelAtCell(stdin, backCell.x, backCell.y)
    expect(background).toHaveBeenCalledTimes(1)
    expect(modalContent).not.toHaveBeenCalled()

    navigation!.pushModal('modal-screen')
    await delay()

    const layerCell = findMarker(lastFrame() ?? '', '[Layer]')
    await wheelAtCell(stdin, layerCell.x, layerCell.y)
    // The modal-layer viewport registers after the modal opened, so it is
    // eligible; its background parent is not, so bubbling stops there.
    expect(modalContent).toHaveBeenCalledTimes(1)
    expect(background).toHaveBeenCalledTimes(1)
  })
})

// ── Clicks vs wheel-only records ────────────────────────────────────────

describe('wheel-only registrations and clicks', () => {
  it('keeps a pending click intact through wheel reports and never invokes click', async () => {
    const onClick = vi.fn()
    const onWheel = vi.fn(() => true)

    const { stdin } = render(
      harness(
        <MouseLayout origin={{ x: 0, y: 0 }} flexDirection="column">
          <MouseArea
            bounds={{ x: 0, y: 0, width: 4, height: 2 }}
            onClick={onClick}
          />
          <MouseScrollLayout width={10} height={2} onWheel={onWheel}>
            <Text>[Viewport]</Text>
          </MouseScrollLayout>
        </MouseLayout>,
      ),
    )
    await delay()

    // Press the click target, wheel over the overlapping viewport, release on
    // the same target: the pending press must survive untouched.
    await pressAtCell(stdin, 1, 0)
    await wheelAtCell(stdin, 1, 0, WHEEL_UP)
    await releaseAtCell(stdin, 1, 0)

    expect(onWheel).toHaveBeenCalledTimes(1)
    expect(onWheel).toHaveBeenCalledWith('up')
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onClick).toHaveBeenCalledWith({ x: 1, y: 0 })
  })

  it('never shadows an explicit click target registered before or after it', async () => {
    const onClick = vi.fn()
    const onWheel = vi.fn(() => true)

    // The wheel-only record is registered after the click area and overlaps
    // it exactly: click hit testing must still resolve the click area.
    const { stdin } = render(
      harness(
        <MouseLayout origin={{ x: 0, y: 0 }} flexDirection="column">
          <MouseArea
            bounds={{ x: 0, y: 0, width: 6, height: 2 }}
            onClick={onClick}
          />
          <MouseScrollLayout width={6} height={2} onWheel={onWheel}>
            <Text>[Viewport]</Text>
          </MouseScrollLayout>
        </MouseLayout>,
      ),
    )
    await delay()

    await clickAtCell(stdin, 2, 0)
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onWheel).not.toHaveBeenCalled()
  })

  it('keeps automatic targets hittable inside the viewport and clipped outside it', async () => {
    const onA = vi.fn()
    const onB = vi.fn()
    const onWheel = vi.fn(() => true)

    const { stdin, lastFrame } = render(
      harness(
        <MouseLayout origin={{ x: 0, y: 0 }} flexDirection="column">
          <MouseScrollLayout
            width={12}
            height={1}
            flexDirection="column"
            onWheel={onWheel}
          >
            <Button focused onActivate={onA}>
              A
            </Button>
            <Button onActivate={onB}>B</Button>
          </MouseScrollLayout>
        </MouseLayout>,
      ),
    )
    await delay()

    const aCell = findMarker(lastFrame() ?? '', '[A]')
    await clickAtCell(stdin, aCell.x + 1, aCell.y)
    expect(onA).toHaveBeenCalledTimes(1)

    // B sits at row 1, below the one-row viewport: its measured rectangle is
    // fully clipped, so the cell must not activate it (or anything else).
    await clickAtCell(stdin, 1, 1)
    expect(onB).not.toHaveBeenCalled()
    expect(onA).toHaveBeenCalledTimes(1)

    // The wheel region is clipped to the same visible viewport.
    await wheelAtCell(stdin, 1, 0)
    expect(onWheel).toHaveBeenCalledTimes(1)
    await wheelAtCell(stdin, 1, 1)
    expect(onWheel).toHaveBeenCalledTimes(1)
  })

  it('moves the committed viewport hit region after a layout change', async () => {
    const onActivate = vi.fn()
    const onWheel = vi.fn(() => true)

    const view = (paddingLeft: number) => (
      <MouseLayout
        origin={{ x: 0, y: 0 }}
        paddingLeft={paddingLeft}
        flexDirection="column"
      >
        <MouseScrollLayout width={8} height={1} onWheel={onWheel}>
          <Button focused onActivate={onActivate}>
            Go
          </Button>
        </MouseScrollLayout>
      </MouseLayout>
    )

    const { stdin, rerender, lastFrame } = render(harness(view(0)))
    await delay()

    const before = findMarker(lastFrame() ?? '', '[Go]')
    await clickAtCell(stdin, before.x + 1, before.y)
    expect(onActivate).toHaveBeenCalledTimes(1)
    await wheelAtCell(stdin, before.x + 1, before.y)
    expect(onWheel).toHaveBeenCalledTimes(1)

    rerender(harness(view(6)))
    await delay()

    // The old viewport cell is outside the moved clip: neither click nor
    // wheel reaches the button or the viewport any more.
    await clickAtCell(stdin, before.x + 1, before.y)
    await wheelAtCell(stdin, before.x + 1, before.y)
    expect(onActivate).toHaveBeenCalledTimes(1)
    expect(onWheel).toHaveBeenCalledTimes(1)

    const after = findMarker(lastFrame() ?? '', '[Go]')
    expect(after.x).toBe(before.x + 6)
    await clickAtCell(stdin, after.x + 1, after.y)
    await wheelAtCell(stdin, after.x + 1, after.y)
    expect(onActivate).toHaveBeenCalledTimes(2)
    expect(onWheel).toHaveBeenCalledTimes(2)
  })
})
