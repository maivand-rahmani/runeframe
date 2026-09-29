import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { render as inkRender, Text } from 'ink'
import { render } from 'ink-testing-library'
import { useEffect, useRef } from 'react'
import type { ReactElement, ReactNode } from 'react'
import {
  KeyboardScopeProvider,
  useKeyboardScope,
} from './KeyboardScopeProvider.js'
import {
  DEFAULT_MOUSE_PREFIX_TIMEOUT_MS,
  MOUSE_ENABLE_SEQUENCE,
  MOUSE_RESET_SEQUENCE,
  MouseProvider,
} from './MouseProvider.js'
import { MouseArea, type MouseBounds, type MouseClickEvent } from './MouseArea.js'
import { useKeyHandler } from './useKeyHandler.js'
import { FocusTreeProvider } from './FocusTreeProvider.js'
import { useInputFocus } from './useInputFocus.js'
import {
  NavigationProvider,
  useNavigation,
} from '../navigation/NavigationProvider.js'
import { ScreenRegistry } from '../screens/registry.js'
import type { NormalizedKeyEvent } from '../types.js'

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

function harness(children: ReactNode, prefixTimeoutMs?: number) {
  return (
    <KeyboardScopeProvider>
      <NavigationProvider registry={registry} defaultScreen="home">
        <MouseProvider prefixTimeoutMs={prefixTimeoutMs}>
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
