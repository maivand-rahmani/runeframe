import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  useId,
  useMemo,
  type ReactNode,
} from 'react'
import type { FocusScope } from '../types.js'
import { InputConsumptionResult } from '../types.js'
import { getScopePriority } from '../constants.js'
import { useKeyboardScope } from './KeyboardScopeProvider.js'
import { useKeyHandler } from './useKeyHandler.js'

// ── Zone Context ──

export interface FocusZoneContextValue {
  zoneId: string
  activeGroupId: string | null
  isActive: boolean
  setActiveGroup: (id: string) => void
  /** Set the initial active group without replacing an existing selection. */
  registerGroup: (id: string) => () => void
  /** Activate this zone in the focus tree. */
  activate: () => void
  /** Register or update the focused item for a group within this zone. */
  updateGroupFocused: (groupId: string, focusableId: string | null) => void
  /** Helper to get the deepest active focusable ID within this zone. */
  getDeepestActiveFocusable: () => string | null
}

export const FocusZoneContext = createContext<FocusZoneContextValue | null>(null)

// ── Group Context ──

export interface FocusGroupContextValue {
  groupId: string
  focusedId: string | null
  register: (id: string) => () => void
  focus: (id: string) => void
  isActive: boolean
  isFirst: (id: string) => boolean
  isLast: (id: string) => boolean
}

const FocusGroupContext = createContext<FocusGroupContextValue | null>(null)

type FocusZoneOrientation = 'horizontal' | 'vertical'

interface FocusTreeZoneRegistration {
  zoneId: string
  scope: FocusScope
  orientation?: FocusZoneOrientation
  order?: number
  registrationOrder: number
}

interface FocusTreeContextValue {
  activeZoneId: string | null
  registerZone: (
    zone: Omit<FocusTreeZoneRegistration, 'registrationOrder'>,
  ) => () => void
  activateZone: (zoneId: string) => void
  isScopeEligible: (scope: FocusScope, activeScopes: FocusScope[]) => boolean
  moveZone: (
    zoneId: string,
    scope: FocusScope,
    key: 'tab' | 'left' | 'right',
    direction?: 1 | -1,
  ) => boolean
}

const FocusTreeContext = createContext<FocusTreeContextValue | null>(null)

// ── useFocusZone ──

export interface UseFocusZoneOptions {
  autoFocus?: boolean
  scope?: FocusScope
  /** Whether this zone participates in horizontal arrow-key navigation. */
  orientation?: FocusZoneOrientation
  /** Sort order for Tab and configured directional navigation. */
  order?: number
  /** Internal/base zones can opt out of keyboard zone navigation. */
  navigable?: boolean
}

export interface UseFocusZoneResult {
  zoneId: string
  isActive: boolean
  activate: () => void
  /** Wrapper component that provides FocusZoneContext to children. */
  ZoneProvider: (props: { children: ReactNode }) => ReactNode
}

/**
 * Declare a zone (shell container, region, modal overlay).
 * Zones nest naturally through React tree position.
 */
export function useFocusZone(
  id: string,
  options: UseFocusZoneOptions = {},
): UseFocusZoneResult {
  const scope = (options.scope ?? id) as FocusScope
  const { isScopeActive, activeScopes, pushScope } = useKeyboardScope()
  const tree = useContext(FocusTreeContext)
  const autoFocus = options.autoFocus ?? false
  const orientation = options.orientation
  const order = options.order
  const navigable = options.navigable ?? true

  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
  const groupFocusedRef = useRef<Map<string, string | null>>(new Map())
  const groupIdsRef = useRef<string[]>([])

  const setActiveGroup = useCallback((gid: string) => {
    setActiveGroupId(gid)
  }, [])

  const registerGroup = useCallback((groupId: string) => {
    if (!groupIdsRef.current.includes(groupId)) {
      groupIdsRef.current = [...groupIdsRef.current, groupId]
    }
    setActiveGroupId((current) => current ?? groupId)

    return () => {
      groupIdsRef.current = groupIdsRef.current.filter((id) => id !== groupId)
      groupFocusedRef.current.delete(groupId)
      setActiveGroupId((current) =>
        current === groupId ? (groupIdsRef.current[0] ?? null) : current,
      )
    }
  }, [])

  const updateGroupFocused = useCallback(
    (groupId: string, focusableId: string | null) => {
      groupFocusedRef.current.set(groupId, focusableId)
    },
    [],
  )

  const getDeepestActiveFocusable = useCallback((): string | null => {
    if (!activeGroupId) return null
    return groupFocusedRef.current.get(activeGroupId) ?? null
  }, [activeGroupId])

  const activate = useCallback(() => {
    pushScope(scope)
    if (navigable) tree?.activateZone(id)
  }, [id, scope, pushScope, tree?.activateZone, navigable])

  const isActive =
    !navigable ||
    (isScopeActive(scope) &&
      (!tree ||
        (tree.isScopeEligible(scope, activeScopes) && tree.activeZoneId === id)))

  useEffect(() => {
    if (!tree || !navigable) return
    return tree.registerZone({ zoneId: id, scope, orientation, order })
  }, [tree?.registerZone, id, scope, orientation, order, navigable])

  useKeyHandler(
    (event) => {
      if (
        !tree ||
        !navigable ||
        !tree.isScopeEligible(scope, activeScopes)
      ) {
        return InputConsumptionResult.NotConsumed
      }
      if (event.tab) {
        return tree.moveZone(id, scope, 'tab', event.shift ? -1 : 1)
          ? InputConsumptionResult.Consumed
          : InputConsumptionResult.NotConsumed
      }
      if (orientation !== 'horizontal') {
        return InputConsumptionResult.NotConsumed
      }
      if (event.left) {
        return tree.moveZone(id, scope, 'left')
          ? InputConsumptionResult.Consumed
          : InputConsumptionResult.NotConsumed
      }
      if (event.right) {
        return tree.moveZone(id, scope, 'right')
          ? InputConsumptionResult.Consumed
          : InputConsumptionResult.NotConsumed
      }
      return InputConsumptionResult.NotConsumed
    },
    scope,
    {
      enabled: tree != null && navigable && isScopeActive(scope),
      priority: -100,
    },
  )

  const ctxValueRef = useRef<FocusZoneContextValue>({
    zoneId: id,
    activeGroupId,
    isActive,
    setActiveGroup,
    registerGroup,
    activate,
    updateGroupFocused,
    getDeepestActiveFocusable,
  })
  ctxValueRef.current = {
    zoneId: id,
    activeGroupId,
    isActive,
    setActiveGroup,
    registerGroup,
    activate,
    updateGroupFocused,
    getDeepestActiveFocusable,
  }

  const autoFocusRef = useRef(autoFocus)
  autoFocusRef.current = autoFocus

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ZoneProvider = useCallback(
    function ZoneProviderWrapper({ children }: { children: ReactNode }) {
      useEffect(() => {
        if (autoFocusRef.current) {
          pushScope(scope)
          if (navigable) tree?.activateZone(id)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      return (
        <FocusZoneContext.Provider value={ctxValueRef.current}>
          {children}
        </FocusZoneContext.Provider>
      )
    },
    [scope, pushScope, tree?.activateZone, id, navigable],
  )

  return { zoneId: id, isActive, activate, ZoneProvider }
}

// ── useFocusGroup ──

export interface UseFocusGroupOptions {
  autoFocus?: boolean
  scope?: FocusScope
}

export interface UseFocusGroupResult {
  groupId: string
  isActive: boolean
  focusedId: string | null
  focusNext: () => void
  focusPrev: () => void
  activate: () => void
  /** Wrapper component that provides FocusGroupContext to children. */
  GroupProvider: (props: { children: ReactNode }) => ReactNode
}

/**
 * Declare a focus group (list of items, tab strip, choice options).
 * Groups exist within zones and manage roving focus among their items.
 */
export function useFocusGroup(
  id: string,
  options: UseFocusGroupOptions = {},
): UseFocusGroupResult {
  const scope = (options.scope ?? id) as FocusScope
  const { pushScope, isScopeActive: keyboardIsScopeActive } = useKeyboardScope()
  const autoFocus = options.autoFocus ?? false

  const zoneCtx = useContext(FocusZoneContext)
  const registerZoneGroup = zoneCtx?.registerGroup
  const setZoneActiveGroup = zoneCtx?.setActiveGroup
  const activateZone = zoneCtx?.activate
  const updateZoneGroupFocused = zoneCtx?.updateGroupFocused

  const [focusedId, setFocusedId] = useState<string | null>(null)
  const itemsRef = useRef<string[]>([])
  const [itemsVersion, setItemsVersion] = useState(0)

  useEffect(() => {
    if (!registerZoneGroup) return
    return registerZoneGroup(id)
  }, [id, registerZoneGroup])

  useEffect(() => {
    if (!updateZoneGroupFocused) return
    updateZoneGroupFocused(id, focusedId)
  }, [id, focusedId, updateZoneGroupFocused])

  const isActive =
    keyboardIsScopeActive(scope) &&
    (zoneCtx ? zoneCtx.isActive && zoneCtx.activeGroupId === id : true)

  const register = useCallback((itemId: string) => {
    if (!itemsRef.current.includes(itemId)) {
      itemsRef.current = [...itemsRef.current, itemId]
      setItemsVersion((n) => n + 1)
    }
    return () => {
      itemsRef.current = itemsRef.current.filter((c) => c !== itemId)
      setFocusedId((prev) => (prev === itemId ? null : prev))
      setItemsVersion((n) => n + 1)
    }
  }, [])

  const focus = useCallback((itemId: string) => {
    setFocusedId(itemId)
  }, [])

  const focusNext = useCallback(() => {
    setFocusedId((prev) => {
      const items = itemsRef.current
      if (items.length === 0) return prev
      if (prev === null) return items[0]
      const idx = items.indexOf(prev)
      if (idx === -1) return items[0]
      return items[(idx + 1) % items.length]
    })
  }, [])

  const focusPrev = useCallback(() => {
    setFocusedId((prev) => {
      const items = itemsRef.current
      if (items.length === 0) return prev
      if (prev === null) return items[items.length - 1]
      const idx = items.indexOf(prev)
      if (idx === -1) return items[0]
      return items[(idx - 1 + items.length) % items.length]
    })
  }, [])

  const isFirst = useCallback(
    (itemId: string) => {
      const items = itemsRef.current
      return items.length > 0 && items[0] === itemId
    },
    [],
  )

  const isLast = useCallback(
    (itemId: string) => {
      const items = itemsRef.current
      return items.length > 0 && items[items.length - 1] === itemId
    },
    [],
  )

  const activate = useCallback(() => {
    pushScope(scope)
    setZoneActiveGroup?.(id)
    activateZone?.()
  }, [scope, id, pushScope, setZoneActiveGroup, activateZone])

  useEffect(() => {
    if (autoFocus) {
      pushScope(scope)
      setZoneActiveGroup?.(id)
      activateZone?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Preserve the classic `autoFocus` intent: the first registered item
  // receives roving focus (and the first remaining item after removals).
  useEffect(() => {
    if (autoFocus && focusedId === null && itemsRef.current.length > 0) {
      setFocusedId(itemsRef.current[0])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus, focusedId, itemsVersion])

  useKeyHandler(
    (event) => {
      if (!isActive) return InputConsumptionResult.NotConsumed
      if (event.up) {
        focusPrev()
        return InputConsumptionResult.Consumed
      }
      if (event.down) {
        focusNext()
        return InputConsumptionResult.Consumed
      }
      return InputConsumptionResult.NotConsumed
    },
    scope,
    { deps: [focusNext, focusPrev, isActive, scope] },
  )

  const ctxValueRef = useRef<FocusGroupContextValue>({
    groupId: id,
    focusedId,
    register,
    focus,
    isActive,
    isFirst,
    isLast,
  })
  ctxValueRef.current = {
    groupId: id,
    focusedId,
    register,
    focus,
    isActive,
    isFirst,
    isLast,
  }

  const autoFocusRef = useRef(autoFocus)
  autoFocusRef.current = autoFocus

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const GroupProvider = useCallback(
    function GroupProviderWrapper({ children }: { children: ReactNode }) {
      return (
        <FocusGroupContext.Provider value={ctxValueRef.current}>
          {children}
        </FocusGroupContext.Provider>
      )
    },
    [id],
  )

  return {
    groupId: id,
    isActive,
    focusedId,
    focusNext,
    focusPrev,
    activate,
    GroupProvider,
  }
}

// ── useFocusable ──

export interface UseFocusableOptions {
  id?: string
}

export interface UseFocusableResult {
  focused: boolean
  onActivate: () => void
  isFirst: boolean
  isLast: boolean
  id: string
}

/**
 * Declare a focusable leaf item within a group.
 * Replaces the old useFocusable but with explicit group registration.
 */
export function useFocusable(
  options: UseFocusableOptions = {},
): UseFocusableResult {
  const internalId = useId()
  const stableIdRef = useRef(options.id ?? `focusable-${internalId}`)
  const id = stableIdRef.current

  const groupCtx = useContext(FocusGroupContext)

  if (!groupCtx) {
    return {
      focused: false,
      onActivate: () => {},
      isFirst: false,
      isLast: false,
      id,
    }
  }

  const { register, focus, focusedId, isFirst, isLast } = groupCtx

  useEffect(() => {
    return register(id)
  }, [id, register])

  const onActivate = useCallback(() => {
    focus(id)
  }, [id, focus])

  const focused = focusedId === id

  return {
    focused,
    onActivate,
    isFirst: isFirst(id),
    isLast: isLast(id),
    id,
  }
}

// ── Input Focus Bridge ──

/**
 * Internal focus state shared by editable controls (text, number, search and
 * command inputs). `null` outside `FocusTreeProvider`; `useInputFocus` then
 * keeps the legacy solitary-control behavior for lightweight standalone use.
 */
export interface InputFocusContextValue {
  /** The single keyboard-enabled editable control, or `null` when none. */
  activeId: string | null
  /**
   * Register an editable control. The first registration receives default
   * focus. Returns an idempotent unregister that hands focus to the first
   * remaining registration when the active control leaves.
   */
  registerInput: (id: string) => () => void
  /** Make one editable control the sole keyboard-enabled field. */
  focusInput: (id: string) => void
}

export const InputFocusContext =
  createContext<InputFocusContextValue | null>(null)

/**
 * Owns the shared editable-control focus leaf. Exactly one registered control
 * at a time is keyboard-enabled: the first registration receives default focus
 * (preserving single-field typing without clicks), `focusInput` moves the leaf,
 * and unregistering the active control selects the first remaining registered
 * field or no leaf at all. Unregistering an inactive control never moves focus.
 */
function InputFocusBridge({ children }: { children: ReactNode }) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const inputIdsRef = useRef<string[]>([])

  const registerInput = useCallback((id: string) => {
    if (!inputIdsRef.current.includes(id)) {
      inputIdsRef.current = [...inputIdsRef.current, id]
    }
    // First registration wins default focus; later registrations never steal
    // focus from the current active leaf.
    setActiveId((current) => current ?? id)

    return () => {
      inputIdsRef.current = inputIdsRef.current.filter(
        (candidate) => candidate !== id,
      )
      setActiveId((current) =>
        current === id ? (inputIdsRef.current[0] ?? null) : current,
      )
    }
  }, [])

  const focusInput = useCallback((id: string) => {
    setActiveId(id)
  }, [])

  const value = useMemo<InputFocusContextValue>(
    () => ({ activeId, registerInput, focusInput }),
    [activeId, registerInput, focusInput],
  )

  return (
    <InputFocusContext.Provider value={value}>
      {children}
    </InputFocusContext.Provider>
  )
}

// ── FocusTreeProvider ──

export interface FocusTreeProviderProps {
  children: ReactNode
  defaultScope?: FocusScope
}

function getOrderedZones(
  zones: Map<string, FocusTreeZoneRegistration>,
  scope?: FocusScope,
  orientation?: FocusZoneOrientation,
): FocusTreeZoneRegistration[] {
  return [...zones.values()]
    .filter(
      (zone) =>
        (scope == null || zone.scope === scope) &&
        (orientation == null || zone.orientation === orientation),
    )
    .sort((left, right) => {
      const orderDiff = (left.order ?? 0) - (right.order ?? 0)
      return orderDiff || left.registrationOrder - right.registrationOrder
    })
}

function RootFocusZone({
  children,
  scope,
}: {
  children: ReactNode
  scope: FocusScope
}) {
  const { ZoneProvider } = useFocusZone('__root', {
    scope,
    navigable: false,
  })
  return <ZoneProvider>{children}</ZoneProvider>
}

/**
 * Root focus tree provider. Wraps children in a default zone context and
 * coordinates keyboard movement between registered focus zones.
 */
export function FocusTreeProvider({
  children,
  defaultScope = 'navigation',
}: FocusTreeProviderProps) {
  const [activeZoneId, setActiveZoneId] = useState<string | null>(null)
  const [registryVersion, setRegistryVersion] = useState(0)
  const activeZoneIdRef = useRef<string | null>(activeZoneId)
  activeZoneIdRef.current = activeZoneId
  const zonesRef = useRef<Map<string, FocusTreeZoneRegistration>>(new Map())
  const registrationOrderRef = useRef(0)
  const hasExplicitZoneRef = useRef(false)

  const setZone = useCallback((zoneId: string | null, explicit: boolean) => {
    activeZoneIdRef.current = zoneId
    hasExplicitZoneRef.current = explicit
    setActiveZoneId(zoneId)
  }, [])

  const selectDefaultZone = useCallback(() => {
    if (hasExplicitZoneRef.current) return
    const firstZone = getOrderedZones(zonesRef.current)[0]
    setZone(firstZone?.zoneId ?? null, false)
  }, [setZone])

  const registerZone = useCallback(
    (zone: Omit<FocusTreeZoneRegistration, 'registrationOrder'>) => {
      const registration: FocusTreeZoneRegistration = {
        ...zone,
        registrationOrder: registrationOrderRef.current++,
      }
      zonesRef.current.set(zone.zoneId, registration)
      setRegistryVersion((version) => version + 1)
      selectDefaultZone()

      return () => {
        if (zonesRef.current.get(zone.zoneId) !== registration) return
        zonesRef.current.delete(zone.zoneId)
        setRegistryVersion((version) => version + 1)
        if (activeZoneIdRef.current === zone.zoneId) {
          hasExplicitZoneRef.current = false
        }
        selectDefaultZone()
      }
    },
    [selectDefaultZone],
  )

  const activateZone = useCallback(
    (zoneId: string) => setZone(zoneId, true),
    [setZone],
  )

  const isScopeEligible = useCallback(
    (scope: FocusScope, activeScopes: FocusScope[]) => {
      const registeredScopes = [
        ...new Set(
          [...zonesRef.current.values()]
            .map((zone) => zone.scope)
            .filter((zoneScope) => activeScopes.includes(zoneScope)),
        ),
      ]
      if (registeredScopes.length === 0) return false

      // A modal scope blocks background zone navigation even when the modal
      // content does not declare a focus zone of its own.
      if (
        activeScopes.includes('modal') &&
        !registeredScopes.includes('modal')
      ) {
        return false
      }

      const highestPriority = Math.min(
        ...registeredScopes.map(getScopePriority),
      )
      const highestPriorityScopes = registeredScopes.filter(
        (zoneScope) => getScopePriority(zoneScope) === highestPriority,
      )
      const preferredScope = highestPriorityScopes.reduce((preferred, candidate) =>
        activeScopes.lastIndexOf(candidate) > activeScopes.lastIndexOf(preferred)
          ? candidate
          : preferred,
      )
      return preferredScope === scope
    },
    [],
  )

  const moveZone = useCallback(
    (
      zoneId: string,
      scope: FocusScope,
      key: 'tab' | 'left' | 'right',
      direction: 1 | -1 = 1,
    ): boolean => {
      const activeId = activeZoneIdRef.current
      if (key !== 'tab' && activeId !== zoneId) return false
      const ordered =
        key === 'tab'
          ? getOrderedZones(zonesRef.current, scope)
          : getOrderedZones(zonesRef.current, scope, 'horizontal')
      if (ordered.length === 0) return false

      // A handler is only allowed to navigate for its active zone. When no
      // zone from this scope is active yet, only the first registered zone
      // dispatches, avoiding duplicate navigation across sibling handlers.
      if (activeId != null && ordered.some((zone) => zone.zoneId === activeId)) {
        if (activeId !== zoneId) return false
      } else if (ordered[0].zoneId !== zoneId) {
        return false
      }

      const activeIndex = ordered.findIndex((zone) => zone.zoneId === activeId)
      if (key === 'tab') {
        let nextIndex: number
        if (activeIndex < 0) {
          nextIndex = direction > 0 ? 0 : ordered.length - 1
        } else {
          nextIndex =
            (activeIndex + direction + ordered.length) % ordered.length
        }
        setZone(ordered[nextIndex].zoneId, true)
        return true
      }

      // Horizontal movement stops at either edge instead of wrapping.
      if (activeIndex < 0) return false
      const nextIndex = activeIndex + (key === 'right' ? 1 : -1)
      if (nextIndex < 0 || nextIndex >= ordered.length) return true
      setZone(ordered[nextIndex].zoneId, true)
      return true
    },
    [setZone],
  )

  const treeContext = useMemo<FocusTreeContextValue>(
    () => ({ activeZoneId, registerZone, activateZone, isScopeEligible, moveZone }),
    [activeZoneId, registryVersion, registerZone, activateZone, isScopeEligible, moveZone],
  )

  return (
    <FocusTreeContext.Provider value={treeContext}>
      <InputFocusBridge>
        <RootFocusZone scope={defaultScope}>{children}</RootFocusZone>
      </InputFocusBridge>
    </FocusTreeContext.Provider>
  )
}
