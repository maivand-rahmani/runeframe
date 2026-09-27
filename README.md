# Runeframe

Runeframe 0.5 is a reusable Ink/React framework for building keyboard-first terminal applications: screen navigation, a hierarchical focus tree, scoped keyboard handling and actions, composable widgets, and async process sessions.

- **ESM-only.** Runeframe ships ECMAScript modules and nothing else. Use `import` (or dynamic `await import(...)`). There is no CommonJS entry point, so `require('runeframe')` does not work.
- **Node.js `>= 22.0.0`.**
- **Peer dependencies:** `ink ^7.0.2` and `react ^19.2.5`.

## Install

```bash
npm install runeframe
```

Install the peer dependencies in your application if your package manager does not install them automatically:

```bash
npm install ink react
```

Two entry points are published:

```ts
import { FrameworkProvider, ScreenRegistry } from 'runeframe'
import { KeyboardRegistry, ScreenTransition } from 'runeframe/experimental'
```

Both entries are import-only ESM. The package `exports` map exposes only `types` and `import` conditions.

## Quickstart

```tsx
import React from 'react'
import { Text, render } from 'ink'
import {
  AppShell,
  FrameworkProvider,
  ScreenOutlet,
  ScreenRegistry,
  TopBar,
  useNavigation,
} from 'runeframe'

const registry = new ScreenRegistry()
registry.register({
  id: 'home',
  title: 'Home',
  sidebar: true,
  category: 'main',
  component: () => <Text>Hello from Runeframe</Text>,
})

function Shell() {
  const { currentScreen } = useNavigation()
  return (
    <AppShell topBar={<TopBar appName="My App" screenTitle={currentScreen.title} />}>
      <ScreenOutlet />
    </AppShell>
  )
}

export function App() {
  return (
    <FrameworkProvider registry={registry} defaultScreen="home">
      <Shell />
    </FrameworkProvider>
  )
}

render(<App />)
```

## FrameworkProvider

`FrameworkProvider` is the single composition root for an application. Every capability is always enabled; there are no opt-in composition flags.

Provider order (outermost → innermost):

1. `ThemeProvider` — design tokens (`themeMode: 'dark' | 'light'`, default `'dark'`).
2. `KeyboardScopeProvider` — scope stack for keyboard dispatch.
3. `FocusTreeProvider` — hierarchical focus zones/groups/focusables.
4. `ScopedActionRegistryProvider` — action registration for hint bars and collision checks.
5. `NavigationProvider` — screen registry, route history, and the modal stack.
6. `MouseProvider` — mouse area hit-testing registry.
7. `ToastProvider` — toast host.
8. `ModalProvider` — modal host (`onModalClose` callback).

```tsx
<FrameworkProvider
  registry={registry}
  defaultScreen="home"
  themeMode="dark"
  onModalClose={() => {}}
>
  <App />
</FrameworkProvider>
```

`FrameworkProviderProps`: `registry`, `defaultScreen`, `children`, `themeMode?`, `onModalClose?`.

The lower-level providers are exported individually for manual composition (`ThemeProvider`, `KeyboardScopeProvider`, `FocusTreeProvider`, `ScopedActionRegistryProvider`, `NavigationProvider`, `ModalProvider`, `ToastProvider`). `MouseProvider` is internal and not a root export, so only `FrameworkProvider` assembles the complete supported stack, including mouse hit-testing.

## Screens and navigation

### Screen definitions

`ScreenRegistry` is a plain class (not a React component). It is passed to `FrameworkProvider` / `NavigationProvider`.

```tsx
const registry = new ScreenRegistry()
registry.register({
  id: 'home',
  title: 'Home',
  shortcut: 'h',
  component: ({ params }) => <HomeScreen params={params} />,
  sidebar: true,
  category: 'main',
})
```

`ScreenDefinition`: `id`, `title`, `component`, `shortcut?`, `sidebar?`, `category?`. `ScreenCategory` is `'main' | 'learning' | 'system'`. The `component` receives `{ params, modalProps, closeModal? }`.

`ScreenRegistry` methods: `register(def)`, `get(id)`, `has(id)`, `getAll()`, `getAllByCategory(category)`, `unregister(id)`.

`ScreenOutlet` renders the `component` of the screen registered under the current route. It must be rendered inside `NavigationProvider` (normally via `FrameworkProvider`).

### useNavigation

`useNavigation()` returns the combined navigation state and actions:

| Group | Members |
| --- | --- |
| State | `currentScreenId`, `currentScreen`, `params`, `registry`, `canGoBack`, `breadcrumbs` |
| Actions | `push(screenId, params?)`, `pop()`, `popToRoot()`, `replace(screenId, params?)` |
| Modal state | `modalStack`, `isModalOpen`, `currentModal`, `currentModalProps` |
| Modal actions | `pushModal(screenId, props?)`, `popModal()`, `popAllModals()` |

```tsx
function Home() {
  const { push, canGoBack, pop, currentScreen } = useNavigation()

  useKeyBinding('s', () => push('settings', { tab: 'general' }), 'navigation')
  useKeyBinding('escape', () => canGoBack && pop(), 'navigation')

  return <Text>{currentScreen.title}</Text>
}
```

Modal props reach a rendered modal screen through the screen component's `modalProps` argument. `useModal()` returns `{ openModal, closeModal, isOpen, currentModal }` for controlling the modal host directly.

## Keyboard handling

### Scopes

Keyboard events are dispatched through a scope stack, deepest first. Built-in scopes:

`'navigation' | 'list' | 'command' | 'modal' | 'textinput' | 'process'`

`FocusScope` accepts those built-ins plus any custom string scope.

### useKeyHandler and useKeyBinding

```tsx
import { InputConsumptionResult, useKeyHandler, useKeyBinding } from 'runeframe'

function Screen() {
  useKeyHandler(
    (event) => {
      if (!event.enter) return false
      openItem()
      return true // consumed
    },
    'navigation',
    { priority: 70 },
  )

  useKeyBinding('p', () => openPalette(), 'navigation', {
    modifiers: { ctrl: true },
  })

  return null
}
```

- `useKeyHandler(handler, scope, options?)` — receives a `NormalizedKeyEvent`; return `true`, `InputConsumptionResult.Consumed`, or `InputConsumptionResult.ConsumedAndTrapped` to consume. Options: `priority?`, `enabled?`, `deps?`.
- `useKeyBinding(key, handler, scope, options?)` — fires when the normalized key equals `key` (`'b'`, `'enter'`, `'escape'`, `'space'`, `'up'`, ...). `options.modifiers` (`ctrl?`, `alt?`, `shift?`, `meta?`) enables modifier matching; without `modifiers`, events carrying ctrl/alt/meta are ignored.
- `useKeyboardScope()` returns the scope-stack API: `activeScope`, `activeScopes`, `activateScope`, `pushScope`, `popScope`, `isScopeActive`, `registerHandler`, `suspendShell`, `restoreShell`.
- `useShellSuspension()` returns `{ suspend, restore, isSuspended }` so a widget can silence shell-level (`'navigation'`) shortcuts while it owns input.

`NormalizedKeyEvent` fields: `text`, `key`, `code`, `isPrintable`, `backspace`, `enter`, `escape`, `tab`, `space`, `up`, `down`, `left`, `right`, `ctrl`, `shift`, `alt`, `meta`, `rawInput`. `normalizeKey(input, key)` converts Ink's raw `(input, key)` tuple, and `KEY_ENTER`, `KEY_ESCAPE`, `KEY_TAB`, `KEY_BACKSPACE`, `KEY_DELETE`, `KEY_UP`, `KEY_DOWN`, `KEY_LEFT`, `KEY_RIGHT`, `KEY_SPACE` are exported key constants.

### Consumption results

| Value | Meaning |
| --- | --- |
| `InputConsumptionResult.NotConsumed` (`0`) | Continue to the next handler. |
| `InputConsumptionResult.Consumed` (`1`) | Stop propagation to siblings; unrelated scopes may still handle the event. |
| `InputConsumptionResult.ConsumedAndTrapped` (`2`) | Stop all further propagation. |

## Focus tree

`FocusTreeProvider` is composed by `FrameworkProvider`. `useFocusZone` groups a region of the UI, `useFocusGroup` manages list-like navigation inside a zone, and `useFocusable` marks an individual item.

```tsx
function Panel() {
  const { ZoneProvider } = useFocusZone('content', { orientation: 'vertical' })
  return (
    <ZoneProvider>
      <Items />
    </ZoneProvider>
  )
}

function Items() {
  const { GroupProvider, focusedId, focusNext, focusPrev } = useFocusGroup('items', {
    autoFocus: true,
  })
  return (
    <GroupProvider>
      {/* useFocusable() inside each row */}
    </GroupProvider>
  )
}

function Row() {
  const { focused, onActivate } = useFocusable()
  return <Text>{focused ? '> ' : '  '}row</Text>
}
```

- `useFocusZone(id, options?)` → `{ zoneId, isActive, activate, ZoneProvider }`. Options: `autoFocus?`, `scope?`, `orientation?`, `order?`, `navigable?`.
- `useFocusGroup(id, options?)` → `{ groupId, isActive, focusedId, focusNext, focusPrev, activate, GroupProvider }`. Options: `autoFocus?`, `scope?`.
- `useFocusable(options?)` → `{ id, focused, onActivate, isFirst, isLast }`.
- `FocusTreeProvider` props: `children`, `defaultScope?`.

## Scoped actions

Actions are declarative metadata for the UI: id, label, category, handler, and optional `keys`, `scope`, `enabled`, `visible`, and `group`. Use them to power hint bars and collision checks; wire the actual key handling with `useKeyHandler` / `useKeyBinding`.

```tsx
import {
  HotkeyHintBar,
  useKeyBinding,
  useRegisterActions,
} from 'runeframe'

function ScreenActions() {
  useRegisterActions([
    {
      id: 'open-palette',
      label: 'Open palette',
      category: 'navigation',
      keys: ['ctrl+p'],
      scope: 'navigation',
      handler: () => openPalette(),
    },
    {
      id: 'run',
      label: 'Run',
      category: 'context',
      keys: ['r'],
      scope: 'list',
      enabled: () => canRun(),
      handler: () => run(),
    },
  ])

  useKeyBinding('p', () => openPalette(), 'navigation', {
    modifiers: { ctrl: true },
  })
  useKeyBinding('r', () => run(), 'list')

  return <HotkeyHintBar scope="navigation" maxHints={8} />
}
```

- `useRegisterActions(actions)` — registers the action array once at mount. Action arrays are captured at mount, so remount the owning component (for example with `key`) when definitions change.
- `useActiveActions()` — currently enabled, visible actions.
- `useScopedActionRegistry()` — `{ getVisibleActions, getActionsByScope, registerActions, isActionAvailable, version }`.
- `ScopedActionRegistryProvider` props: `children`, `registry?` (`ActionRegistry`).
- `ActionRegistry` is the standalone registry class: `register`, `get`, `getAll`, `has`, `unregister`, `search(query)`, `getVisibleActions`, `getActionsByScope(scope)`, `isActionAvailable(id)`.
- `CommandPalette` props: `registry`, `onClose` — search overlay over an `ActionRegistry`.
- `detectCollisions(actions)` returns `CollisionWarning[]` for actions that route the same key in overlapping scopes.
- `HotkeyHintBar` props: `scope?`, `maxHints?` (default 8).

## Async sessions and process output

### ProcessRunner

`ProcessRunner` is the spawn abstraction; `NodeProcessRunner` is the default implementation (shell-enabled unless `new NodeProcessRunner({ shell: false })`).

```ts
interface ProcessRunner {
  spawn(command: string, args?: string[]): RunningProcess
}

interface RunningProcess {
  sendStdin(data: string): void
  kill(): void
  onStdout(cb: (data: string) => void): () => void
  onStderr(cb: (data: string) => void): () => void
  onExit(cb: (code: number | null) => void): () => void
}
```

When `args` is omitted, `command` is treated as a shell command line. Passing an explicit array (including `[]`) spawns `command` with exactly those arguments.

### useAsyncSession

`useAsyncSession({ runner, autoCleanup?, maxOutputLines? })` owns one `AsyncSessionRunner` for the component's lifetime and mirrors its bounded event stream into React state.

```tsx
const session = useAsyncSession({ runner })

session.start('npm test')
session.sendInput('y\n')
session.cancel()
```

Result:

| Member | Meaning |
| --- | --- |
| `status` | `'idle' \| 'starting' \| 'running' \| 'complete' \| 'error'` |
| `events` | Bounded event history including status/exit markers |
| `output` | `events` filtered to `stdout` / `stderr` |
| `exitCode` | Exit code of the last finished process, or `null` |
| `start(command, args?)` | Spawn a process, replacing any running one |
| `sendInput(data)` | Forward data to the running process's stdin |
| `cancel()` | Stop the running process and return to `idle` |
| `cleanup()` | Tear down the session and reset hook state to `idle` |
| `isRunning`, `isComplete`, `isError` | Derived status booleans |
| `lastEvent` | Most recent `SessionEvent`, or `null` |

`SessionEvent` is `{ type: 'stdout' | 'stderr' | 'status' | 'error' | 'exit', data, timestamp, exitCode? }`. `DEFAULT_MAX_OUTPUT_LINES` is `500`.

`AsyncSessionRunner` is also exported for non-React use: `new AsyncSessionRunner({ runner, maxOutputLines? })` with `start(command, args?, lifecycle?)`, `sendInput`, `cancel`, `cleanup`, `isRunning()`, `events`, `output`, `status`, and `exitCode`.

### ProcessOutputPanel

`ProcessOutputPanel` renders a session's event stream with status, active command, and a visible-line bound.

```tsx
<ProcessOutputPanel
  events={session.events}
  status={session.status}
  activeCommand={activeCommand}
  maxVisibleLines={500}
/>
```

Props: `events`, `status`, `activeCommand?`, `maxVisibleLines?` (default 500).

## Components

### Layout and structure

| Component | Props | Purpose |
| --- | --- | --- |
| `AppShell` | `topBar?`, `sidebar?`, `statusBar?`, `children`, `columns?`, `sidebarPosition?` (`'flow' \| 'fixed'`), `scrollContent?` | Top-level layout; hides the sidebar below 80 columns. `scrollContent` requires `sidebarPosition="fixed"`. |
| `TopBar` | `appName`, `screenTitle?`, `columns?` | Application header. |
| `StatusBar` | `mode?`, `columns?`, `registry?` | Bottom bar; can derive hints from an `ActionRegistry`. |
| `HotkeyHintBar` | `scope?`, `maxHints?` | Auto-generated hints from registered actions. |
| `Breadcrumbs` | `onSelect?`, `maxItems?`, `separator?` | Route trail from navigation state. |
| `Tabs` | `tabs`, `activeTabId`, `onChange`, `scope?` | Keyboard tab strip. |
| `Panel` | `title?`, `children` | Titled content panel. |
| `Card` | `children`, `variant?` (`'default' \| 'elevated'`) | Bordered content card. |
| `Section` | `label?`, `children` | Labeled section. |
| `Divider` | `label?` | Divider line. |
| `Spacer` | `size?` (`'sm' \| 'md' \| 'lg'`) | Vertical spacing. |
| `Badge` | `variant`, `children`, `compact?` | Status badge. |
| `Table` | `columns`, `rows`, `title?`, `width?` | Data table. |
| `EmptyState` | `title`, `description`, `hint?`, `action?` | Empty placeholder. |
| `LoadingState` | `label`, `detail?` | Loading indicator. |

### Button, List, RadioList, ListSelect, Sidebar

`Button` — keyboard-activatable action button.

| Prop | Type | Notes |
| --- | --- | --- |
| `children` | `ReactNode` | Label content. |
| `variant?` | `'default' \| 'primary' \| 'danger' \| 'ghost'` | Default `'default'`. |
| `disabled?` | `boolean` | Default `false`. |
| `focused?` | `boolean` | Renders the focus ring. |
| `onActivate?` | `() => void` | Fires on activation. |
| `mouseBounds?` | `MouseBounds` | Optional absolute bounds for mouse activation. |

`List` — selectable vertical list.

| Prop | Type | Notes |
| --- | --- | --- |
| `items` | `{ id, label, description? }[]` | Rows. |
| `selectedId?` | `string` | Currently highlighted row. |
| `onSelect?` | `(id: string) => void` | Highlight change. |
| `onActivate?` | `(id: string) => void` | Activation (Enter). |
| `maxVisible?` | `number` | Visible window size. |
| `mouseBoundsForItem?` | `(item, index) => MouseBounds \| undefined` | Per-row mouse bounds. |
| `renderItem?` | `(item, { focused, selected }) => ReactElement` | Custom row renderer. |

`RadioList` — radio-style single selection.

| Prop | Type |
| --- | --- |
| `options` | `{ value, label, disabled? }[]` |
| `selected` | `string \| null` |
| `onSelect` | `(value: string) => void` |
| `mouseBoundsForItem?` | `(option, index) => MouseBounds \| undefined` |

`ListSelect` — list with immediate selection callback and initial focus.

| Prop | Type |
| --- | --- |
| `items` | `{ value, label, disabled? }[]` |
| `onSelect` | `(value: T) => void` |
| `initialFocus?` | `number` (default 0) |
| `mouseBoundsForItem?` | `(item, index) => MouseBounds \| undefined` |

`Sidebar` — screen navigation sidebar, grouped by category.

| Prop | Type |
| --- | --- |
| `items` | `{ id, label, description?, category? }[]` |
| `sectionTitles?` | `Record<string, string>` |
| `columns?` | `number` |
| `categoryOrder?` | `string[]` |
| `screenOrderByCategory?` | `Record<string, string[]>` |
| `footer?` | `ReactNode` |
| `mouseBoundsForItem?` | `(item, index) => MouseBounds \| undefined` |

### Input and flow widgets

| Component | Props | Purpose |
| --- | --- | --- |
| `TextInput` | `value?`, `onChange?`, `placeholder?`, `maxLength?`, `onSubmit?`, `onCancel?`, `validate?` | Text entry. |
| `NumberInput` | `value?`, `onChange?`, `min?`, `max?`, `step?`, `defaultValue?`, `label?`, `onSubmit?` | Clamped numeric entry. |
| `SearchInput` | `value?`, `onChange?`, `placeholder?`, `scope?` | Filter input. |
| `CommandInput` | `mode` (`'navigation' \| 'command' \| 'process'`), `value`, `onChange`, `onSubmit`, `onCancel?`, `placeholder?`, `prompt?` | Mode-aware command line. |
| `ChoicePrompt` | `items`, `onSelect`, `onCancel?`, `label?` | Letter-key + arrow choice prompt. |
| `SelectableList` | `List` props except `items`, plus `filterQuery?`, `filterFn?` | Filterable list. |
| `OptionGrid` | `options`, `onSelect`, `columns?` | Directional grid selector. |
| `StepFlow` | `steps`, `initialData?`, `onComplete?`, `onCancel?` | Multi-step wizard with shared data. |

### Modals and toasts

| Component | Props | Purpose |
| --- | --- | --- |
| `ModalProvider` / `useModal` | `children`, `onClose?` | Modal host and context API. |
| `ModalDialog` | `title`, `children`, `onClose`, `footer?`, `trapFocus?`, `width?` | Focus-trapped modal overlay. |
| `ConfirmCancel` | `title`, `message`, `onConfirm`, `onCancel`, `confirmLabel?`, `cancelLabel?`, `danger?` | Inline confirm/cancel. |
| `ConfirmModal` | `message`, `onConfirm`, `onCancel`, `title?`, `confirmLabel?`, `cancelLabel?`, `danger?` | Modal confirm. |
| `ConfirmDialog` / `useConfirmDialog` | `isOpen`, `onClose`, `message`, `onConfirm`, `title?`, `confirmLabel?`, `cancelLabel?`, `danger?` | Controlled confirm dialog; `useConfirmDialog(options)` returns `{ isOpen, open, close, confirm, setMessage, message }`. |
| `InfoModal` | `message`, `onDismiss`, `title?`, `details?`, `dismissLabel?` | Informational modal. |
| `ToastProvider` / `useToast` | `children` | Toast host and context API. |

## Mouse areas

`MouseArea` is the public mouse primitive. It renders `children` unchanged, is headless, and registers an explicit rectangle with the surrounding `MouseProvider` (composed by `FrameworkProvider`). Without a `MouseProvider` it renders children and does nothing.

```tsx
<MouseArea
  bounds={{ x: 0, y: 0, width: 24, height: 1 }}
  onClick={({ x, y }) => selectAt(x, y)}
>
  <Text>Click target</Text>
</MouseArea>
```

Mouse contract:

- **Bounds are caller-supplied and absolute.** `MouseBounds` is a zero-based terminal-cell rectangle, half-open as `[x, x + width) × [y, y + height)`. Runeframe does not infer bounds from Ink/Yoga layout and performs no automatic layout hit testing.
- **No bounds means keyboard-only.** Controls are keyboard-only unless the caller opts into mouse areas by supplying bounds; there is no ambient mouse behavior.
- **Clicks only.** There are no hover, drag, or wheel events. `onClick` fires when a matching left press and release land on the area.
- **Scope and modal rules.** An area with a `scope` participates only while that scope is active. While a modal is open, an area remains eligible if it has an explicit `scope="modal"` or if it registered while the modal was already open (for example content currently rendered inside the modal); areas registered before the modal opened stay unreachable.
- **Overlap.** `priority` resolves overlaps (higher wins; ties go to the most recently registered area). `disabled` areas still win hit-testing and consume the click without calling `onClick` or passing through.
- **No terminal compatibility claim yet.** Mouse support has not been validated against named terminal emulators; named compatibility will only be claimed after emulator testing.

Props: `bounds`, `scope?`, `priority?` (default 0), `disabled?` (default `false`), `onClick?`, `children?`. Types: `MouseBounds`, `MouseClickEvent`.

## Theme

`ThemeProvider` supplies the `ThemeTokens` (colors, spacing, typography, border styles) and accepts `mode: 'dark' | 'light'` (default `'dark'`). `useTheme()` returns the active tokens.

```tsx
const { colors } = useTheme()
<Text color={colors.focus.ring}>focused</Text>
```

## Diagnostics

- `EventTracer` — bounded keyboard trace buffer: `new EventTracer(maxEntries?)`, `enable()`, `disable()`, `clear()`, `getTrace()`, `trace(...)`.
- `KeyboardDebugInspector` — live overlay: `tracer`, `getActiveScopeStack?`, `getActiveFocusPath?`.
- `detectCollisions(actions)` — reports actions that route the same key in overlapping scopes.

## Experimental

`runeframe/experimental` currently exports `KeyboardRegistry` (plus the `Keybinding` type) and `ScreenTransition` (plus `ScreenTransitionProps`, `TransitionType`). The rest of this document describes the stable `runeframe` root entry point.

## Development

Prerequisites: Node.js `>= 22` and npm.

```bash
npm ci
npm run typecheck
npm test
npm run test:integration:smoke   # examples/__tests__ full-stack smoke
npm run build
npm run pack:check               # build + packed-consumer ESM check
npm run test-app                 # install + smoke-test the showcase app, then launch it
npm run test-app:check           # install + typecheck + tests for the showcase app (CI)
```

`examples/test-app` is a standalone consumer project pinned to the published `runeframe@0.5.0` package from the npm registry; it never imports the repository's `src/`, `dist/`, or a local tarball. `npm run test-app` installs its own dependencies on first run (later launches reuse the installed copy while its lockfile stamp is current), runs the automated showcase smoke test, and then starts the interactive Ink app. `npm run test-app:check` is the non-interactive variant used by CI.

See `REPOSITORY_SETUP.md` for repository configuration and release flow.
