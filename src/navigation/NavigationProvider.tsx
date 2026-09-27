import {
  createContext,
  useContext,
  useCallback,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react'
import type { ScreenDefinition } from '../screens/screen.js'
import type { ScreenRegistry } from '../screens/registry.js'

export interface NavigationEntry {
  screenId: string
  params: Record<string, unknown>
}

export interface ModalEntry<
  TProps extends Record<string, unknown> = Record<string, unknown>,
> {
  screenId: string
  props: TProps
}

interface NavigationStateValue {
  currentScreenId: string
  currentScreen: ScreenDefinition
  params: Record<string, unknown>
  registry: ScreenRegistry
  canGoBack: boolean
  breadcrumbs: NavigationEntry[]
}

interface NavigationActionsValue {
  push: (screenId: string, params?: Record<string, unknown>) => void
  pop: () => void
  popToRoot: () => void
  replace: (screenId: string, params?: Record<string, unknown>) => void
}

interface ModalStateValue {
  modalStack: ModalEntry[]
  isModalOpen: boolean
  currentModal: ScreenDefinition | null
  currentModalProps: Record<string, unknown>
}

interface ModalActionsValue {
  pushModal: <TProps extends Record<string, unknown>>(
    screenId: string,
    props?: TProps,
  ) => void
  popModal: () => void
  popAllModals: () => void
}

export interface NavigationContextValue
  extends NavigationStateValue,
    NavigationActionsValue,
    ModalStateValue,
    ModalActionsValue {}

const NavigationStateContext = createContext<NavigationStateValue | null>(null)
const NavigationActionsContext =
  createContext<NavigationActionsValue | null>(null)
const ModalStateContext = createContext<ModalStateValue | null>(null)
const ModalActionsContext = createContext<ModalActionsValue | null>(null)

export interface NavigationProviderProps {
  registry: ScreenRegistry
  defaultScreen: string
  children: ReactNode
}

interface RouteState {
  screenId: string
  params: Record<string, unknown>
}

interface NavigationProviderState {
  route: RouteState
  history: NavigationEntry[]
  modalStack: ModalEntry[]
}

type NavigationProviderAction =
  | { type: 'push'; entry: RouteState }
  | { type: 'pop' }
  | { type: 'popToRoot' }
  | { type: 'replace'; entry: RouteState }
  | { type: 'pushModal'; entry: ModalEntry }
  | { type: 'popModal' }
  | { type: 'popAllModals' }

function reducer(
  state: NavigationProviderState,
  action: NavigationProviderAction,
): NavigationProviderState {
  switch (action.type) {
    case 'push':
      return {
        ...state,
        history: [
          ...state.history,
          { screenId: state.route.screenId, params: state.route.params },
        ],
        route: action.entry,
      }
    case 'pop': {
      if (state.history.length === 0) return state
      const previous = state.history[state.history.length - 1]
      return {
        ...state,
        route: { screenId: previous.screenId, params: previous.params },
        history: state.history.slice(0, -1),
      }
    }
    case 'popToRoot': {
      if (state.history.length === 0) return state
      const root = state.history[0]
      return {
        ...state,
        route: { screenId: root.screenId, params: root.params },
        history: [],
      }
    }
    case 'replace':
      return { ...state, route: action.entry }
    case 'pushModal':
      return { ...state, modalStack: [...state.modalStack, action.entry] }
    case 'popModal': {
      if (state.modalStack.length === 0) return state
      return { ...state, modalStack: state.modalStack.slice(0, -1) }
    }
    case 'popAllModals':
      return state.modalStack.length === 0
        ? state
        : { ...state, modalStack: [] }
  }
}

function createInitialState(
  registry: ScreenRegistry,
  defaultScreen: string,
): NavigationProviderState {
  registry.get(defaultScreen)
  return {
    route: { screenId: defaultScreen, params: {} },
    history: [],
    modalStack: [],
  }
}

/**
 * Sole owner of route history and the modal stack.
 *
 * `registry` remains the registration mechanism for screen definitions;
 * `<ScreenOutlet>` renders the current route. Consumers read the combined
 * state/actions contract through `useNavigation()`.
 */
export function NavigationProvider({
  registry,
  defaultScreen,
  children,
}: NavigationProviderProps) {
  const [state, dispatch] = useReducer(reducer, undefined, () =>
    createInitialState(registry, defaultScreen),
  )

  const push = useCallback(
    (screenId: string, params?: Record<string, unknown>) => {
      registry.get(screenId)
      dispatch({ type: 'push', entry: { screenId, params: params ?? {} } })
    },
    [registry],
  )

  const pop = useCallback(() => {
    dispatch({ type: 'pop' })
  }, [])

  const popToRoot = useCallback(() => {
    dispatch({ type: 'popToRoot' })
  }, [])

  const replace = useCallback(
    (screenId: string, params?: Record<string, unknown>) => {
      registry.get(screenId)
      dispatch({ type: 'replace', entry: { screenId, params: params ?? {} } })
    },
    [registry],
  )

  const pushModal = useCallback(
    <TProps extends Record<string, unknown>>(
      screenId: string,
      props?: TProps,
    ) => {
      registry.get(screenId)
      dispatch({
        type: 'pushModal',
        entry: { screenId, props: (props ?? {}) as TProps },
      })
    },
    [registry],
  )

  const popModal = useCallback(() => {
    dispatch({ type: 'popModal' })
  }, [])

  const popAllModals = useCallback(() => {
    dispatch({ type: 'popAllModals' })
  }, [])

  const currentScreen = registry.get(state.route.screenId)
  const canGoBack = state.history.length > 0
  const breadcrumbs: NavigationEntry[] = useMemo(
    () => [
      ...state.history,
      { screenId: state.route.screenId, params: state.route.params },
    ],
    [state.history, state.route],
  )

  const currentModalEntry = state.modalStack[state.modalStack.length - 1]
  const currentModal = currentModalEntry
    ? registry.get(currentModalEntry.screenId)
    : null

  const navigationState = useMemo<NavigationStateValue>(
    () => ({
      currentScreenId: state.route.screenId,
      currentScreen,
      params: state.route.params,
      registry,
      canGoBack,
      breadcrumbs,
    }),
    [breadcrumbs, canGoBack, currentScreen, registry, state.route],
  )

  const navigationActions = useMemo<NavigationActionsValue>(
    () => ({ push, pop, popToRoot, replace }),
    [pop, popToRoot, push, replace],
  )

  const modalState = useMemo<ModalStateValue>(
    () => ({
      modalStack: state.modalStack,
      isModalOpen: state.modalStack.length > 0,
      currentModal,
      currentModalProps: currentModalEntry?.props ?? {},
    }),
    [currentModal, currentModalEntry, state.modalStack],
  )

  const modalActions = useMemo<ModalActionsValue>(
    () => ({ pushModal, popModal, popAllModals }),
    [popAllModals, popModal, pushModal],
  )

  return (
    <NavigationStateContext.Provider value={navigationState}>
      <NavigationActionsContext.Provider value={navigationActions}>
        <ModalStateContext.Provider value={modalState}>
          <ModalActionsContext.Provider value={modalActions}>
            {children}
          </ModalActionsContext.Provider>
        </ModalStateContext.Provider>
      </NavigationActionsContext.Provider>
    </NavigationStateContext.Provider>
  )
}

function useRequiredContext<T>(context: React.Context<T | null>, name: string): T {
  const value = useContext(context)
  if (!value) {
    throw new Error(`${name} must be used within a <NavigationProvider>.`)
  }
  return value
}

/**
 * Canonical combined navigation contract: route state, route actions,
 * modal state and modal actions in a single hook.
 */
export function useNavigation(): NavigationContextValue {
  const state = useRequiredContext(NavigationStateContext, 'useNavigation()')
  const actions = useRequiredContext(NavigationActionsContext, 'useNavigation()')
  const modalState = useRequiredContext(ModalStateContext, 'useNavigation()')
  const modalActions = useRequiredContext(
    ModalActionsContext,
    'useNavigation()',
  )

  return useMemo(
    () => ({ ...state, ...actions, ...modalState, ...modalActions }),
    [state, actions, modalState, modalActions],
  )
}
