import { describe, it, expect, vi } from 'vitest'
import { render } from 'ink-testing-library'
import { Box, Text, type DOMElement } from 'ink'
import type { ReactElement } from 'react'
import stripAnsi from 'strip-ansi'
import { FrameworkProvider } from '../FrameworkProvider.js'
import { ScreenRegistry } from '../screens/registry.js'
import { Button } from '../components/Button.js'
import { MouseLayout } from './MouseLayout.js'
import { MouseArea } from './MouseArea.js'
import type { MouseAreaRegistration } from './MouseProvider.js'
import {
  commitAutoMouseAreaUpdate,
  prepareAutoMouseAreaUpdate,
  resolveAutoMouseBounds,
  useAutoMouseArea,
} from './useAutoMouseArea.js'

const appRegistry = new ScreenRegistry()
appRegistry.register({
  id: 'test',
  title: 'Test',
  component: () => null,
})

function renderApp(ui: ReactElement) {
  return render(wrapApp(ui))
}

/** Wrap a tree in the framework providers for `rerender` calls. */
function wrapApp(ui: ReactElement) {
  return (
    <FrameworkProvider registry={appRegistry} defaultScreen="test">
      {ui}
    </FrameworkProvider>
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

/** Minimal direct consumer of `useAutoMouseArea` for hook-level coverage. */
function AutoMouseProbe({ onClick }: { onClick: () => void }) {
  const ref = useAutoMouseArea({ onClick })
  return (
    <Box ref={ref} flexShrink={0}>
      <Text>[Probe]</Text>
    </Box>
  )
}

describe('mixed explicit and automatic mouse areas', () => {
  // Deliberately the first mounted tree in this file: with the old independent
  // per-module counters both areas would allocate id 0 here, collide in the
  // provider's id-keyed registry, and one target would silently replace the
  // other. Keeping this first pins the collision starting state.
  it('keeps both targets registered on unique ids when either unmounts', async () => {
    const onExplicit = vi.fn()
    const onAuto = vi.fn()
    const explicitBounds = { x: 0, y: 0, width: 20, height: 1 }

    // Both registration paths draw ids from one allocator; independent
    // counters would collide in the provider's id-keyed registry and one
    // target would silently replace the other.
    const both = (
      <MouseLayout origin={{ x: 0, y: 0 }} flexDirection="column">
        <MouseArea bounds={explicitBounds} onClick={onExplicit}>
          <Text>[Explicit]</Text>
        </MouseArea>
        <Button onActivate={onAuto}>Auto</Button>
      </MouseLayout>
    )
    const autoOnly = (
      <MouseLayout origin={{ x: 0, y: 0 }} flexDirection="column">
        <Button onActivate={onAuto}>Auto</Button>
      </MouseLayout>
    )
    const explicitOnly = (
      <MouseLayout origin={{ x: 0, y: 0 }} flexDirection="column">
        <MouseArea bounds={explicitBounds} onClick={onExplicit}>
          <Text>[Explicit]</Text>
        </MouseArea>
      </MouseLayout>
    )

    const { rerender, stdin, lastFrame } = renderApp(both)
    await delay()

    const explicitCell = findMarker(lastFrame() ?? '', '[Explicit]')
    await clickAtCell(stdin, explicitCell.x, explicitCell.y)
    expect(onExplicit).toHaveBeenCalledTimes(1)

    const autoCell = findMarker(lastFrame() ?? '', '[Auto]')
    await clickAtCell(stdin, autoCell.x + 1, autoCell.y)
    expect(onAuto).toHaveBeenCalledTimes(1)

    // Unmounting the explicit area must not unregister the automatic one.
    rerender(wrapApp(autoOnly))
    await delay()
    const autoMoved = findMarker(lastFrame() ?? '', '[Auto]')
    await clickAtCell(stdin, autoMoved.x + 1, autoMoved.y)
    expect(onAuto).toHaveBeenCalledTimes(2)
    expect(onExplicit).toHaveBeenCalledTimes(1)

    // And unmounting the automatic area must not unregister the explicit one.
    rerender(wrapApp(explicitOnly))
    await delay()
    const explicitAgain = findMarker(lastFrame() ?? '', '[Explicit]')
    await clickAtCell(stdin, explicitAgain.x, explicitAgain.y)
    expect(onExplicit).toHaveBeenCalledTimes(2)
  })
})

describe('resolveAutoMouseBounds', () => {
  const clip = { x: 0, y: 0, width: 10, height: 10 }
  const measured = {
    left: 2,
    top: 1,
    width: 3,
    height: 1,
    hasMeasured: true,
  }

  it('requires an anchored measured origin and a measured target', () => {
    expect(resolveAutoMouseBounds(null, measured)).toBeNull()
    expect(
      resolveAutoMouseBounds({ origin: null, clip: null }, measured),
    ).toBeNull()
    expect(
      resolveAutoMouseBounds({ origin: null, clip }, measured),
    ).toBeNull()
    expect(
      resolveAutoMouseBounds({ origin: { x: 0, y: 0 }, clip: null }, measured),
    ).toBeNull()
    expect(
      resolveAutoMouseBounds(
        { origin: { x: 0, y: 0 }, clip },
        { ...measured, hasMeasured: false },
      ),
    ).toBeNull()
    expect(
      resolveAutoMouseBounds({ origin: { x: 0, y: 0 }, clip }, measured),
    ).toEqual({ x: 2, y: 1, width: 3, height: 1 })
  })

  it('clamps partially clipped targets and drops fully clipped ones', () => {
    const rootClip = { x: 0, y: 0, width: 4, height: 1 }
    expect(
      resolveAutoMouseBounds(
        { origin: { x: 0, y: 0 }, clip: rootClip },
        { left: 0, top: 0, width: 10, height: 2, hasMeasured: true },
      ),
    ).toEqual({ x: 0, y: 0, width: 4, height: 1 })
    expect(
      resolveAutoMouseBounds(
        { origin: { x: 0, y: 0 }, clip: rootClip },
        { left: 6, top: 0, width: 3, height: 1, hasMeasured: true },
      ),
    ).toBeNull()
  })
})

describe('auto mouse area commit contract', () => {
  it('prepares render values without touching the registered record', () => {
    const committedClick = vi.fn()
    const nextClick = vi.fn()

    // The exact object the provider registry retains while it is registered.
    const record: MouseAreaRegistration = {
      id: 42,
      bounds: { x: 3, y: 4, width: 2, height: 1 },
      priority: 0,
      disabled: false,
      onClick: committedClick,
    }

    // Render-phase preparation for a moved, re-scoped and disabled target.
    const update = prepareAutoMouseAreaUpdate(
      { origin: { x: 1, y: 2 }, clip: { x: 0, y: 0, width: 20, height: 10 } },
      { left: 5, top: 4, width: 2, height: 1, hasMeasured: true },
      { scope: 'modal', priority: 3, disabled: true, onClick: nextClick },
    )

    expect(update).toEqual({
      bounds: { x: 6, y: 6, width: 2, height: 1 },
      scope: 'modal',
      priority: 3,
      disabled: true,
      onClick: nextClick,
    })
    expect('id' in update).toBe(false)

    // Nothing registry-visible changed before the commit phase.
    expect(record.bounds).toEqual({ x: 3, y: 4, width: 2, height: 1 })
    expect(record.scope).toBeUndefined()
    expect(record.priority).toBe(0)
    expect(record.disabled).toBe(false)
    expect(record.onClick).toBe(committedClick)

    // The commit installs every prepared field at once; id stays stable.
    commitAutoMouseAreaUpdate(record, update)
    expect(record.id).toBe(42)
    expect(record.bounds).toEqual({ x: 6, y: 6, width: 2, height: 1 })
    expect(record.scope).toBe('modal')
    expect(record.priority).toBe(3)
    expect(record.disabled).toBe(true)
    expect(record.onClick).toBe(nextClick)
  })

  it('prepares inert bounds while the anchored chain has not measured', () => {
    const record: MouseAreaRegistration = {
      id: 7,
      bounds: { x: 1, y: 1, width: 4, height: 1 },
      priority: 0,
      disabled: false,
    }

    const update = prepareAutoMouseAreaUpdate(
      { origin: null, clip: null },
      { left: 0, top: 0, width: 0, height: 0, hasMeasured: false },
      {},
    )

    // The committed values stay in place until the commit runs...
    expect(record.bounds).toEqual({ x: 1, y: 1, width: 4, height: 1 })
    expect(update.bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 })
    expect(update.disabled).toBe(false)

    // ...and the commit makes the record inert instead of leaving stale hits.
    commitAutoMouseAreaUpdate(record, update)
    expect(record.bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })
})

describe('useAutoMouseArea', () => {
  it('moves the committed hit region after a layout change', async () => {
    const onClick = vi.fn()
    const { rerender, stdin, lastFrame } = renderApp(
      <MouseLayout origin={{ x: 0, y: 0 }} paddingLeft={0}>
        <AutoMouseProbe onClick={onClick} />
      </MouseLayout>,
    )

    await delay()
    const before = findMarker(lastFrame() ?? '', '[Probe]')
    await clickAtCell(stdin, before.x, before.y)
    expect(onClick).toHaveBeenCalledTimes(1)

    rerender(
      wrapApp(
        <MouseLayout origin={{ x: 0, y: 0 }} paddingLeft={6}>
          <AutoMouseProbe onClick={onClick} />
        </MouseLayout>,
      ),
    )
    await delay()

    // The previous committed region is gone; only the new one hits.
    await clickAtCell(stdin, before.x, before.y)
    expect(onClick).toHaveBeenCalledTimes(1)

    const after = findMarker(lastFrame() ?? '', '[Probe]')
    expect(after.x).toBe(before.x + 6)
    await clickAtCell(stdin, after.x, after.y)
    expect(onClick).toHaveBeenCalledTimes(2)
  })
})

describe('MouseLayout', () => {
  it('renders exactly one Ink Box, preserves layout props and forwards the consumer ref', async () => {
    const consumerRef: { current: DOMElement | null } = { current: null }
    let outerNode: DOMElement | null = null

    const layout = renderApp(
      <Box ref={(node) => { outerNode = node }} width={24}>
        <MouseLayout
          ref={consumerRef}
          origin={{ x: 0, y: 0 }}
          borderStyle="single"
          paddingX={2}
          paddingY={1}
          flexDirection="column"
          gap={1}
          width={18}
        >
          <Text>inside</Text>
        </MouseLayout>
      </Box>,
    )
    const plain = renderApp(
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

  it('composes nested offsets with real flex, padding and gap layout from a root origin', async () => {
    const onOuter = vi.fn()
    const onNested = vi.fn()
    const { stdin, lastFrame } = renderApp(
      <MouseLayout
        origin={{ x: 2, y: 1 }}
        paddingLeft={3}
        paddingTop={1}
        flexDirection="column"
        rowGap={1}
      >
        <Text>header</Text>
        <MouseLayout paddingLeft={2} columnGap={2} flexDirection="row">
          <Text>lead</Text>
          <Button onActivate={onOuter}>Outer</Button>
          <Button onActivate={onNested}>Nested</Button>
        </MouseLayout>
      </MouseLayout>,
    )

    await delay()
    const frame = lastFrame() ?? ''
    const outer = findMarker(frame, '[Outer]')
    const nested = findMarker(frame, '[Nested]')

    // The rendered frame is rooted at (0, 0); the asserted origin shifts every
    // composed absolute coordinate.
    await clickAtCell(stdin, outer.x + 2, outer.y + 1)
    expect(onOuter).toHaveBeenCalledTimes(1)

    await clickAtCell(stdin, nested.x + 2, nested.y + 1)
    expect(onNested).toHaveBeenCalledTimes(1)
  })

  it('clips automatic targets to the measured root rectangle', async () => {
    const onNarrow = vi.fn()
    const onWide = vi.fn()

    // A sibling spacer pushes the nested layout's measured box beyond the
    // narrow root's measured width; the same tree inside a wide root is
    // reachable, and the nested adapter must keep the root-owned clip.
    const narrow = renderApp(
      <MouseLayout origin={{ x: 0, y: 0 }} width={4} flexDirection="row">
        <Box width={6} flexShrink={0} />
        <MouseLayout flexShrink={0}>
          <Button onActivate={onNarrow}>Go</Button>
        </MouseLayout>
      </MouseLayout>,
    )
    const wide = renderApp(
      <MouseLayout origin={{ x: 0, y: 0 }} width={20} flexDirection="row">
        <Box width={6} flexShrink={0} />
        <MouseLayout flexShrink={0}>
          <Button onActivate={onWide}>Go</Button>
        </MouseLayout>
      </MouseLayout>,
    )

    await delay()
    const narrowCell = findMarker(narrow.lastFrame() ?? '', '[Go]')
    const wideCell = findMarker(wide.lastFrame() ?? '', '[Go]')
    expect(narrowCell).toEqual(wideCell)
    expect(narrowCell.x).toBe(6)

    // The cell is inside the button's rendered text in both trees, but
    // outside the narrow root's measured rectangle: fully clipped, inert.
    await clickAtCell(narrow.stdin, narrowCell.x + 1, narrowCell.y)
    expect(onNarrow).not.toHaveBeenCalled()

    // Control: the same absolute cell is hittable when the root covers it.
    await clickAtCell(wide.stdin, wideCell.x + 1, wideCell.y)
    expect(onWide).toHaveBeenCalledTimes(1)
  })

  it('updates bounds after a layout move and never activates from a stale press', async () => {
    const onAlpha = vi.fn()
    const onBeta = vi.fn()

    const initial = (
      <MouseLayout origin={{ x: 0, y: 0 }} flexDirection="column">
        <Button key="alpha" onActivate={onAlpha}>
          Alpha
        </Button>
        <Button key="beta" onActivate={onBeta}>
          Beta
        </Button>
      </MouseLayout>
    )
    const reordered = (
      <MouseLayout origin={{ x: 0, y: 0 }} flexDirection="column">
        <Button key="beta" onActivate={onBeta}>
          Beta
        </Button>
        <Button key="alpha" onActivate={onAlpha}>
          Alpha
        </Button>
      </MouseLayout>
    )

    const { rerender, stdin, lastFrame } = renderApp(initial)
    await delay()

    const alphaCell = findMarker(lastFrame() ?? '', '[Alpha]')
    const betaBelow = findMarker(lastFrame() ?? '', '[Beta]')
    expect(betaBelow.y).toBe(alphaCell.y + 1)

    // Press Alpha, then commit the reorder before releasing on the same cell.
    await pressAtCell(stdin, alphaCell.x, alphaCell.y)
    rerender(wrapApp(reordered))
    await delay()
    await releaseAtCell(stdin, alphaCell.x, alphaCell.y)

    // The cell now belongs to Beta, whose id differs from the pending press:
    // neither button may activate.
    expect(onBeta).not.toHaveBeenCalled()
    expect(onAlpha).not.toHaveBeenCalled()

    // Current coordinates work again after the commit.
    const betaNow = findMarker(lastFrame() ?? '', '[Beta]')
    expect(betaNow.y).toBe(alphaCell.y)
    await clickAtCell(stdin, betaNow.x, betaNow.y)
    expect(onBeta).toHaveBeenCalledTimes(1)

    const alphaNow = findMarker(lastFrame() ?? '', '[Alpha]')
    expect(alphaNow.y).toBe(alphaCell.y + 1)
    await clickAtCell(stdin, alphaNow.x, alphaNow.y)
    expect(onAlpha).toHaveBeenCalledTimes(1)
  })

  it('tracks resize-style padding changes so previous cells stop working', async () => {
    const onActivate = vi.fn()
    const { rerender, stdin, lastFrame } = renderApp(
      <MouseLayout origin={{ x: 0, y: 0 }} paddingLeft={0}>
        <Button onActivate={onActivate}>Go</Button>
      </MouseLayout>,
    )

    await delay()
    const before = findMarker(lastFrame() ?? '', '[Go]')
    await clickAtCell(stdin, before.x, before.y)
    expect(onActivate).toHaveBeenCalledTimes(1)

    rerender(
      wrapApp(
        <MouseLayout origin={{ x: 0, y: 0 }} paddingLeft={6}>
          <Button onActivate={onActivate}>Go</Button>
        </MouseLayout>,
      ),
    )
    await delay()

    await clickAtCell(stdin, before.x, before.y)
    expect(onActivate).toHaveBeenCalledTimes(1)

    const after = findMarker(lastFrame() ?? '', '[Go]')
    expect(after.x).toBe(before.x + 6)
    await clickAtCell(stdin, after.x, after.y)
    expect(onActivate).toHaveBeenCalledTimes(2)
  })

  it('stays inert without an explicit root origin but keeps keyboard activation', async () => {
    const onActivate = vi.fn()
    const { stdin, lastFrame } = renderApp(
      <MouseLayout flexDirection="column">
        <Button focused onActivate={onActivate}>
          NoOrigin
        </Button>
      </MouseLayout>,
    )

    await delay()
    const cell = findMarker(lastFrame() ?? '', '[NoOrigin]')
    await clickAtCell(stdin, cell.x, cell.y)
    expect(onActivate).not.toHaveBeenCalled()

    stdin.write('\r')
    await delay()
    expect(onActivate).toHaveBeenCalledTimes(1)
  })

  it('stays inert beneath an unanchored nested MouseLayout', async () => {
    const onActivate = vi.fn()
    const { stdin, lastFrame } = renderApp(
      <MouseLayout flexDirection="column">
        <MouseLayout paddingLeft={2}>
          <Button onActivate={onActivate}>Nested</Button>
        </MouseLayout>
      </MouseLayout>,
    )

    await delay()
    const cell = findMarker(lastFrame() ?? '', '[Nested]')
    await clickAtCell(stdin, cell.x, cell.y)
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('keeps a subtree inert when a supplied nested origin is invalid', async () => {
    const onFractional = vi.fn()
    const onNonFinite = vi.fn()
    const onSibling = vi.fn()

    // A valid anchored parent must not be inherited by descendants whose own
    // origin was explicitly supplied but failed validation (fractional or
    // non-finite here): the bad anchor poisons that subtree instead of
    // silently degrading into nested composition.
    const { stdin, lastFrame } = renderApp(
      <MouseLayout origin={{ x: 0, y: 0 }} flexDirection="column">
        <MouseLayout origin={{ x: 0.5, y: 0 }}>
          <Button onActivate={onFractional}>Fractional</Button>
        </MouseLayout>
        <MouseLayout origin={{ x: 0, y: Number.POSITIVE_INFINITY }}>
          <Button onActivate={onNonFinite}>NonFinite</Button>
        </MouseLayout>
        <Button onActivate={onSibling}>Sibling</Button>
      </MouseLayout>,
    )

    await delay()
    const frame = lastFrame() ?? ''
    const fractional = findMarker(frame, '[Fractional]')
    const nonFinite = findMarker(frame, '[NonFinite]')
    const sibling = findMarker(frame, '[Sibling]')

    await clickAtCell(stdin, fractional.x, fractional.y)
    await clickAtCell(stdin, nonFinite.x, nonFinite.y)
    expect(onFractional).not.toHaveBeenCalled()
    expect(onNonFinite).not.toHaveBeenCalled()

    // The valid sibling target still resolves through the anchored parent.
    await clickAtCell(stdin, sibling.x, sibling.y)
    expect(onSibling).toHaveBeenCalledTimes(1)
  })
})
