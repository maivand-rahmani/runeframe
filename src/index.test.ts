import { describe, it, expect, expectTypeOf } from 'vitest'
import * as root from './index.js'
import type {
  ModalEntry,
  MouseAreaProps,
  MouseBounds,
  MouseClickEvent,
  NavigationContextValue,
  NavigationEntry,
  NavigationProviderProps,
  SessionEvent,
  SessionEventType,
  SessionLifecycle,
  SessionOptions,
  SessionStatus,
  UseAsyncSessionOptions,
  UseAsyncSessionResult,
} from './index.js'

// Compile-time guard: these type-only exports must not exist at the root.
// `@ts-expect-error` fails with TS2578 the moment any of them is re-exported.
// @ts-expect-error removed command-session generation
import type { CommandSessionAPI, CommandSessionMode, OutputLine, UseCommandSessionOptions } from './index.js'
// @ts-expect-error removed session alias names
import type { AsyncSessionOptions, AsyncSessionStatus } from './index.js'
// @ts-expect-error removed split navigation/modal state types
import type { ModalActionsValue, ModalStateValue, NavigationActionsValue, NavigationStateValue } from './index.js'
// @ts-expect-error removed screen-provider types
import type { ScreenContextValue, ScreenProviderProps } from './index.js'
// @ts-expect-error removed CommandBar props
import type { CommandBarProps } from './index.js'
// @ts-expect-error mouse provider internals stay private
import type { MouseProviderProps } from './index.js'

describe('public barrel', () => {
  it('exposes the canonical focus/input contract', () => {
    expect(typeof root.FrameworkProvider).toBe('function')
    expect(typeof root.useFocusZone).toBe('function')
    expect(typeof root.useFocusGroup).toBe('function')
    expect(typeof root.useFocusable).toBe('function')
    expect(typeof root.useKeyHandler).toBe('function')
    expect(typeof root.useKeyBinding).toBe('function')
    expect(root.InputConsumptionResult.Consumed).toBe(1)
    expect(root.KEY_ENTER).toBe('enter')
    expect(typeof root.normalizeKey).toBe('function')
  })

  it('exposes the canonical mouse-area primitive', () => {
    expect(typeof root.MouseArea).toBe('function')
  })

  it('exposes the canonical navigation/screens contract', () => {
    expect(typeof root.NavigationProvider).toBe('function')
    expect(typeof root.useNavigation).toBe('function')
    expect(typeof root.ScreenRegistry).toBe('function')
    expect(typeof root.ScreenOutlet).toBe('function')
    expect(typeof root.ModalProvider).toBe('function')
    expect(typeof root.useModal).toBe('function')
  })

  it('exposes the canonical async session/process contract', () => {
    expect(typeof root.AsyncSessionRunner).toBe('function')
    expect(typeof root.useAsyncSession).toBe('function')
    expect(root.DEFAULT_MAX_OUTPUT_LINES).toBe(500)
    expect(typeof root.NodeProcessRunner).toBe('function')
    expect(typeof root.ProcessOutputPanel).toBe('function')
  })

  it('exposes the canonical public types', () => {
    expectTypeOf<NavigationContextValue>().toBeObject()
    expectTypeOf<NavigationEntry>().toBeObject()
    expectTypeOf<ModalEntry>().toBeObject()
    expectTypeOf<NavigationProviderProps>().toBeObject()
    expectTypeOf<SessionStatus>().toBeString()
    expectTypeOf<SessionOptions>().toBeObject()
    expectTypeOf<SessionEvent>().toBeObject()
    expectTypeOf<SessionEventType>().toBeString()
    expectTypeOf<SessionLifecycle>().toBeObject()
    expectTypeOf<UseAsyncSessionOptions>().toBeObject()
    expectTypeOf<UseAsyncSessionResult>().toBeObject()
    expectTypeOf<MouseAreaProps>().toBeObject()
    expectTypeOf<MouseBounds>().toBeObject()
    expectTypeOf<MouseClickEvent>().toBeObject()
  })

  it('does not export any removed legacy generation', () => {
    // FocusScope generation
    expect(root).not.toHaveProperty('FocusScope')
    expect(root).not.toHaveProperty('useFocusScope')

    // v2-suffixed focus API (renamed to canonical useFocusable)
    expect(root).not.toHaveProperty('useFocusableV2')

    // Region generation
    expect(root).not.toHaveProperty('RegionProvider')
    expect(root).not.toHaveProperty('useRegionContext')
    expect(root).not.toHaveProperty('useFocusableRegion')
    expect(root).not.toHaveProperty('useInputInRegion')
    expect(root).not.toHaveProperty('useScopedInputInRegion')

    // Raw scope input hooks
    expect(root).not.toHaveProperty('useInputInScope')
    expect(root).not.toHaveProperty('useScopedInputInScope')

    // Focus zone context was internalized in Phase 1
    expect(root).not.toHaveProperty('FocusZoneContext')

    // ScreenProvider generation replaced by useNavigation + ScreenOutlet
    expect(root).not.toHaveProperty('ScreenProvider')
    expect(root).not.toHaveProperty('useScreen')
    expect(root).not.toHaveProperty('ScreenRenderer')

    // Split navigation/modal hooks replaced by useNavigation
    expect(root).not.toHaveProperty('useNavigationState')
    expect(root).not.toHaveProperty('useNavigationActions')
    expect(root).not.toHaveProperty('useModalState')
    expect(root).not.toHaveProperty('useModalActions')

    // Command session generation replaced by useAsyncSession
    expect(root).not.toHaveProperty('useCommandSession')
    expect(root).not.toHaveProperty('CommandBar')
  })

  it('keeps mouse provider and parser internals private', () => {
    expect(root).not.toHaveProperty('MouseProvider')
    expect(root).not.toHaveProperty('useMouseRegistry')
    expect(root).not.toHaveProperty('MouseInputParser')
  })
})
