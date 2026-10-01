import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { render as inkRender, Text } from 'ink'
import { render } from 'ink-testing-library'
import {
  Activity,
  StrictMode,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react'
import type { ReactElement, ReactNode } from 'react'
import {
  KeyboardScopeProvider,
  useKeyboardScope,
} from '../keyboard/KeyboardScopeProvider.js'
import {
  DEFAULT_MOUSE_PREFIX_TIMEOUT_MS,
  MAX_DIAGNOSTIC_AREA_SNAPSHOTS,
  MOUSE_ENABLE_SEQUENCE,
  MOUSE_RESET_SEQUENCE,
  MouseProvider,
  useMouseRegistry,
  type MouseDiagnosticEvent,
  type MouseWheelDirection,
  type MouseWheelRegistration,
} from './MouseProvider.js'
import {
  MouseArea,
  type MouseAreaProps,
  type MouseBounds,
  type MouseClickEvent,
} from './MouseArea.js'
import { useKeyHandler } from '../keyboard/useKeyHandler.js'
import { FocusTreeProvider } from '../focus/FocusTreeProvider.js'
import { useInputFocus } from '../focus/useInputFocus.js'
import {
  NavigationProvider,
  useNavigation,
} from '../../navigation/NavigationProvider.js'
import { ScreenRegistry } from '../../screens/registry.js'
import type { FocusScope, NormalizedKeyEvent } from '../../types.js'
import type { MouseEventSource } from './MouseEventSource.js'
import type { NormalizedMouseEvent } from './SgrMouseStreamParser.js'

const registry = new ScreenRegistry()
registry.register({
  id: 'home',
  title: 'Home',
  component: () => null,
  sidebar: true,
  category: 'main',
})
registry.register({
  id: 'modal-screen',
  title: 'Modal',
  component: () => null,
  sidebar: false,
  category: 'system',
})

function delay(ms = 30) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function harness(
  children: ReactNode,
  prefixTimeoutMs?: number,
  diagnostics?: (event: MouseDiagnosticEvent) => void,
  mouseEventSource?: MouseEventSource,
) {
  return (
    <KeyboardScopeProvider>
      <NavigationProvider registry={registry} defaultScreen="home">
        <MouseProvider
          prefixTimeoutMs={prefixTimeoutMs}
          diagnostics={diagnostics}
          mouseEventSource={mouseEventSource}
        >
          {children}
        </MouseProvider>
      </NavigationProvider>
    </KeyboardScopeProvider>
  )
}

interface WritableStdin {
  write: (data: string) => void
}

async function press(stdin: WritableStdin, cx: number, cy: number) {
  stdin.write(`\u001B[<0;${cx};${cy}M`)
  await delay()
}

async function release(stdin: WritableStdin, cx: number, cy: number) {
  stdin.write(`\u001B[<0;${cx};${cy}m`)
  await delay()
}

async function click(stdin: WritableStdin, cx: number, cy: number) {
  await press(stdin, cx, cy)
  await release(stdin, cx, cy)
}

/** Post-Ink SGR motion report: `Cb` 32 = left held, 35 = no button. */
async function move(
  stdin: WritableStdin,
  button: 'left' | 'none',
  cx: number,
  cy: number,
) {
  stdin.write(`\u001B[<${button === 'left' ? 32 : 35};${cx};${cy}M`)
  await delay()
}

const BOUNDS = { x: 1, y: 0, width: 3, height: 2 }

describe('MouseArea', () => {
  it('renders children headlessly and is inert without a MouseProvider', () => {
    const { lastFrame } = render(
      <MouseArea bounds={BOUNDS} onClick={() => {}}>
        <Text>plain child</Text>
      </MouseArea>,
    )
    expect(lastFrame()).toContain('plain child')
  })
})

describe('MouseProvider hit testing', () => {
  it('converts SGR coordinates once and uses half-open bounds', async () => {
    const clicks: MouseClickEvent[] = []
    const { stdin } = render(
      harness(
        <MouseArea bounds={BOUNDS} onClick={(event) => clicks.push(event)} />,
      ),
    )

    await click(stdin, 2, 1) // (1, 0) — inclusive top-left cell
    expect(clicks).toEqual([{ x: 1, y: 0 }])

    await click(stdin, 3, 2) // (2, 1) — inclusive last cell
    expect(clicks).toEqual([
      { x: 1, y: 0 },
      { x: 2, y: 1 },
    ])

    await click(stdin, 1, 1) // x = 0 — left edge exclusive
    await click(stdin, 5, 1) // x = 4 — right edge (x + width) exclusive
    await click(stdin, 2, 3) // y = 2 — bottom edge exclusive
    expect(clicks).toHaveLength(2)
  })

  it('ignores empty rectangles', async () => {
    const onClick = vi.fn()
    const { stdin } = render(
      harness(
        <MouseArea
          bounds={{ x: 0, y: 0, width: 0, height: 3 }}
          onClick={onClick}
        />,
      ),
    )
    await click(stdin, 1, 1)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('uses the most recent bounds after a registration update', async () => {
    const clicks: MouseClickEvent[] = []
    let bounds = { x: 0, y: 0, width: 2, height: 2 }

    function Host() {
      return (
        <MouseArea bounds={bounds} onClick={(event) => clicks.push(event)} />
      )
    }

    const { stdin, rerender } = render(
      harness(<Host />),
    )

    await click(stdin, 1, 1)
    expect(clicks).toHaveLength(1)

    bounds = { x: 10, y: 10, width: 2, height: 2 }
    rerender(harness(<Host />))
    await delay()

    await click(stdin, 1, 1)
    expect(clicks).toHaveLength(1)

    await click(stdin, 11, 11)
    expect(clicks).toHaveLength(2)
    expect(clicks[1]).toEqual({ x: 10, y: 10 })
  })
})

describe('MouseProvider invalid bounds rejection', () => {
  /**
   * A large valid area underneath every invalid one. If an invalid rectangle
   * were allowed to hit-test, the half-open comparisons would make it win at
   * the listed point and this fallback would never fire.
   */
  const VALID_FALLBACK = { x: 0, y: 0, width: 8, height: 8 }

  const INVALID_CASES: Array<{
    label: string
    bounds: MouseBounds
    /** Cell that the lax comparisons would have matched before validation. */
    point: MouseClickEvent
  }> = [
    {
      label: 'NaN x',
      bounds: { x: Number.NaN, y: 0, width: 3, height: 3 },
      point: { x: 1, y: 1 },
    },
    {
      label: 'NaN y',
      bounds: { x: 0, y: Number.NaN, width: 3, height: 3 },
      point: { x: 1, y: 1 },
    },
    {
      label: 'NaN width',
      bounds: { x: 0, y: 0, width: Number.NaN, height: 3 },
      point: { x: 1, y: 1 },
    },
    {
      label: 'NaN height',
      bounds: { x: 0, y: 0, width: 3, height: Number.NaN },
      point: { x: 1, y: 1 },
    },
    {
      label: 'positive-infinite x',
      bounds: { x: Number.POSITIVE_INFINITY, y: 0, width: 3, height: 3 },
      point: { x: 1, y: 1 },
    },
    {
      label: 'negative-infinite x',
      bounds: { x: Number.NEGATIVE_INFINITY, y: 0, width: 3, height: 3 },
      point: { x: 1, y: 1 },
    },
    {
      label: 'positive-infinite y',
      bounds: { x: 0, y: Number.POSITIVE_INFINITY, width: 3, height: 3 },
      point: { x: 1, y: 1 },
    },
    {
      label: 'negative-infinite y',
      bounds: { x: 0, y: Number.NEGATIVE_INFINITY, width: 3, height: 3 },
      point: { x: 1, y: 1 },
    },
    {
      label: 'positive-infinite width',
      bounds: { x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 3 },
      point: { x: 1, y: 1 },
    },
    {
      label: 'negative-infinite width',
      bounds: { x: 0, y: 0, width: Number.NEGATIVE_INFINITY, height: 3 },
      point: { x: 1, y: 1 },
    },
    {
      label: 'positive-infinite height',
      bounds: { x: 0, y: 0, width: 3, height: Number.POSITIVE_INFINITY },
      point: { x: 1, y: 1 },
    },
    {
      label: 'negative-infinite height',
      bounds: { x: 0, y: 0, width: 3, height: Number.NEGATIVE_INFINITY },
      point: { x: 1, y: 1 },
    },
    {
      label: 'fractional x',
      bounds: { x: 0.5, y: 0, width: 3, height: 3 },
      point: { x: 1, y: 1 },
    },
    {
      label: 'fractional y',
      bounds: { x: 0, y: 0.5, width: 3, height: 3 },
      point: { x: 1, y: 1 },
    },
    {
      label: 'fractional width',
      bounds: { x: 0, y: 0, width: 2.5, height: 3 },
      point: { x: 2, y: 1 },
    },
    {
      label: 'fractional height',
      bounds: { x: 0, y: 0, width: 3, height: 2.5 },
      point: { x: 1, y: 2 },
    },
  ]

  it.each(INVALID_CASES)(
    'ignores $label so a valid lower-priority target receives the click',
    async ({ bounds, point }) => {
      const invalid = vi.fn()
      const fallback = vi.fn()
      const { stdin } = render(
        harness(
          <>
            <MouseArea bounds={bounds} priority={10} onClick={invalid} />
            <MouseArea bounds={VALID_FALLBACK} onClick={fallback} />
          </>,
        ),
      )

      await click(stdin, point.x + 1, point.y + 1)

      expect(invalid).not.toHaveBeenCalled()
      expect(fallback).toHaveBeenCalledTimes(1)
      expect(fallback).toHaveBeenCalledWith(point)
    },
  )
})

describe('MouseProvider press/release pairing', () => {
  const AREA_A = { x: 0, y: 0, width: 2, height: 2 }
  const AREA_B = { x: 10, y: 10, width: 2, height: 2 }

  it('fires only when press and release hit the same area', async () => {
    const a = vi.fn()
    const b = vi.fn()
    const { stdin } = render(
      harness(
        <>
          <MouseArea bounds={AREA_A} onClick={a} />
          <MouseArea bounds={AREA_B} onClick={b} />
        </>,
      ),
    )

    await click(stdin, 1, 1)
    expect(a).toHaveBeenCalledTimes(1)
    expect(a).toHaveBeenCalledWith({ x: 0, y: 0 })

    await click(stdin, 11, 11)
    expect(b).toHaveBeenCalledTimes(1)

    // press on A, release on B — no click for either
    await press(stdin, 1, 1)
    await release(stdin, 11, 11)
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)

    // press on A, release outside any area — no click
    await press(stdin, 1, 1)
    await release(stdin, 50, 50)
    expect(a).toHaveBeenCalledTimes(1)

    // release with no pending press — no click
    await release(stdin, 1, 1)
    expect(a).toHaveBeenCalledTimes(1)
  })

  it('cancels a pending press when the target unregisters', async () => {
    const onClick = vi.fn()
    let mounted = true

    function Host() {
      return mounted ? (
        <MouseArea bounds={AREA_A} onClick={onClick} />
      ) : null
    }

    const { stdin, rerender } = render(
      harness(<Host />),
    )

    await press(stdin, 1, 1)
    mounted = false
    rerender(harness(<Host />))
    await delay()

    await release(stdin, 1, 1)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('consumes wheel and other non-left reports without firing', async () => {
    const onClick = vi.fn()
    const { stdin } = render(
      harness(<MouseArea bounds={AREA_A} onClick={onClick} />),
    )

    stdin.write('\u001B[<64;1;1M') // wheel up
    await delay()
    stdin.write('\u001B[<64;1;1m')
    await delay()
    stdin.write('\u001B[<2;1;1M') // right press
    await delay()
    await release(stdin, 1, 1)
    expect(onClick).not.toHaveBeenCalled()

    await click(stdin, 1, 1)
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('MouseProvider precedence', () => {
  const FULL = { x: 0, y: 0, width: 5, height: 5 }

  it('gives overlapping areas to the highest priority', async () => {
    const low = vi.fn()
    const high = vi.fn()
    const { stdin } = render(
      harness(
        <>
          <MouseArea bounds={FULL} priority={0} onClick={low} />
          <MouseArea bounds={FULL} priority={7} onClick={high} />
        </>,
      ),
    )

    await click(stdin, 3, 3)
    expect(high).toHaveBeenCalledTimes(1)
    expect(low).not.toHaveBeenCalled()
  })

  it('breaks priority ties with the most recent registration', async () => {
    const first = vi.fn()
    const second = vi.fn()
    const { stdin } = render(
      harness(
        <>
          <MouseArea bounds={FULL} onClick={first} />
          <MouseArea bounds={FULL} onClick={second} />
        </>,
      ),
    )

    await click(stdin, 3, 3)
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
  })

  it('lets a disabled topmost target consume without activating or passing through', async () => {
    const background = vi.fn()
    const disabled = vi.fn()
    const { stdin } = render(
      harness(
        <>
          <MouseArea bounds={FULL} onClick={background} />
          <MouseArea bounds={FULL} disabled onClick={disabled} />
        </>,
      ),
    )

    await click(stdin, 3, 3)
    expect(background).not.toHaveBeenCalled()
    expect(disabled).not.toHaveBeenCalled()
  })
})

describe('MouseProvider scopes and modal routing', () => {
  const BACKGROUND = { x: 0, y: 0, width: 4, height: 4 }
  const MODAL = { x: 10, y: 10, width: 4, height: 4 }

  function renderScopedAreas() {
    const background = vi.fn()
    const modal = vi.fn()
    let keyboard: ReturnType<typeof useKeyboardScope> | null = null
    let navigation: ReturnType<typeof useNavigation> | null = null

    function Capture() {
      keyboard = useKeyboardScope()
      navigation = useNavigation()
      return null
    }

    const rendered = render(
      harness(
        <>
          <Capture />
          <MouseArea bounds={BACKGROUND} onClick={background} />
          <MouseArea bounds={MODAL} scope="modal" onClick={modal} />
        </>,
      ),
    )

    return {
      stdin: rendered.stdin,
      background,
      modal,
      keyboard: () => keyboard,
      navigation: () => navigation,
    }
  }

  it('gates explicit scopes on the active scope stack', async () => {
    const onClick = vi.fn()
    let keyboard: ReturnType<typeof useKeyboardScope> | null = null

    function Capture() {
      keyboard = useKeyboardScope()
      return null
    }

    const { stdin } = render(
      harness(
        <>
          <Capture />
          <MouseArea bounds={BACKGROUND} scope="list" onClick={onClick} />
        </>,
      ),
    )

    await click(stdin, 2, 2)
    expect(onClick).not.toHaveBeenCalled()

    keyboard!.pushScope('list')
    await delay()
    await click(stdin, 2, 2)
    expect(onClick).toHaveBeenCalledTimes(1)

    keyboard!.popScope('list')
    await delay()
    await click(stdin, 2, 2)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('routes only modal areas while a modal is open and consumes outside clicks', async () => {
    const { stdin, background, modal, navigation } = renderScopedAreas()

    await click(stdin, 2, 2)
    expect(background).toHaveBeenCalledTimes(1)

    navigation()!.pushModal('modal-screen')
    await delay()

    // Background area hit while modal is open: consumed, never activated.
    await click(stdin, 2, 2)
    expect(background).toHaveBeenCalledTimes(1)

    // Modal area still works.
    await click(stdin, 12, 12)
    expect(modal).toHaveBeenCalledTimes(1)

    // Click outside every area is consumed and cannot reach background.
    await click(stdin, 60, 60)
    expect(background).toHaveBeenCalledTimes(1)
    expect(modal).toHaveBeenCalledTimes(1)

    navigation()!.popModal()
    await delay()
    await click(stdin, 2, 2)
    expect(background).toHaveBeenCalledTimes(2)
  })

  it('keeps modal-scope areas ineligible while no modal is open', async () => {
    const { stdin, modal } = renderScopedAreas()
    await click(stdin, 12, 12)
    expect(modal).not.toHaveBeenCalled()
  })

  it('lets areas registered while a modal is open participate without an explicit scope', async () => {
    const background = vi.fn()
    const modalContent = vi.fn()
    let navigation: ReturnType<typeof useNavigation> | null = null

    function Capture() {
      navigation = useNavigation()
      return null
    }

    function ModalLayerArea() {
      const { isModalOpen } = useNavigation()
      if (!isModalOpen) return null
      // Modal-rendered screens mount only after the modal opened, so their
      // areas join the modal layer without declaring scope="modal".
      return (
        <MouseArea
          bounds={{ x: 20, y: 20, width: 3, height: 3 }}
          onClick={modalContent}
        />
      )
    }

    const { stdin } = render(
      harness(
        <>
          <Capture />
          <MouseArea bounds={BACKGROUND} onClick={background} />
          <ModalLayerArea />
        </>,
      ),
    )

    navigation!.pushModal('modal-screen')
    await delay()

    await click(stdin, 2, 2) // background still blocked
    expect(background).not.toHaveBeenCalled()

    await click(stdin, 21, 21) // modal-layer area works
    expect(modalContent).toHaveBeenCalledTimes(1)
  })
})

describe('MouseProvider press/release cancellation', () => {
  const AREA = { x: 0, y: 0, width: 4, height: 4 }

  it('cancels activation when a modal opens mid-gesture, even if it closes before release', async () => {
    const onClick = vi.fn()
    let navigation: ReturnType<typeof useNavigation> | null = null

    function Capture() {
      navigation = useNavigation()
      return null
    }

    const { stdin } = render(
      harness(
        <>
          <Capture />
          <MouseArea bounds={AREA} onClick={onClick} />
        </>,
      ),
    )

    // Modal opens while the button is held: the background press is stale.
    await press(stdin, 2, 2)
    navigation!.pushModal('modal-screen')
    await delay()
    await release(stdin, 2, 2)
    expect(onClick).not.toHaveBeenCalled()
    navigation!.popModal()
    await delay()

    // A modal that opened and closed during one gesture also cancels, even
    // though the background area is reachable again at release time.
    await press(stdin, 2, 2)
    navigation!.pushModal('modal-screen')
    await delay()
    navigation!.popModal()
    await delay()
    await release(stdin, 2, 2)
    expect(onClick).not.toHaveBeenCalled()

    // A plain press/release after the modal is gone still activates.
    await click(stdin, 2, 2)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('keeps a compatible press when an unrelated scope is pushed mid-gesture', async () => {
    const onClick = vi.fn()
    let keyboard: ReturnType<typeof useKeyboardScope> | null = null

    function Capture() {
      keyboard = useKeyboardScope()
      return null
    }

    const { stdin } = render(
      harness(
        <>
          <Capture />
          <MouseArea bounds={AREA} onClick={onClick} />
        </>,
      ),
    )

    // The pressed area stays eligible and stays the resolved target, so a
    // scope stack addition elsewhere must not cancel the click.
    await press(stdin, 2, 2)
    keyboard!.pushScope('list')
    await delay()
    await release(stdin, 2, 2)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does not activate a stale or newly promoted target when a scope change reroutes the point', async () => {
    const background = vi.fn()
    const promoted = vi.fn()
    let keyboard: ReturnType<typeof useKeyboardScope> | null = null

    function Capture() {
      keyboard = useKeyboardScope()
      return null
    }

    const { stdin } = render(
      harness(
        <>
          <Capture />
          <MouseArea bounds={AREA} onClick={background} />
          <MouseArea
            bounds={AREA}
            scope="list"
            priority={5}
            onClick={promoted}
          />
        </>,
      ),
    )

    // `list` is inactive at press: the background area is the press target.
    await press(stdin, 2, 2)
    // Activating it promotes a higher-priority target under the same point.
    keyboard!.pushScope('list')
    await delay()
    await release(stdin, 2, 2)
    expect(background).not.toHaveBeenCalled()
    expect(promoted).not.toHaveBeenCalled()

    // A fresh gesture starts on the promoted target and activates it.
    await click(stdin, 2, 2)
    expect(promoted).toHaveBeenCalledTimes(1)
    expect(background).not.toHaveBeenCalled()
  })

  it('cancels activation when the pressed scope becomes ineligible before release', async () => {
    const onClick = vi.fn()
    let keyboard: ReturnType<typeof useKeyboardScope> | null = null

    function Capture() {
      keyboard = useKeyboardScope()
      return null
    }

    const { stdin } = render(
      harness(
        <>
          <Capture />
          <MouseArea bounds={AREA} scope="list" onClick={onClick} />
        </>,
      ),
    )

    keyboard!.pushScope('list')
    await delay()
    await press(stdin, 2, 2)
    keyboard!.popScope('list')
    await delay()
    await release(stdin, 2, 2)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('consumes but never activates a target disabled at press or disabled before release', async () => {
    const onClick = vi.fn()
    let disabled = false

    function Host() {
      return <MouseArea bounds={AREA} disabled={disabled} onClick={onClick} />
    }

    const { stdin, rerender } = render(harness(<Host />))

    // Enabled at press, disabled before release.
    await press(stdin, 2, 2)
    disabled = true
    rerender(harness(<Host />))
    await delay()
    await release(stdin, 2, 2)
    expect(onClick).not.toHaveBeenCalled()

    // Disabled at press, re-enabled before release: the stale gesture still
    // must not activate.
    await press(stdin, 2, 2)
    disabled = false
    rerender(harness(<Host />))
    await delay()
    await release(stdin, 2, 2)
    expect(onClick).not.toHaveBeenCalled()

    // A fully enabled press/release still activates.
    await click(stdin, 2, 2)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does not activate a stale target that lost resolution to a later registration', async () => {
    const underlying = vi.fn()
    const overlay = vi.fn()
    let showOverlay = false

    function Host() {
      return (
        <>
          <MouseArea bounds={AREA} onClick={underlying} />
          {showOverlay ? (
            // Same priority: the later registration wins the tie at release.
            <MouseArea bounds={AREA} onClick={overlay} />
          ) : null}
        </>
      )
    }

    const { stdin, rerender } = render(harness(<Host />))

    await press(stdin, 2, 2)
    showOverlay = true
    rerender(harness(<Host />))
    await delay()
    await release(stdin, 2, 2)

    // Release resolves to the overlay, not the pressed area: neither fires.
    expect(underlying).not.toHaveBeenCalled()
    expect(overlay).not.toHaveBeenCalled()

    // A gesture that starts on the overlay does activate it.
    await click(stdin, 2, 2)
    expect(overlay).toHaveBeenCalledTimes(1)
    expect(underlying).not.toHaveBeenCalled()
  })

  it('does not activate a replacement target mounted at the pressed bounds', async () => {
    const onClick = vi.fn()
    let version = 0

    function Host() {
      return <MouseArea key={version} bounds={AREA} onClick={onClick} />
    }

    const { stdin, rerender } = render(harness(<Host />))

    await press(stdin, 2, 2)
    version += 1
    rerender(harness(<Host />))
    await delay()
    await release(stdin, 2, 2)
    expect(onClick).not.toHaveBeenCalled()

    await click(stdin, 2, 2)
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('MouseProvider input interleaving', () => {
  const AREA = { x: 0, y: 0, width: 3, height: 3 }

  it('replays buffered records through the keyboard dispatcher separately and in order', async () => {
    const seen: NormalizedKeyEvent[] = []

    function KeyLog() {
      useKeyHandler((event) => {
        seen.push(event)
      }, 'navigation')
      return null
    }

    const { stdin } = render(
      harness(
        <>
          <KeyLog />
          <MouseArea bounds={AREA} onClick={() => {}} />
        </>,
      ),
    )

    stdin.write('a')
    await delay()
    stdin.write('[')
    await delay(10)
    stdin.write('<0')
    await delay(10)
    stdin.write('a')
    await delay()

    expect(seen.map((event) => event.rawInput)).toEqual(['a', '[', '<0', 'a'])
  })

  it('times out a held prefix and replays it with original metadata', async () => {
    const seen: NormalizedKeyEvent[] = []

    function KeyLog() {
      useKeyHandler((event) => {
        seen.push(event)
      }, 'navigation')
      return null
    }

    const { stdin } = render(
      harness(
        <>
          <KeyLog />
          <MouseArea bounds={AREA} onClick={() => {}} />
        </>,
        5,
      ),
    )

    stdin.write('[')
    await delay(40) // > prefixTimeoutMs, Ink still owns the original event
    expect(seen).toHaveLength(1)
    expect(seen[0].rawInput).toBe('[')
    expect(seen[0].text).toBe('[')

    stdin.write('A')
    await delay()
    expect(seen.map((event) => event.rawInput)).toEqual(['[', 'A'])
    expect(seen[1].shift).toBe(true)
  })

  it('interleaves keyboard input and mouse clicks without losing order', async () => {
    const events: string[] = []

    function KeyLog() {
      useKeyHandler((event) => {
        events.push(`key:${event.rawInput}`)
      }, 'navigation')
      return null
    }

    const { stdin } = render(
      harness(
        <>
          <KeyLog />
          <MouseArea bounds={AREA} onClick={() => events.push('click')} />
        </>,
      ),
    )

    stdin.write('a')
    await delay()
    await click(stdin, 2, 2)
    stdin.write('b')
    await delay()

    expect(events).toEqual(['key:a', 'click', 'key:b'])
  })
})

// ── Prefix timer cleanup on unmount ────────────────────────────────────

describe('MouseProvider prefix timer cleanup on unmount', () => {
  const AREA = { x: 0, y: 0, width: 3, height: 3 }
  const PREFIX_TIMEOUT_MS = 60

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function KeyLog({ onKey }: { onKey: (rawInput: string) => void }) {
    useKeyHandler((event) => {
      onKey(event.rawInput)
    }, 'navigation')
    return null
  }

  /**
   * The keyboard scope and its `KeyLog` stay mounted for the whole test so a
   * stale provider timer that replays after unmount would be observable.
   */
  function Probe({
    mouseMounted,
    onKey,
    onClick,
  }: {
    mouseMounted: boolean
    onKey: (rawInput: string) => void
    onClick: () => void
  }) {
    return (
      <KeyboardScopeProvider>
        <NavigationProvider registry={registry} defaultScreen="home">
          <KeyLog onKey={onKey} />
          {mouseMounted ? (
            <MouseProvider prefixTimeoutMs={PREFIX_TIMEOUT_MS}>
              <MouseArea bounds={AREA} onClick={onClick} />
            </MouseProvider>
          ) : null}
        </NavigationProvider>
      </KeyboardScopeProvider>
    )
  }

  it('replays a held prefix when the timeout elapses while mounted (control)', async () => {
    const seen: string[] = []
    const { stdin, unmount } = render(
      <Probe
        mouseMounted
        onKey={(raw) => seen.push(raw)}
        onClick={() => {}}
      />,
    )

    stdin.write('[<0;12;7')
    expect(seen).toEqual([])

    await vi.advanceTimersByTimeAsync(PREFIX_TIMEOUT_MS)
    expect(seen).toEqual(['[<0;12;7'])
    unmount()
  })

  it('cancels the pending prefix timeout on unmount without late dispatch', async () => {
    const seen: string[] = []
    const onClick = vi.fn()
    let mouseMounted = true

    const probe = () => (
      <Probe
        mouseMounted={mouseMounted}
        onKey={(raw) => seen.push(raw)}
        onClick={onClick}
      />
    )

    const { stdin, rerender, unmount } = render(probe())

    const timersBeforePrefix = vi.getTimerCount()
    stdin.write('[<0;12;7')
    // The prefix is buffered and the bounded parser-replay timeout is armed.
    expect(vi.getTimerCount()).toBeGreaterThan(timersBeforePrefix)
    expect(seen).toEqual([])

    // Unmount the provider before its timeout fires.
    mouseMounted = false
    rerender(probe())

    await vi.advanceTimersByTimeAsync(PREFIX_TIMEOUT_MS * 4)
    expect(seen).toEqual([])
    expect(onClick).not.toHaveBeenCalled()

    // Cleanup stays stable and idempotent: repeated updates, a whole-tree
    // unmount and more elapsed time must not produce any late dispatch.
    rerender(probe())
    unmount()
    await vi.advanceTimersByTimeAsync(PREFIX_TIMEOUT_MS * 4)
    expect(seen).toEqual([])
    expect(onClick).not.toHaveBeenCalled()
  })
})

// ── TTY mode lifecycle ────────────────────────────────────────────────

class FakeOutput extends EventEmitter {
  isTTY: boolean
  columns = 80
  rows = 24
  destroyed = false
  writableEnded = false
  writable = true
  writes: string[] = []

  constructor(isTTY: boolean) {
    super()
    this.isTTY = isTTY
  }

  write = (data: string): boolean => {
    this.writes.push(data)
    return true
  }

  getColorDepth(): number {
    return 1
  }

  hasColors(): boolean {
    return false
  }
}

class FakeInput extends EventEmitter {
  isTTY: boolean
  private buffered: string | null = null

  constructor(isTTY: boolean) {
    super()
    this.isTTY = isTTY
  }

  setEncoding(): void {}

  setRawMode(): void {}

  resume(): void {}

  pause(): void {}

  ref(): void {}

  unref(): void {}

  read = (): string | null => {
    const data = this.buffered
    this.buffered = null
    return data
  }

  write = (data: string): void => {
    this.buffered = data
    this.emit('readable')
    this.emit('data', data)
  }
}

function renderWithStreams(ui: ReactElement, tty: boolean) {
  const stdout = new FakeOutput(tty)
  const stderr = new FakeOutput(tty)
  const stdin = new FakeInput(true)
  const instance = inkRender(ui, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stderr as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
  })
  return { instance, stdout }
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

// ── External normalized event source doubles ────────────────────────────

/**
 * In-memory {@link MouseEventSource} double: records subscriptions, exposes
 * the returned unsubscribe spy and delivers normalized events synchronously
 * to every live subscriber.
 */
function fakeMouseEventSource() {
  const listeners = new Set<(event: NormalizedMouseEvent) => void>()
  const unsubscribe = vi.fn(
    (listener: (event: NormalizedMouseEvent) => void) => {
      listeners.delete(listener)
    },
  )
  return {
    source: {
      subscribe(listener: (event: NormalizedMouseEvent) => void) {
        listeners.add(listener)
        return () => {
          unsubscribe(listener)
        }
      },
    } satisfies MouseEventSource,
    emit(event: NormalizedMouseEvent) {
      for (const listener of [...listeners]) listener(event)
    },
    listenerCount: () => listeners.size,
    unsubscribe,
  }
}

/** Zero-based button report for a fake source. */
function sourceButtonEvent(
  type: 'press' | 'release',
  x: number,
  y: number,
): NormalizedMouseEvent {
  return { type, button: 'left', x, y, shift: false, alt: false, ctrl: false }
}

/** Zero-based wheel notch for a fake source. */
function sourceWheelEvent(
  direction: MouseWheelDirection,
  x: number,
  y: number,
): NormalizedMouseEvent {
  return {
    type: 'wheel',
    direction,
    x,
    y,
    shift: false,
    alt: false,
    ctrl: false,
  }
}

/**
 * Zero-based motion event for a fake source: left held (`'left'`) or no button
 * (`'none'`), matching the normalized stream-parser union.
 */
function sourceMoveEvent(
  button: 'left' | 'none',
  x: number,
  y: number,
): NormalizedMouseEvent {
  return {
    type: 'move',
    button,
    x,
    y,
    shift: false,
    alt: false,
    ctrl: false,
  }
}

/**
 * Minimal area probe exposing the full click/hover/drag surface so pointer
 * routing can be asserted without a measured layout.
 */
function MouseProbe({
  bounds,
  disabled = false,
  priority = 0,
  scope,
  ...handlers
}: {
  bounds: MouseBounds
  disabled?: boolean
  priority?: number
  scope?: FocusScope
} & Pick<
  MouseAreaProps,
  | 'onClick'
  | 'onEnter'
  | 'onLeave'
  | 'onMove'
  | 'onDragStart'
  | 'onDragMove'
  | 'onDragEnd'
  | 'onDragCancel'
>) {
  return (
    <MouseArea
      bounds={bounds}
      disabled={disabled}
      priority={priority}
      scope={scope}
      {...handlers}
    />
  )
}

/**
 * Wheel-only registration probe: mirrors `MouseScrollLayout`'s registration
 * shape (stable explicit id, record mutated in place) without requiring a
 * measured layout, so wheel routing can be exercised directly from a source.
 */
function WheelRegionProbe({
  id,
  bounds,
  onWheel,
  wheelParentId = null,
  priority = 0,
}: {
  id: number
  bounds: MouseBounds
  onWheel?: (direction: MouseWheelDirection) => boolean
  wheelParentId?: number | null
  priority?: number
}) {
  const registry = useMouseRegistry()
  const recordRef = useRef<MouseWheelRegistration | null>(null)
  if (recordRef.current === null) {
    recordRef.current = {
      id,
      bounds,
      priority,
      wheelOnly: true,
      wheelParentId,
      onWheel,
    }
  }
  const record = recordRef.current
  record.bounds = bounds
  record.priority = priority
  record.wheelParentId = wheelParentId
  record.onWheel = onWheel
  useLayoutEffect(() => {
    if (!registry) return
    return registry.registerWheelRegion(record)
  }, [registry, record])
  return null
}

describe('MouseProvider TTY lifecycle', () => {
  const AREA = { x: 0, y: 0, width: 2, height: 2 }

  it('writes no mode sequences when stdout is not a TTY', async () => {
    const { instance, stdout } = renderWithStreams(
      harness(<MouseArea bounds={AREA} onClick={() => {}} />),
      false,
    )
    await delay()
    const output = stdout.writes.join('')
    expect(output).not.toContain(MOUSE_ENABLE_SEQUENCE)
    expect(output).not.toContain(MOUSE_RESET_SEQUENCE)

    instance.unmount()
    await delay()
    const afterUnmount = stdout.writes.join('')
    expect(afterUnmount).not.toContain(MOUSE_ENABLE_SEQUENCE)
    expect(afterUnmount).not.toContain(MOUSE_RESET_SEQUENCE)
  })

  it('enables mouse reporting on a TTY and writes one direct reset on unmount', async () => {
    const { instance, stdout } = renderWithStreams(
      harness(<MouseArea bounds={AREA} onClick={() => {}} />),
      true,
    )
    await delay()

    const enabled = stdout.writes.join('')
    expect(enabled).toContain(MOUSE_ENABLE_SEQUENCE)
    expect(enabled).not.toContain(MOUSE_RESET_SEQUENCE)

    instance.unmount()
    await delay()

    const unmounted = stdout.writes.join('')
    expect(unmounted).toContain(MOUSE_RESET_SEQUENCE)
    expect(occurrences(unmounted, MOUSE_ENABLE_SEQUENCE)).toBe(1)
    expect(occurrences(unmounted, MOUSE_RESET_SEQUENCE)).toBe(1)

    // Second unmount is a no-op and must not emit another reset.
    instance.unmount()
    await delay()
    expect(
      occurrences(stdout.writes.join(''), MOUSE_RESET_SEQUENCE),
    ).toBe(1)
  })

  it('keeps the 1003/1006 mode lifecycle when an event source is configured', async () => {
    const source = fakeMouseEventSource()
    const { instance, stdout } = renderWithStreams(
      harness(
        <MouseArea bounds={AREA} onClick={() => {}} />,
        undefined,
        undefined,
        source.source,
      ),
      true,
    )
    await delay()

    expect(stdout.writes.join('')).toContain(MOUSE_ENABLE_SEQUENCE)
    expect(source.listenerCount()).toBe(1)

    instance.unmount()
    await delay()

    const output = stdout.writes.join('')
    expect(output).toContain(MOUSE_RESET_SEQUENCE)
    expect(occurrences(output, MOUSE_ENABLE_SEQUENCE)).toBe(1)
    expect(occurrences(output, MOUSE_RESET_SEQUENCE)).toBe(1)
    expect(source.listenerCount()).toBe(0)
  })
})

// ── External normalized event source ────────────────────────────────────

describe('MouseProvider external mouse event source', () => {
  const AREA = { x: 0, y: 0, width: 4, height: 4 }
  const MODAL_AREA = { x: 10, y: 10, width: 4, height: 4 }
  const WHEEL_AREA = { x: 0, y: 0, width: 6, height: 6 }

  it('routes source clicks through the same hit testing and pairing rules', () => {
    const source = fakeMouseEventSource()
    const onClick = vi.fn()
    render(
      harness(
        <MouseArea bounds={BOUNDS} onClick={onClick} />,
        undefined,
        undefined,
        source.source,
      ),
    )

    expect(source.listenerCount()).toBe(1)
    expect(source.unsubscribe).not.toHaveBeenCalled()

    source.emit(sourceButtonEvent('press', 1, 0))
    source.emit(sourceButtonEvent('release', 1, 0))
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onClick).toHaveBeenCalledWith({ x: 1, y: 0 })

    // Half-open bounds: the right edge is exclusive.
    source.emit(sourceButtonEvent('press', 4, 0))
    source.emit(sourceButtonEvent('release', 4, 0))
    expect(onClick).toHaveBeenCalledTimes(1)

    // A release outside the pressed target never activates the press.
    source.emit(sourceButtonEvent('press', 1, 0))
    source.emit(sourceButtonEvent('release', 50, 50))
    expect(onClick).toHaveBeenCalledTimes(1)

    // A release with no pending press never activates.
    source.emit(sourceButtonEvent('release', 1, 0))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('routes source wheel notches deepest-first through the explicit parent chain', () => {
    const source = fakeMouseEventSource()
    const calls: string[] = []
    let innerMoves = false
    const inner = vi.fn((direction: MouseWheelDirection) => {
      calls.push(`inner:${direction}`)
      return innerMoves
    })
    const outer = vi.fn((direction: MouseWheelDirection) => {
      calls.push(`outer:${direction}`)
      return false
    })
    const onClick = vi.fn()

    render(
      harness(
        <>
          <MouseArea bounds={WHEEL_AREA} onClick={onClick} />
          <WheelRegionProbe id={9001} bounds={WHEEL_AREA} onWheel={outer} />
          <WheelRegionProbe
            id={9002}
            bounds={WHEEL_AREA}
            wheelParentId={9001}
            onWheel={inner}
          />
        </>,
        undefined,
        undefined,
        source.source,
      ),
    )

    // Deepest first, then the explicit parent while the child cannot move.
    source.emit(sourceWheelEvent('down', 1, 1))
    expect(calls).toEqual(['inner:down', 'outer:down'])

    // A moved child stops routing before the parent.
    calls.length = 0
    innerMoves = true
    source.emit(sourceWheelEvent('up', 1, 1))
    expect(calls).toEqual(['inner:up'])

    // Modifier flags decorate a report but never change the direction.
    calls.length = 0
    innerMoves = false
    source.emit({
      ...sourceWheelEvent('up', 1, 1),
      shift: true,
      alt: true,
      ctrl: true,
    })
    expect(calls).toEqual(['inner:up', 'outer:up'])

    // Wheel routing never invokes click areas; a report hitting nothing is
    // consumed without residue.
    expect(onClick).not.toHaveBeenCalled()
    calls.length = 0
    source.emit(sourceWheelEvent('down', 50, 50))
    expect(calls).toEqual([])
    expect(onClick).not.toHaveBeenCalled()
  })

  it('does not double-dispatch when Ink also receives the same SGR report', async () => {
    const source = fakeMouseEventSource()
    const onClick = vi.fn()
    const { stdin } = render(
      harness(
        <MouseArea bounds={BOUNDS} onClick={onClick} />,
        undefined,
        undefined,
        source.source,
      ),
    )

    // Source mode bypasses the post-Ink interceptor: an SGR report that still
    // reaches Ink must route no click at all.
    await click(stdin, 2, 1)
    expect(onClick).not.toHaveBeenCalled()

    // The source remains the single dispatch path.
    source.emit(sourceButtonEvent('press', 1, 0))
    source.emit(sourceButtonEvent('release', 1, 0))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('unsubscribes on source swap and unmount, routing only the live source', async () => {
    const first = fakeMouseEventSource()
    const second = fakeMouseEventSource()
    const onClick = vi.fn()
    const area = <MouseArea bounds={AREA} onClick={onClick} />

    const { rerender, unmount } = render(
      harness(area, undefined, undefined, first.source),
    )
    expect(first.listenerCount()).toBe(1)

    // Swapping the source detaches the old one and attaches the new one.
    rerender(harness(area, undefined, undefined, second.source))
    await delay()
    expect(first.listenerCount()).toBe(0)
    expect(first.unsubscribe).toHaveBeenCalledTimes(1)
    expect(second.listenerCount()).toBe(1)

    // A detached source can no longer route.
    first.emit(sourceButtonEvent('press', 1, 1))
    first.emit(sourceButtonEvent('release', 1, 1))
    expect(onClick).not.toHaveBeenCalled()

    second.emit(sourceButtonEvent('press', 1, 1))
    second.emit(sourceButtonEvent('release', 1, 1))
    expect(onClick).toHaveBeenCalledTimes(1)

    // Unmount detaches the live subscription; later emissions are inert.
    unmount()
    await delay()
    expect(second.listenerCount()).toBe(0)
    expect(second.unsubscribe).toHaveBeenCalledTimes(1)
    second.emit(sourceButtonEvent('press', 1, 1))
    second.emit(sourceButtonEvent('release', 1, 1))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('cancels a source press when the modal stack changes before release', async () => {
    const source = fakeMouseEventSource()
    const background = vi.fn()
    const modal = vi.fn()
    let navigation: ReturnType<typeof useNavigation> | null = null

    function Capture() {
      navigation = useNavigation()
      return null
    }

    render(
      harness(
        <>
          <Capture />
          <MouseArea bounds={AREA} onClick={background} />
          <MouseArea bounds={MODAL_AREA} scope="modal" onClick={modal} />
        </>,
        undefined,
        undefined,
        source.source,
      ),
    )

    // A modal opening mid-gesture cancels the stale background press.
    source.emit(sourceButtonEvent('press', 1, 1))
    navigation!.pushModal('modal-screen')
    await delay()
    source.emit(sourceButtonEvent('release', 1, 1))
    expect(background).not.toHaveBeenCalled()

    // While the modal is open only the modal area is reachable; background
    // clicks are consumed without activation.
    source.emit(sourceButtonEvent('press', 11, 11))
    source.emit(sourceButtonEvent('release', 11, 11))
    expect(modal).toHaveBeenCalledTimes(1)

    source.emit(sourceButtonEvent('press', 1, 1))
    source.emit(sourceButtonEvent('release', 1, 1))
    expect(background).not.toHaveBeenCalled()

    // After the modal closes the background area is reachable again.
    navigation!.popModal()
    await delay()
    source.emit(sourceButtonEvent('press', 1, 1))
    source.emit(sourceButtonEvent('release', 1, 1))
    expect(background).toHaveBeenCalledTimes(1)
  })

  it('reports source events through the same diagnostics sink', () => {
    const source = fakeMouseEventSource()
    const events: MouseDiagnosticEvent[] = []
    render(
      harness(
        <MouseArea bounds={BOUNDS} onClick={() => {}} />,
        undefined,
        (event) => events.push(event),
        source.source,
      ),
    )

    source.emit(sourceButtonEvent('press', 1, 0))
    source.emit(sourceButtonEvent('release', 1, 0))
    source.emit(sourceWheelEvent('up', 1, 0))

    expect(events.map((event) => `${event.action}:${event.reason}`)).toEqual([
      'press:press-pending',
      'release:dispatched',
      'wheel-up:wheel-no-target',
    ])
    expect(events[0]).toMatchObject({
      x: 1,
      y: 0,
      dispatched: false,
      areaCount: 1,
      containingCount: 1,
    })
    expect(events[1]).toMatchObject({
      x: 1,
      y: 0,
      dispatched: true,
      targetId: events[0]!.targetId,
      pressedTargetId: events[0]!.targetId,
    })
  })

  it('keeps the post-Ink SGR path as the default when no source is configured', async () => {
    const onClick = vi.fn()
    const { stdin } = render(
      harness(<MouseArea bounds={BOUNDS} onClick={onClick} />),
    )
    await click(stdin, 2, 1)
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onClick).toHaveBeenCalledWith({ x: 1, y: 0 })
  })
})

describe('MouseProvider defaults', () => {
  it('exports a prefix timeout comfortably above Ink’s 20ms CSI flush', () => {
    expect(DEFAULT_MOUSE_PREFIX_TIMEOUT_MS).toBeGreaterThan(20)
  })
})

// ── Phase 2: input-focus bridge ────────────────────────────────────────

interface InputFocusHandle {
  id: string
  focused: boolean
  focus: () => void
  /**
   * Live readiness flag for typing. `focused` flips one commit before the
   * field's `useKeyHandler` re-registers with `enabled: focused`, and
   * `stdin.write` is synchronous, so tests must wait for this instead of
   * assuming a fixed delay is enough.
   */
  handlerReady: { current: boolean }
}

/**
 * Minimal editable-control probe: gates its key handler on the bridge hook's
 * `focused` flag exactly the way real inputs are expected to, so typing only
 * reaches the active field.
 */
function FocusField({
  id,
  label,
  seen,
  capture,
}: {
  id: string
  label: string
  seen: string[]
  capture?: { current: InputFocusHandle | null }
}) {
  const state = useInputFocus(id)
  const { activeScopes } = useKeyboardScope()
  const handlerReady = useRef(false)
  useKeyHandler(
    (event) => {
      if (event.isPrintable) {
        seen.push(`${label}:${event.text}`)
        return true
      }
    },
    'textinput',
    { enabled: state.focused, priority: 60 },
  )
  // Effects run in hook order, so this probe only flips after useKeyHandler's
  // scope and registration effects for the current focus state have run, and
  // after the scope stack has committed 'textinput' into the dispatchable set.
  // Only then can a synchronous `stdin.write` reach this field's handler.
  const scopeActive = activeScopes.includes('textinput')
  useEffect(() => {
    handlerReady.current = state.focused && scopeActive
  }, [state.focused, scopeActive])
  if (capture) {
    capture.current = {
      id: state.id,
      focused: state.focused,
      focus: state.focus,
      handlerReady,
    }
  }
  return <Text>{`${label}:${state.focused ? 'focused' : 'blurred'}`}</Text>
}

/**
 * Wait for the field's key handler to become dispatchable before typing:
 * registration effects have run and the scope stack render is committed.
 * This is a condition wait, not a timeout bump — it completes as soon as the
 * handler is registered and fails if it never is.
 */
async function waitForHandlerReady(handle: {
  current: InputFocusHandle | null
}): Promise<void> {
  await vi.waitFor(() => {
    expect(handle.current?.handlerReady.current).toBe(true)
  })
}

function DynamicFocusFields({
  fields,
  seen,
  captures,
}: {
  fields: string[]
  seen: string[]
  captures?: Record<string, { current: InputFocusHandle | null }>
}) {
  return (
    <KeyboardScopeProvider>
      <FocusTreeProvider>
        {fields.map((field) => (
          <FocusField
            key={field}
            id={`field-${field}`}
            label={field}
            seen={seen}
            capture={captures?.[field]}
          />
        ))}
      </FocusTreeProvider>
    </KeyboardScopeProvider>
  )
}

describe('useInputFocus bridge', () => {
  it('gives the first registered field default focus and routes keys only there', async () => {
    const seen: string[] = []
    const first = { current: null as InputFocusHandle | null }
    const second = { current: null as InputFocusHandle | null }

    const { lastFrame, stdin } = render(
      <KeyboardScopeProvider>
        <FocusTreeProvider>
          <FocusField
            id="first-field"
            label="first"
            seen={seen}
            capture={first}
          />
          <FocusField
            id="second-field"
            label="second"
            seen={seen}
            capture={second}
          />
        </FocusTreeProvider>
      </KeyboardScopeProvider>,
    )

    await vi.waitFor(() => {
      expect(lastFrame()).toContain('first:focused')
      expect(lastFrame()).toContain('second:blurred')
    })
    expect(first.current?.id).toBe('first-field')
    expect(first.current?.focused).toBe(true)
    expect(second.current?.focused).toBe(false)

    await waitForHandlerReady(first)
    stdin.write('a')
    await delay()
    expect(seen).toEqual(['first:a'])
  })

  it('makes a focused field the sole keyboard-enabled one', async () => {
    const seen: string[] = []
    const first = { current: null as InputFocusHandle | null }
    const second = { current: null as InputFocusHandle | null }

    const { lastFrame, stdin } = render(
      <KeyboardScopeProvider>
        <FocusTreeProvider>
          <FocusField id="first" label="first" seen={seen} capture={first} />
          <FocusField id="second" label="second" seen={seen} capture={second} />
        </FocusTreeProvider>
      </KeyboardScopeProvider>,
    )

    await vi.waitFor(() => {
      expect(lastFrame()).toContain('first:focused')
    })

    second.current!.focus()
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('first:blurred')
      expect(lastFrame()).toContain('second:focused')
    })
    await waitForHandlerReady(second)

    stdin.write('b')
    await delay()
    expect(seen).toEqual(['second:b'])

    first.current!.focus()
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('first:focused')
    })
    await waitForHandlerReady(first)
    stdin.write('c')
    await delay()
    expect(seen).toEqual(['second:b', 'first:c'])
  })

  it('falls back to a remaining field on active unmount and defaults a later registration', async () => {
    const seen: string[] = []
    const second = { current: null as InputFocusHandle | null }
    const third = { current: null as InputFocusHandle | null }
    const captures = { second, third }

    const { lastFrame, stdin, rerender } = render(
      <DynamicFocusFields
        fields={['first', 'second']}
        seen={seen}
        captures={captures}
      />,
    )

    await vi.waitFor(() => {
      expect(lastFrame()).toContain('first:focused')
      expect(lastFrame()).toContain('second:blurred')
    })

    // Unmount the active field: the remaining registration takes focus.
    rerender(
      <DynamicFocusFields
        fields={['second']}
        seen={seen}
        captures={captures}
      />,
    )
    await vi.waitFor(() => {
      expect(lastFrame()).not.toContain('first:')
      expect(lastFrame()).toContain('second:focused')
    })
    await waitForHandlerReady(second)

    stdin.write('d')
    await delay()
    expect(seen).toEqual(['second:d'])

    // No remaining field: the leaf clears. A later registration then receives
    // default focus, because it is again the first registered field.
    rerender(
      <DynamicFocusFields fields={[]} seen={seen} captures={captures} />,
    )
    await delay()
    rerender(
      <DynamicFocusFields
        fields={['third']}
        seen={seen}
        captures={captures}
      />,
    )
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('third:focused')
    })
    await waitForHandlerReady(third)

    stdin.write('e')
    await delay()
    expect(seen).toEqual(['second:d', 'third:e'])
  })

  it('keeps a solitary control keyboard-focused outside FocusTreeProvider', async () => {
    const seen: string[] = []
    const solo = { current: null as InputFocusHandle | null }

    const { lastFrame, stdin } = render(
      <KeyboardScopeProvider>
        <FocusField id="solo" label="solo" seen={seen} capture={solo} />
      </KeyboardScopeProvider>,
    )

    await vi.waitFor(() => {
      expect(lastFrame()).toContain('solo:focused')
    })
    expect(solo.current?.focused).toBe(true)

    await waitForHandlerReady(solo)
    stdin.write('x')
    await delay()
    expect(seen).toEqual(['solo:x'])
  })
})

// ── Opt-in routing diagnostics ─────────────────────────────────────────

describe('MouseProvider diagnostics (opt-in)', () => {
  const DIAGNOSTIC_BOUNDS = { x: 1, y: 0, width: 3, height: 2 }

  it('reports press/release target resolution and dispatch without changing the click', async () => {
    const events: MouseDiagnosticEvent[] = []
    const clicks: MouseClickEvent[] = []
    const { stdin } = render(
      harness(
        <MouseArea
          bounds={DIAGNOSTIC_BOUNDS}
          onClick={(event) => clicks.push(event)}
        />,
        undefined,
        (event) => events.push(event),
      ),
    )

    await click(stdin, 2, 1)

    // Activation is exactly the same as without diagnostics.
    expect(clicks).toEqual([{ x: 1, y: 0 }])
    expect(events).toHaveLength(2)
    const [pressEvent, releaseEvent] = events
    expect(pressEvent).toMatchObject({
      action: 'press',
      x: 1,
      y: 0,
      reason: 'press-pending',
      dispatched: false,
      registeredCount: 1,
      areaCount: 1,
      eligibleCount: 1,
      containingCount: 1,
      modalOpen: false,
    })
    expect(pressEvent!.targetId).toEqual(expect.any(Number))
    expect(pressEvent!.areas).toHaveLength(1)
    expect(pressEvent!.areas[0]).toMatchObject({
      bounds: DIAGNOSTIC_BOUNDS,
      priority: 0,
      disabled: false,
      wheelOnly: false,
      contains: true,
      eligible: true,
      hasHandler: true,
    })
    // No handler function is ever part of the snapshot.
    expect(Object.values(pressEvent!.areas[0]!)).not.toContainEqual(
      expect.any(Function),
    )
    expect(releaseEvent).toMatchObject({
      action: 'release',
      reason: 'dispatched',
      dispatched: true,
      targetId: pressEvent!.targetId,
      pressedTargetId: pressEvent!.targetId,
      containingCount: 1,
    })
  })

  it('reports a missing target for an empty route and for a point outside every area', async () => {
    const emptyEvents: MouseDiagnosticEvent[] = []
    const emptyRender = render(
      harness(
        <Text>no targets</Text>,
        undefined,
        (event) => emptyEvents.push(event),
      ),
    )
    await click(emptyRender.stdin, 5, 5)
    expect(emptyEvents.map((event) => event.reason)).toEqual([
      'no-target',
      'press-had-no-target',
    ])
    expect(emptyEvents[0]).toMatchObject({
      registeredCount: 0,
      areaCount: 0,
      eligibleCount: 0,
      containingCount: 0,
      targetId: null,
      areas: [],
      dispatched: false,
    })

    const missedEvents: MouseDiagnosticEvent[] = []
    const onClick = vi.fn()
    const missedRender = render(
      harness(
        <MouseArea bounds={DIAGNOSTIC_BOUNDS} onClick={onClick} />,
        undefined,
        (event) => missedEvents.push(event),
      ),
    )
    await click(missedRender.stdin, 50, 50)
    expect(onClick).not.toHaveBeenCalled()
    expect(missedEvents[0]).toMatchObject({
      reason: 'no-target',
      areaCount: 1,
      eligibleCount: 1,
      containingCount: 0,
      targetId: null,
    })
    expect(missedEvents[0]!.areas[0]).toMatchObject({
      contains: false,
      eligible: true,
    })
  })

  it('reports disabled, modal and unregistered cancellations without activating', async () => {
    const disabledEvents: MouseDiagnosticEvent[] = []
    const disabledClick = vi.fn()
    const disabledRender = render(
      harness(
        <MouseArea
          bounds={DIAGNOSTIC_BOUNDS}
          disabled
          onClick={disabledClick}
        />,
        undefined,
        (event) => disabledEvents.push(event),
      ),
    )
    await click(disabledRender.stdin, 2, 1)
    expect(disabledClick).not.toHaveBeenCalled()
    expect(disabledEvents.map((event) => event.reason)).toEqual([
      'press-disabled',
      'disabled-at-press',
    ])

    // Enabled at press, disabled before release.
    const releaseDisabledEvents: MouseDiagnosticEvent[] = []
    const releaseDisabledClick = vi.fn()
    let disabled = false
    function DisabledHost() {
      return (
        <MouseArea
          bounds={DIAGNOSTIC_BOUNDS}
          disabled={disabled}
          onClick={releaseDisabledClick}
        />
      )
    }
    const releaseRender = render(
      harness(
        <DisabledHost />,
        undefined,
        (event) => releaseDisabledEvents.push(event),
      ),
    )
    await press(releaseRender.stdin, 2, 1)
    disabled = true
    releaseRender.rerender(
      harness(
        <DisabledHost />,
        undefined,
        (event) => releaseDisabledEvents.push(event),
      ),
    )
    await delay()
    await release(releaseRender.stdin, 2, 1)
    expect(releaseDisabledClick).not.toHaveBeenCalled()
    expect(releaseDisabledEvents.map((event) => event.reason)).toEqual([
      'press-pending',
      'disabled-at-release',
    ])

    // A modal opening mid-gesture cancels the press.
    const modalEvents: MouseDiagnosticEvent[] = []
    const modalClick = vi.fn()
    let navigation: ReturnType<typeof useNavigation> | null = null
    function NavigationCapture() {
      navigation = useNavigation()
      return null
    }
    const modalRender = render(
      harness(
        <>
          <NavigationCapture />
          <MouseArea bounds={DIAGNOSTIC_BOUNDS} onClick={modalClick} />
        </>,
        undefined,
        (event) => modalEvents.push(event),
      ),
    )
    await press(modalRender.stdin, 2, 1)
    navigation!.pushModal('modal-screen')
    await delay()
    await release(modalRender.stdin, 2, 1)
    expect(modalClick).not.toHaveBeenCalled()
    expect(modalEvents.map((event) => event.reason)).toEqual([
      'press-pending',
      'modal-changed',
    ])

    // A release without any press reports the missing-press reason.
    const bareEvents: MouseDiagnosticEvent[] = []
    const bareRender = render(
      harness(
        <MouseArea bounds={DIAGNOSTIC_BOUNDS} onClick={() => {}} />,
        undefined,
        (event) => bareEvents.push(event),
      ),
    )
    await release(bareRender.stdin, 2, 1)
    expect(bareEvents.map((event) => event.reason)).toEqual(['no-pending-press'])
  })

  it('reports missing-target when the pressed scope becomes ineligible', async () => {
    const events: MouseDiagnosticEvent[] = []
    const onClick = vi.fn()
    let keyboard: ReturnType<typeof useKeyboardScope> | null = null
    function KeyboardCapture() {
      keyboard = useKeyboardScope()
      return null
    }
    const { stdin } = render(
      harness(
        <>
          <KeyboardCapture />
          <MouseArea
            bounds={DIAGNOSTIC_BOUNDS}
            scope="list"
            onClick={onClick}
          />
        </>,
        undefined,
        (event) => events.push(event),
      ),
    )

    keyboard!.pushScope('list')
    await delay()
    await press(stdin, 2, 1)
    keyboard!.popScope('list')
    await delay()
    await release(stdin, 2, 1)

    expect(onClick).not.toHaveBeenCalled()
    expect(events.map((event) => event.reason)).toEqual([
      'press-pending',
      'missing-target',
    ])
    expect(events[1]).toMatchObject({ targetId: null, dispatched: false })
  })

  it('keeps routing unchanged when the diagnostics sink throws', async () => {
    const clicks: MouseClickEvent[] = []
    const { stdin } = render(
      harness(
        <MouseArea
          bounds={DIAGNOSTIC_BOUNDS}
          onClick={(event) => clicks.push(event)}
        />,
        undefined,
        () => {
          throw new Error('diagnostics boom')
        },
      ),
    )
    await click(stdin, 2, 1)
    expect(clicks).toEqual([{ x: 1, y: 0 }])
  })

  it('uses the latest sink after re-renders without touching activation', async () => {
    const first: MouseDiagnosticEvent[] = []
    const second: MouseDiagnosticEvent[] = []
    const onClick = vi.fn()
    const area = (
      <MouseArea bounds={DIAGNOSTIC_BOUNDS} onClick={onClick} />
    )
    const { stdin, rerender } = render(
      harness(area, undefined, (event) => first.push(event)),
    )
    await click(stdin, 2, 1)

    rerender(harness(area, undefined, (event) => second.push(event)))
    await delay()
    await click(stdin, 2, 1)

    expect(first.map((event) => event.reason)).toEqual([
      'press-pending',
      'dispatched',
    ])
    expect(second.map((event) => event.reason)).toEqual([
      'press-pending',
      'dispatched',
    ])
    expect(onClick).toHaveBeenCalledTimes(2)
  })

  it('caps per-event area snapshots', () => {
    expect(MAX_DIAGNOSTIC_AREA_SNAPSHOTS).toBeGreaterThan(0)
    expect(MAX_DIAGNOSTIC_AREA_SNAPSHOTS).toBeLessThanOrEqual(32)
  })
})

// ── Hover, drag and pointer motion ─────────────────────────────────────

describe('MouseProvider hover routing', () => {
  const AREA_A = { x: 0, y: 0, width: 3, height: 3 }
  const AREA_B = { x: 5, y: 0, width: 3, height: 3 }

  function hoverProbe(
    bounds: MouseBounds,
    options: { disabled?: boolean; priority?: number } = {},
  ) {
    const enter = vi.fn()
    const leave = vi.fn()
    const move = vi.fn()
    const element = (
      <MouseProbe
        bounds={bounds}
        disabled={options.disabled ?? false}
        priority={options.priority ?? 0}
        onEnter={enter}
        onLeave={leave}
        onMove={move}
      />
    )
    return { enter, leave, move, element }
  }

  it('enters, moves and leaves the topmost target via post-Ink motion', async () => {
    const a = hoverProbe(AREA_A)
    const b = hoverProbe(AREA_B)
    const { stdin } = render(
      harness(
        <>
          {a.element}
          {b.element}
        </>,
      ),
    )

    await move(stdin, 'none', 1, 1) // (0, 0) — inside A
    expect(a.enter).toHaveBeenCalledTimes(1)
    expect(a.enter).toHaveBeenCalledWith({ x: 0, y: 0 })
    expect(a.move).toHaveBeenCalledTimes(1)
    expect(a.leave).not.toHaveBeenCalled()

    await move(stdin, 'none', 2, 2) // (1, 1) — still inside A
    expect(a.enter).toHaveBeenCalledTimes(1)
    expect(a.move).toHaveBeenCalledTimes(2)
    expect(a.move).toHaveBeenLastCalledWith({ x: 1, y: 1 })

    await move(stdin, 'none', 6, 1) // (5, 0) — inside B
    expect(a.leave).toHaveBeenCalledTimes(1)
    expect(a.leave).toHaveBeenCalledWith({ x: 5, y: 0 })
    expect(b.enter).toHaveBeenCalledTimes(1)
    expect(b.enter).toHaveBeenCalledWith({ x: 5, y: 0 })
    expect(b.move).toHaveBeenCalledTimes(1)

    await move(stdin, 'none', 50, 50) // outside every area
    expect(b.leave).toHaveBeenCalledTimes(1)
    expect(b.leave).toHaveBeenCalledWith({ x: 49, y: 49 })
    expect(b.move).toHaveBeenCalledTimes(1)
  })

  it('routes the same hover transitions from the external source', () => {
    const source = fakeMouseEventSource()
    const a = hoverProbe(AREA_A)
    render(harness(a.element, undefined, undefined, source.source))

    source.emit(sourceMoveEvent('none', 0, 0))
    expect(a.enter).toHaveBeenCalledTimes(1)
    expect(a.enter).toHaveBeenCalledWith({ x: 0, y: 0 })
    expect(a.move).toHaveBeenCalledTimes(1)

    source.emit(sourceMoveEvent('none', 1, 0))
    expect(a.enter).toHaveBeenCalledTimes(1)
    expect(a.move).toHaveBeenCalledTimes(2)

    source.emit(sourceMoveEvent('none', 40, 40))
    expect(a.leave).toHaveBeenCalledTimes(1)
    expect(a.move).toHaveBeenCalledTimes(2)
  })

  it('lets a disabled topmost target consume motion without passing through', async () => {
    const back = hoverProbe(AREA_A)
    const top = hoverProbe(AREA_A, { disabled: true, priority: 5 })
    const { stdin } = render(
      harness(
        <>
          {back.element}
          {top.element}
        </>,
      ),
    )

    await move(stdin, 'none', 1, 1)
    expect(back.enter).not.toHaveBeenCalled()
    expect(back.move).not.toHaveBeenCalled()
    expect(top.enter).not.toHaveBeenCalled()
    expect(top.move).not.toHaveBeenCalled()
  })

  it('leaves an enabled target when motion moves onto a disabled overlay', async () => {
    const enabled = hoverProbe(AREA_A)
    const disabled = hoverProbe(AREA_B, { disabled: true })
    const { stdin } = render(
      harness(
        <>
          {enabled.element}
          {disabled.element}
        </>,
      ),
    )

    await move(stdin, 'none', 1, 1)
    expect(enabled.enter).toHaveBeenCalledTimes(1)

    await move(stdin, 'none', 6, 1)
    expect(enabled.leave).toHaveBeenCalledTimes(1)
    expect(disabled.enter).not.toHaveBeenCalled()
    expect(disabled.move).not.toHaveBeenCalled()
  })

  it('updates hover on a left-held motion even without a captured press', async () => {
    const a = hoverProbe(AREA_A)
    const { stdin } = render(harness(a.element))

    await move(stdin, 'left', 1, 1)
    expect(a.enter).toHaveBeenCalledTimes(1)
    expect(a.move).toHaveBeenCalledTimes(1)
  })
})

describe('MouseProvider committed hover reconciliation', () => {
  const AREA_A = { x: 0, y: 0, width: 3, height: 3 }
  const AREA_B = { x: 5, y: 0, width: 3, height: 3 }

  it('re-resolves hover after a committed bounds move without any motion', async () => {
    const enterA = vi.fn()
    const leaveA = vi.fn()
    const moveA = vi.fn()
    const clickA = vi.fn()
    const enterB = vi.fn()
    const leaveB = vi.fn()
    const moveB = vi.fn()
    const clickB = vi.fn()
    let moved = false

    function Host() {
      return (
        <>
          <MouseProbe
            bounds={moved ? { x: 20, y: 20, width: 3, height: 3 } : AREA_A}
            onClick={clickA}
            onEnter={enterA}
            onLeave={leaveA}
            onMove={moveA}
          />
          <MouseProbe
            bounds={moved ? AREA_A : AREA_B}
            onClick={clickB}
            onEnter={enterB}
            onLeave={leaveB}
            onMove={moveB}
          />
        </>
      )
    }

    const { stdin, rerender } = render(harness(<Host />))
    await move(stdin, 'none', 1, 1) // (0, 0) — inside A
    expect(enterA).toHaveBeenCalledTimes(1)
    expect(moveA).toHaveBeenCalledTimes(1)

    // A moves away and B lands under the stationary pointer in one commit.
    moved = true
    rerender(harness(<Host />))
    await delay()

    // Exactly one identity transition each, at the last reported cell; the
    // committed re-check is never a synthetic motion or activation.
    expect(leaveA).toHaveBeenCalledTimes(1)
    expect(leaveA).toHaveBeenCalledWith({ x: 0, y: 0 })
    expect(enterB).toHaveBeenCalledTimes(1)
    expect(enterB).toHaveBeenCalledWith({ x: 0, y: 0 })
    expect(moveA).toHaveBeenCalledTimes(1)
    expect(moveB).not.toHaveBeenCalled()
    expect(leaveB).not.toHaveBeenCalled()
    expect(clickA).not.toHaveBeenCalled()
    expect(clickB).not.toHaveBeenCalled()

    // Normal motion and click routing still work from the new cells.
    await click(stdin, 1, 1)
    expect(clickB).toHaveBeenCalledTimes(1)
    expect(clickA).not.toHaveBeenCalled()
  })

  it('moves hover to a prepended row that shifts the previous target down', async () => {
    const enterToast = vi.fn()
    const enterA = vi.fn()
    const leaveA = vi.fn()
    const enterB = vi.fn()
    const leaveB = vi.fn()
    let toast = false

    function Host() {
      return (
        <>
          {toast ? (
            <MouseProbe
              key="toast"
              bounds={{ x: 0, y: 0, width: 6, height: 1 }}
              onEnter={enterToast}
            />
          ) : null}
          <MouseProbe
            key="a"
            bounds={{ x: 0, y: toast ? 1 : 0, width: 6, height: 1 }}
            onEnter={enterA}
            onLeave={leaveA}
          />
          <MouseProbe
            key="b"
            bounds={{ x: 0, y: toast ? 2 : 1, width: 6, height: 1 }}
            onEnter={enterB}
            onLeave={leaveB}
          />
        </>
      )
    }

    const { stdin, rerender } = render(harness(<Host />))
    await move(stdin, 'none', 1, 2) // (0, 1) — inside B
    expect(enterB).toHaveBeenCalledTimes(1)

    // The prepended row shifts A onto the pointer cell and B further down.
    toast = true
    rerender(harness(<Host />))
    await delay()

    expect(leaveB).toHaveBeenCalledTimes(1)
    expect(leaveB).toHaveBeenCalledWith({ x: 0, y: 1 })
    expect(enterA).toHaveBeenCalledTimes(1)
    expect(enterA).toHaveBeenCalledWith({ x: 0, y: 1 })
    expect(enterToast).not.toHaveBeenCalled()
  })

  it('drops a departed hover silently and enters the replacement once', async () => {
    const enterOld = vi.fn()
    const leaveOld = vi.fn()
    const enterNew = vi.fn()
    const leaveNew = vi.fn()
    let replacement = false

    function Host() {
      return replacement ? (
        <MouseProbe
          key="new"
          bounds={AREA_A}
          onEnter={enterNew}
          onLeave={leaveNew}
        />
      ) : (
        <MouseProbe
          key="old"
          bounds={AREA_A}
          onEnter={enterOld}
          onLeave={leaveOld}
        />
      )
    }

    const { stdin, rerender } = render(harness(<Host />))
    await move(stdin, 'none', 1, 1)
    expect(enterOld).toHaveBeenCalledTimes(1)

    replacement = true
    rerender(harness(<Host />))
    await delay()

    // The torn-down record is never called back; the surviving replacement
    // under the stationary pointer is entered exactly once.
    expect(leaveOld).not.toHaveBeenCalled()
    expect(enterNew).toHaveBeenCalledTimes(1)
    expect(enterNew).toHaveBeenCalledWith({ x: 0, y: 0 })
    expect(leaveNew).not.toHaveBeenCalled()
  })

  it('leaves hover when a committed disabled overlay takes the point', async () => {
    const enterA = vi.fn()
    const leaveA = vi.fn()
    const enterOverlay = vi.fn()
    let overlay = false

    function Host() {
      return (
        <>
          <MouseProbe
            bounds={AREA_A}
            onEnter={enterA}
            onLeave={leaveA}
          />
          {overlay ? (
            <MouseProbe
              bounds={AREA_A}
              disabled
              priority={5}
              onEnter={enterOverlay}
            />
          ) : null}
        </>
      )
    }

    const { stdin, rerender } = render(harness(<Host />))
    await move(stdin, 'none', 1, 1)
    expect(enterA).toHaveBeenCalledTimes(1)

    overlay = true
    rerender(harness(<Host />))
    await delay()
    // The disabled topmost target consumes: the previous target leaves and
    // nothing underneath (or on top) is entered.
    expect(leaveA).toHaveBeenCalledTimes(1)
    expect(enterOverlay).not.toHaveBeenCalled()

    overlay = false
    rerender(harness(<Host />))
    await delay()
    // Removing the consumer reveals the enabled target underneath.
    expect(enterA).toHaveBeenCalledTimes(2)
  })

  it('clears the hover of the topmost target that becomes disabled without pass-through', async () => {
    const enterA = vi.fn()
    const leaveA = vi.fn()
    const enterB = vi.fn()
    let disabled = false

    function Host() {
      return (
        <>
          <MouseProbe
            bounds={AREA_A}
            disabled={disabled}
            priority={5}
            onEnter={enterA}
            onLeave={leaveA}
          />
          <MouseProbe bounds={AREA_A} priority={0} onEnter={enterB} />
        </>
      )
    }

    const { stdin, rerender } = render(harness(<Host />))
    await move(stdin, 'none', 1, 1)
    expect(enterA).toHaveBeenCalledTimes(1)

    disabled = true
    rerender(harness(<Host />))
    await delay()

    // The hovered topmost target itself became disabled: it leaves and the
    // enabled area underneath is never entered.
    expect(leaveA).toHaveBeenCalledTimes(1)
    expect(leaveA).toHaveBeenCalledWith({ x: 0, y: 0 })
    expect(enterB).not.toHaveBeenCalled()

    // Motion confirms the same consumption without committed changes.
    await move(stdin, 'none', 2, 2)
    expect(enterB).not.toHaveBeenCalled()
  })

  it('re-resolves hover when the modal stack changes without motion', async () => {
    const enterA = vi.fn()
    const leaveA = vi.fn()
    let navigation: ReturnType<typeof useNavigation> | null = null

    function Capture() {
      navigation = useNavigation()
      return null
    }

    const { stdin } = render(
      harness(
        <>
          <Capture />
          <MouseProbe bounds={AREA_A} onEnter={enterA} onLeave={leaveA} />
        </>,
      ),
    )

    await move(stdin, 'none', 1, 1)
    expect(enterA).toHaveBeenCalledTimes(1)

    navigation!.pushModal('modal-screen')
    await delay()
    // The background area became modal-ineligible: hover left without motion.
    expect(leaveA).toHaveBeenCalledTimes(1)
    expect(leaveA).toHaveBeenCalledWith({ x: 0, y: 0 })

    navigation!.popModal()
    await delay()
    // Eligible again under the same stationary pointer.
    expect(enterA).toHaveBeenCalledTimes(2)
    expect(leaveA).toHaveBeenCalledTimes(1)
  })

  it('re-resolves on a committed scope change but awaits motion for scope-stack changes', async () => {
    const enter = vi.fn()
    const leave = vi.fn()
    let scoped = false
    let keyboard: ReturnType<typeof useKeyboardScope> | null = null

    function Capture() {
      keyboard = useKeyboardScope()
      return null
    }

    function Host() {
      return (
        <MouseProbe
          bounds={AREA_A}
          scope={scoped ? 'list' : undefined}
          onEnter={enter}
          onLeave={leave}
        />
      )
    }

    const { stdin, rerender } = render(
      harness(
        <>
          <Capture />
          <Host />
        </>,
      ),
    )

    await move(stdin, 'none', 1, 1)
    expect(enter).toHaveBeenCalledTimes(1)

    scoped = true
    rerender(
      harness(
        <>
          <Capture />
          <Host />
        </>,
      ),
    )
    await delay()
    // The committed scope field change made the area ineligible.
    expect(leave).toHaveBeenCalledTimes(1)

    keyboard!.pushScope('list')
    await delay()
    // Active scope-stack changes without an area commit wait for motion...
    expect(enter).toHaveBeenCalledTimes(1)
    await move(stdin, 'none', 2, 2)
    // ...and the next motion resolves them.
    expect(enter).toHaveBeenCalledTimes(2)
  })

  it('re-resolves when a committed priority change flips the topmost target', async () => {
    const enterA = vi.fn()
    const leaveA = vi.fn()
    const enterB = vi.fn()
    const leaveB = vi.fn()
    let boost = false

    function Host() {
      return (
        <>
          <MouseProbe
            bounds={AREA_A}
            priority={boost ? 5 : 0}
            onEnter={enterA}
            onLeave={leaveA}
          />
          <MouseProbe
            bounds={AREA_A}
            priority={0}
            onEnter={enterB}
            onLeave={leaveB}
          />
        </>
      )
    }

    const { stdin, rerender } = render(harness(<Host />))
    await move(stdin, 'none', 1, 1)
    // Same priority and bounds: the later registration wins the tie.
    expect(enterB).toHaveBeenCalledTimes(1)
    expect(enterA).not.toHaveBeenCalled()

    boost = true
    rerender(harness(<Host />))
    await delay()
    expect(leaveB).toHaveBeenCalledTimes(1)
    expect(enterA).toHaveBeenCalledTimes(1)
    expect(leaveA).not.toHaveBeenCalled()
  })

  it('does no committed work without a known pointer', async () => {
    const enter = vi.fn()
    const leave = vi.fn()
    const onClick = vi.fn()
    let moved = false

    function Host() {
      return (
        <MouseProbe
          bounds={moved ? { x: 4, y: 4, width: 2, height: 2 } : AREA_A}
          onClick={onClick}
          onEnter={enter}
          onLeave={leave}
        />
      )
    }

    const { stdin, rerender } = render(harness(<Host />))
    moved = true
    rerender(harness(<Host />))
    await delay()

    // No motion ever reported a pointer: committed changes never invent one.
    expect(enter).not.toHaveBeenCalled()
    expect(leave).not.toHaveBeenCalled()

    // Click routing follows the committed bounds, still with no hover.
    await click(stdin, 1, 1) // old cell, now empty
    expect(onClick).not.toHaveBeenCalled()
    await click(stdin, 5, 5)
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(enter).not.toHaveBeenCalled()
  })

  it('re-resolves committed changes identically from the external source', async () => {
    const source = fakeMouseEventSource()
    const enterA = vi.fn()
    const leaveA = vi.fn()
    const enterB = vi.fn()
    let moved = false

    function Host() {
      return (
        <>
          <MouseProbe
            bounds={moved ? { x: 20, y: 20, width: 3, height: 3 } : AREA_A}
            onEnter={enterA}
            onLeave={leaveA}
          />
          <MouseProbe
            bounds={moved ? AREA_A : AREA_B}
            onEnter={enterB}
          />
        </>
      )
    }

    const { rerender } = render(
      harness(<Host />, undefined, undefined, source.source),
    )
    source.emit(sourceMoveEvent('none', 0, 0))
    expect(enterA).toHaveBeenCalledTimes(1)

    moved = true
    rerender(harness(<Host />, undefined, undefined, source.source))
    await delay()

    expect(leaveA).toHaveBeenCalledTimes(1)
    expect(enterB).toHaveBeenCalledTimes(1)
    expect(enterB).toHaveBeenCalledWith({ x: 0, y: 0 })
  })

  it('does not replay a stale pointer across a source swap', async () => {
    const first = fakeMouseEventSource()
    const second = fakeMouseEventSource()
    const enter = vi.fn()
    const leave = vi.fn()
    let moved = false

    function Host() {
      return (
        <MouseProbe
          bounds={moved ? { x: 10, y: 10, width: 3, height: 3 } : AREA_A}
          onEnter={enter}
          onLeave={leave}
        />
      )
    }

    const { rerender } = render(
      harness(<Host />, undefined, undefined, first.source),
    )
    first.emit(sourceMoveEvent('none', 0, 0))
    expect(enter).toHaveBeenCalledTimes(1)

    // Bounds change and channel swap commit together: the old channel's
    // pointer and hover must be dropped without a cross-channel transition.
    moved = true
    rerender(harness(<Host />, undefined, undefined, second.source))
    await delay()
    expect(leave).not.toHaveBeenCalled()
    expect(enter).toHaveBeenCalledTimes(1)

    // The new channel re-establishes hover from its own motion only.
    second.emit(sourceMoveEvent('none', 10, 10))
    expect(enter).toHaveBeenCalledTimes(2)
    expect(leave).not.toHaveBeenCalled()
  })

  it('never dispatches a queued committed re-check after provider teardown', async () => {
    const enter = vi.fn()
    const leave = vi.fn()
    let moved = false

    function Host() {
      return (
        <MouseProbe
          bounds={moved ? { x: 9, y: 9, width: 3, height: 3 } : AREA_A}
          onEnter={enter}
          onLeave={leave}
        />
      )
    }

    const { stdin, rerender, unmount } = render(harness(<Host />))
    await move(stdin, 'none', 1, 1)
    expect(enter).toHaveBeenCalledTimes(1)

    moved = true
    rerender(harness(<Host />))
    // Tear down before the queued microtask gets a chance to run.
    unmount()
    await delay()

    expect(leave).not.toHaveBeenCalled()
    expect(enter).toHaveBeenCalledTimes(1)
  })
})

describe('MouseProvider committed hover reconciliation across an effect replay', () => {
  const AREA_A = { x: 0, y: 0, width: 3, height: 3 }
  const AREA_B = { x: 5, y: 0, width: 3, height: 3 }

  it('keeps committed re-hit-testing alive across a StrictMode-style replay', async () => {
    const enterA = vi.fn()
    const leaveA = vi.fn()
    const enterB = vi.fn()
    let visible = true
    let moved = false
    let guardSetups = 0
    let guardCleanups = 0

    function ReplayProbe() {
      useLayoutEffect(() => {
        guardSetups += 1
        return () => {
          guardCleanups += 1
        }
      }, [])
      return null
    }

    function Host() {
      return (
        <>
          <MouseProbe
            bounds={moved ? { x: 20, y: 20, width: 3, height: 3 } : AREA_A}
            onEnter={enterA}
            onLeave={leaveA}
          />
          <MouseProbe bounds={moved ? AREA_A : AREA_B} onEnter={enterB} />
        </>
      )
    }

    function Tree() {
      return (
        <StrictMode>
          <Activity mode={visible ? 'visible' : 'hidden'}>
            {harness(
              <>
                <ReplayProbe />
                <Host />
              </>,
            )}
          </Activity>
        </StrictMode>
      )
    }

    const { stdin, rerender } = render(<Tree />)
    await delay()

    // Reproduce the StrictMode mount replay ordering (setup → cleanup →
    // setup) deterministically: hiding an Activity unmounts layout effects
    // and showing it runs their setups again while refs stay preserved.
    // Ink creates its root with `isStrictMode = false`, so React never
    // replays effects here by itself; Activity is the only way to pin the
    // provider guard against a cleanup that is not followed by a setup.
    visible = false
    rerender(<Tree />)
    await delay()
    visible = true
    rerender(<Tree />)
    await delay()
    expect(guardCleanups).toBeGreaterThanOrEqual(1)
    expect(guardSetups).toBeGreaterThanOrEqual(2)

    // After the replay, motion and committed re-resolution still work: a
    // live guard is required for the bounds move below to dispatch at all.
    await move(stdin, 'none', 1, 1)
    expect(enterA).toHaveBeenCalledTimes(1)

    moved = true
    rerender(<Tree />)
    await delay()
    expect(leaveA).toHaveBeenCalledTimes(1)
    expect(leaveA).toHaveBeenCalledWith({ x: 0, y: 0 })
    expect(enterB).toHaveBeenCalledTimes(1)
    expect(enterB).toHaveBeenCalledWith({ x: 0, y: 0 })
  })
})

describe('MouseProvider drag capture', () => {
  const AREA = { x: 0, y: 0, width: 2, height: 2 }

  it('captures the press target and dispatches start/move/end outside bounds', async () => {
    const onClick = vi.fn()
    const start = vi.fn()
    const dragMove = vi.fn()
    const end = vi.fn()
    const cancel = vi.fn()
    const { stdin } = render(
      harness(
        <MouseProbe
          bounds={AREA}
          onClick={onClick}
          onDragStart={start}
          onDragMove={dragMove}
          onDragEnd={end}
          onDragCancel={cancel}
        />,
      ),
    )

    await press(stdin, 1, 1) // (0, 0)
    await move(stdin, 'left', 2, 2) // (1, 1)
    expect(start).toHaveBeenCalledTimes(1)
    expect(start).toHaveBeenCalledWith({ x: 1, y: 1, startX: 0, startY: 0 })
    expect(dragMove).toHaveBeenCalledTimes(1)
    expect(dragMove).toHaveBeenCalledWith({ x: 1, y: 1, startX: 0, startY: 0 })
    expect(cancel).not.toHaveBeenCalled()

    // A repeated cell after the start still reports motion (never dropped).
    await move(stdin, 'left', 2, 2)
    expect(dragMove).toHaveBeenCalledTimes(2)

    await move(stdin, 'left', 9, 9) // (8, 8) — outside the captured bounds
    expect(dragMove).toHaveBeenCalledTimes(3)
    expect(dragMove).toHaveBeenLastCalledWith({
      x: 8,
      y: 8,
      startX: 0,
      startY: 0,
    })

    await release(stdin, 9, 9)
    expect(end).toHaveBeenCalledTimes(1)
    expect(end).toHaveBeenCalledWith({ x: 8, y: 8, startX: 0, startY: 0 })
    expect(onClick).not.toHaveBeenCalled()
  })

  it('captures and dispatches drags from the external source', () => {
    const source = fakeMouseEventSource()
    const onClick = vi.fn()
    const start = vi.fn()
    const dragMove = vi.fn()
    const end = vi.fn()
    render(
      harness(
        <MouseProbe
          bounds={AREA}
          onClick={onClick}
          onDragStart={start}
          onDragMove={dragMove}
          onDragEnd={end}
        />,
        undefined,
        undefined,
        source.source,
      ),
    )

    source.emit(sourceButtonEvent('press', 0, 0))
    source.emit(sourceMoveEvent('left', 1, 1))
    expect(start).toHaveBeenCalledTimes(1)
    expect(start).toHaveBeenCalledWith({ x: 1, y: 1, startX: 0, startY: 0 })
    expect(dragMove).toHaveBeenCalledTimes(1)

    source.emit(sourceMoveEvent('left', 30, 30))
    source.emit(sourceButtonEvent('release', 30, 30))
    expect(dragMove).toHaveBeenLastCalledWith({
      x: 30,
      y: 30,
      startX: 0,
      startY: 0,
    })
    expect(end).toHaveBeenCalledWith({ x: 30, y: 30, startX: 0, startY: 0 })
    expect(onClick).not.toHaveBeenCalled()
  })

  it('suppresses the click after a drag even inside the pressed area', async () => {
    const onClick = vi.fn()
    const end = vi.fn()
    const { stdin } = render(
      harness(<MouseProbe bounds={AREA} onClick={onClick} onDragEnd={end} />),
    )

    await press(stdin, 1, 1)
    await move(stdin, 'left', 2, 1) // (1, 0) — still inside AREA
    await release(stdin, 2, 1)
    expect(end).toHaveBeenCalledTimes(1)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('keeps the click when the button never leaves the press cell', async () => {
    const onClick = vi.fn()
    const start = vi.fn()
    const end = vi.fn()
    const { stdin } = render(
      harness(
        <MouseProbe
          bounds={AREA}
          onClick={onClick}
          onDragStart={start}
          onDragEnd={end}
        />,
      ),
    )

    await press(stdin, 1, 1)
    await move(stdin, 'left', 1, 1) // same cell — zero threshold not crossed
    await release(stdin, 1, 1)
    expect(start).not.toHaveBeenCalled()
    expect(end).not.toHaveBeenCalled()
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onClick).toHaveBeenCalledWith({ x: 0, y: 0 })
  })

  it('does not capture a disabled press target', async () => {
    const onClick = vi.fn()
    const start = vi.fn()
    const dragMove = vi.fn()
    const end = vi.fn()
    const { stdin } = render(
      harness(
        <MouseProbe
          bounds={AREA}
          disabled
          onClick={onClick}
          onDragStart={start}
          onDragMove={dragMove}
          onDragEnd={end}
        />,
      ),
    )

    await press(stdin, 1, 1)
    await move(stdin, 'left', 2, 2)
    await release(stdin, 2, 2)
    expect(start).not.toHaveBeenCalled()
    expect(dragMove).not.toHaveBeenCalled()
    expect(end).not.toHaveBeenCalled()
    expect(onClick).not.toHaveBeenCalled()
  })

  it('cancels the capture when the target becomes disabled', async () => {
    const onClick = vi.fn()
    const start = vi.fn()
    const dragMove = vi.fn()
    const end = vi.fn()
    const cancel = vi.fn()
    let disabled = false

    function Host() {
      return (
        <MouseProbe
          bounds={AREA}
          disabled={disabled}
          onClick={onClick}
          onDragStart={start}
          onDragMove={dragMove}
          onDragEnd={end}
          onDragCancel={cancel}
        />
      )
    }

    const { stdin, rerender } = render(harness(<Host />))

    await press(stdin, 1, 1)
    await move(stdin, 'left', 2, 2)
    expect(start).toHaveBeenCalledTimes(1)

    disabled = true
    rerender(harness(<Host />))
    await delay()
    await move(stdin, 'left', 3, 3)

    expect(cancel).toHaveBeenCalledTimes(1)
    // Cancellation reports the last cell seen while the capture was valid.
    expect(cancel).toHaveBeenCalledWith({ x: 1, y: 1, startX: 0, startY: 0 })
    expect(dragMove).toHaveBeenCalledTimes(1)

    await release(stdin, 3, 3)
    expect(end).not.toHaveBeenCalled()
    expect(onClick).not.toHaveBeenCalled()
  })

  it('cancels the capture when the modal stack changes', async () => {
    const onClick = vi.fn()
    const start = vi.fn()
    const end = vi.fn()
    const cancel = vi.fn()
    let navigation: ReturnType<typeof useNavigation> | null = null

    function Capture() {
      navigation = useNavigation()
      return null
    }

    const { stdin } = render(
      harness(
        <>
          <Capture />
          <MouseProbe
            bounds={AREA}
            onClick={onClick}
            onDragStart={start}
            onDragEnd={end}
            onDragCancel={cancel}
          />
        </>,
      ),
    )

    // Cancellation discovered by a motion while the modal is open.
    await press(stdin, 1, 1)
    await move(stdin, 'left', 2, 2)
    expect(start).toHaveBeenCalledTimes(1)
    navigation!.pushModal('modal-screen')
    await delay()
    await move(stdin, 'left', 3, 3)
    expect(cancel).toHaveBeenCalledTimes(1)

    await release(stdin, 3, 3)
    expect(end).not.toHaveBeenCalled()
    expect(onClick).not.toHaveBeenCalled()

    // Cancellation discovered by the release itself.
    navigation!.popModal()
    await delay()
    await press(stdin, 1, 1)
    await move(stdin, 'left', 2, 2)
    navigation!.pushModal('modal-screen')
    await delay()
    await release(stdin, 2, 2)
    expect(cancel).toHaveBeenCalledTimes(2)
    expect(end).not.toHaveBeenCalled()
    expect(onClick).not.toHaveBeenCalled()
  })

  it('drops the capture silently when the target unregisters', async () => {
    const onClick = vi.fn()
    const start = vi.fn()
    const end = vi.fn()
    const cancel = vi.fn()
    let mounted = true

    function Host() {
      return mounted ? (
        <MouseProbe
          bounds={AREA}
          onClick={onClick}
          onDragStart={start}
          onDragEnd={end}
          onDragCancel={cancel}
        />
      ) : null
    }

    const { stdin, rerender } = render(harness(<Host />))

    await press(stdin, 1, 1)
    await move(stdin, 'left', 2, 2)
    expect(start).toHaveBeenCalledTimes(1)

    mounted = false
    rerender(harness(<Host />))
    await delay()
    await release(stdin, 2, 2)

    // Torn-down callbacks are never invoked, and the stale release is inert.
    expect(cancel).not.toHaveBeenCalled()
    expect(end).not.toHaveBeenCalled()
    expect(onClick).not.toHaveBeenCalled()
  })

  it('cancels the capture on a source swap and keeps the stale release inert', async () => {
    const first = fakeMouseEventSource()
    const second = fakeMouseEventSource()
    const onClick = vi.fn()
    const start = vi.fn()
    const end = vi.fn()
    const cancel = vi.fn()
    const area = (
      <MouseProbe
        bounds={AREA}
        onClick={onClick}
        onDragStart={start}
        onDragEnd={end}
        onDragCancel={cancel}
      />
    )

    const { rerender } = render(
      harness(area, undefined, undefined, first.source),
    )
    first.emit(sourceButtonEvent('press', 0, 0))
    first.emit(sourceMoveEvent('left', 1, 1))
    expect(start).toHaveBeenCalledTimes(1)

    rerender(harness(area, undefined, undefined, second.source))
    await delay()
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledWith({ x: 1, y: 1, startX: 0, startY: 0 })

    second.emit(sourceButtonEvent('release', 1, 1))
    expect(end).not.toHaveBeenCalled()
    expect(onClick).not.toHaveBeenCalled()
  })

  it('does not click when the source swaps between press and release', async () => {
    const first = fakeMouseEventSource()
    const second = fakeMouseEventSource()
    const onClick = vi.fn()
    const area = <MouseProbe bounds={AREA} onClick={onClick} />

    const { rerender } = render(
      harness(area, undefined, undefined, first.source),
    )

    // Press on A, swap channels before any motion, release the same cell on B:
    // the old channel's pending press must be gone, not clickable.
    first.emit(sourceButtonEvent('press', 0, 0))
    rerender(harness(area, undefined, undefined, second.source))
    await delay()
    second.emit(sourceButtonEvent('release', 0, 0))
    expect(onClick).not.toHaveBeenCalled()

    // The new channel still owns a fresh, complete gesture.
    second.emit(sourceButtonEvent('press', 0, 0))
    second.emit(sourceButtonEvent('release', 0, 0))
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onClick).toHaveBeenCalledWith({ x: 0, y: 0 })
  })

  it('resets hover on a source swap and re-establishes it from the new channel', async () => {
    const first = fakeMouseEventSource()
    const second = fakeMouseEventSource()
    const enter = vi.fn()
    const leave = vi.fn()
    const move = vi.fn()
    const area = (
      <MouseProbe
        bounds={AREA}
        onEnter={enter}
        onLeave={leave}
        onMove={move}
      />
    )

    const { rerender } = render(
      harness(area, undefined, undefined, first.source),
    )
    first.emit(sourceMoveEvent('none', 0, 0))
    expect(enter).toHaveBeenCalledTimes(1)

    rerender(harness(area, undefined, undefined, second.source))
    await delay()
    // The stale hover is dropped without a cross-channel transition...
    expect(leave).not.toHaveBeenCalled()

    // ...and the new channel re-enters the same target on its first motion.
    second.emit(sourceMoveEvent('none', 0, 0))
    expect(enter).toHaveBeenCalledTimes(2)
    expect(move).toHaveBeenCalledTimes(2)
    expect(leave).not.toHaveBeenCalled()
  })

  it('keeps hover tracking while a drag stays captured on the press target', () => {
    const source = fakeMouseEventSource()
    const A = { x: 0, y: 0, width: 2, height: 2 }
    const B = { x: 5, y: 5, width: 2, height: 2 }
    const aMove = vi.fn()
    const aLeave = vi.fn()
    const bEnter = vi.fn()
    const bMove = vi.fn()
    const dragStart = vi.fn()
    const dragMove = vi.fn()
    const dragEnd = vi.fn()
    const onClick = vi.fn()

    render(
      harness(
        <>
          <MouseProbe
            bounds={A}
            onClick={onClick}
            onMove={aMove}
            onLeave={aLeave}
            onDragStart={dragStart}
            onDragMove={dragMove}
            onDragEnd={dragEnd}
          />
          <MouseProbe bounds={B} onEnter={bEnter} onMove={bMove} />
        </>,
        undefined,
        undefined,
        source.source,
      ),
    )

    // Hover A, press on A, then drag the held button onto B.
    source.emit(sourceMoveEvent('none', 0, 0))
    expect(aMove).toHaveBeenCalledTimes(1)
    source.emit(sourceButtonEvent('press', 0, 0))
    source.emit(sourceMoveEvent('left', 5, 5))

    // Hover transitioned A → B while the capture stayed on A.
    expect(aLeave).toHaveBeenCalledTimes(1)
    expect(bEnter).toHaveBeenCalledTimes(1)
    expect(bMove).toHaveBeenCalledTimes(1)
    expect(dragStart).toHaveBeenCalledTimes(1)
    expect(dragStart).toHaveBeenCalledWith({ x: 5, y: 5, startX: 0, startY: 0 })
    expect(dragMove).toHaveBeenCalledTimes(1)
    expect(dragMove).toHaveBeenCalledWith({ x: 5, y: 5, startX: 0, startY: 0 })

    // Releasing outside every area ends the capture without a click.
    source.emit(sourceButtonEvent('release', 40, 40))
    expect(dragEnd).toHaveBeenCalledTimes(1)
    expect(dragEnd).toHaveBeenCalledWith({
      x: 40,
      y: 40,
      startX: 0,
      startY: 0,
    })
    expect(onClick).not.toHaveBeenCalled()
  })

  it('consumes hover on a disabled overlay while the drag continues', async () => {
    const A = { x: 0, y: 0, width: 2, height: 2 }
    const D = { x: 5, y: 5, width: 2, height: 2 }
    const aLeave = vi.fn()
    const dEnter = vi.fn()
    const dMove = vi.fn()
    const dragStart = vi.fn()
    const dragMove = vi.fn()
    const dragEnd = vi.fn()
    const onClick = vi.fn()
    const { stdin } = render(
      harness(
        <>
          <MouseProbe
            bounds={A}
            onClick={onClick}
            onLeave={aLeave}
            onDragStart={dragStart}
            onDragMove={dragMove}
            onDragEnd={dragEnd}
          />
          <MouseProbe
            bounds={D}
            disabled
            onEnter={dEnter}
            onMove={dMove}
          />
        </>,
      ),
    )

    await press(stdin, 1, 1)
    await move(stdin, 'none', 1, 1) // hover A
    await move(stdin, 'left', 6, 6) // (5, 5) — disabled topmost overlay

    // Hover left A and the disabled overlay consumed without callbacks; the
    // capture on A still received the motion.
    expect(aLeave).toHaveBeenCalledTimes(1)
    expect(dEnter).not.toHaveBeenCalled()
    expect(dMove).not.toHaveBeenCalled()
    expect(dragStart).toHaveBeenCalledTimes(1)
    expect(dragMove).toHaveBeenCalledTimes(1)

    await release(stdin, 6, 6)
    expect(dragEnd).toHaveBeenCalledTimes(1)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('clears a started capture on provider teardown without callbacks', async () => {
    const onClick = vi.fn()
    const start = vi.fn()
    const end = vi.fn()
    const cancel = vi.fn()
    const { stdin, unmount } = render(
      harness(
        <MouseProbe
          bounds={AREA}
          onClick={onClick}
          onDragStart={start}
          onDragEnd={end}
          onDragCancel={cancel}
        />,
      ),
    )

    await press(stdin, 1, 1)
    await move(stdin, 'left', 2, 2)
    expect(start).toHaveBeenCalledTimes(1)

    unmount()
    await delay()
    expect(cancel).not.toHaveBeenCalled()
    expect(end).not.toHaveBeenCalled()
    expect(onClick).not.toHaveBeenCalled()
  })

  it('reports move routing through the same diagnostics sink', async () => {
    const events: MouseDiagnosticEvent[] = []
    const { stdin } = render(
      harness(
        <MouseProbe
          bounds={AREA}
          onDragStart={() => {}}
          onDragMove={() => {}}
          onDragEnd={() => {}}
        />,
        undefined,
        (event) => events.push(event),
      ),
    )

    await press(stdin, 1, 1)
    await move(stdin, 'left', 2, 2)
    await release(stdin, 2, 2)

    expect(events.map((event) => `${event.action}:${event.reason}`)).toEqual([
      'press:press-pending',
      'move:drag-start',
      'release:drag-end',
    ])
    expect(events[1]).toMatchObject({
      action: 'move',
      x: 1,
      y: 1,
      dispatched: true,
      targetId: events[0]!.targetId,
      containingCount: 1,
    })
  })

  it('never hovers wheel-only regions and keeps wheel routing unchanged', () => {
    const source = fakeMouseEventSource()
    const WHEEL_AREA = { x: 0, y: 0, width: 4, height: 4 }
    const onWheel = vi.fn(() => true)
    const onEnter = vi.fn()
    render(
      harness(
        <>
          <MouseProbe bounds={WHEEL_AREA} onEnter={onEnter} />
          <WheelRegionProbe id={9101} bounds={WHEEL_AREA} onWheel={onWheel} />
        </>,
        undefined,
        undefined,
        source.source,
      ),
    )

    // The wheel region never shadows hover: the click area still receives it.
    source.emit(sourceMoveEvent('none', 1, 1))
    expect(onEnter).toHaveBeenCalledTimes(1)

    source.emit(sourceWheelEvent('down', 1, 1))
    expect(onWheel).toHaveBeenCalledTimes(1)
  })
})

describe('MouseProvider pointer mode lifecycle', () => {
  it('enables 1003/1006 and resets both modes in reverse order', () => {
    expect(MOUSE_ENABLE_SEQUENCE).toBe('\u001B[?1003h\u001B[?1006h')
    expect(MOUSE_RESET_SEQUENCE).toBe('\u001B[?1006l\u001B[?1003l')
  })
})
