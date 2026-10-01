# Runeframe

Runeframe 0.5 is a reusable Ink/React framework for building mouse-first terminal applications without giving up keyboard control. It provides clickable measured components, hover, wheel scrolling, captured drag, screen navigation, hierarchical focus, scoped key bindings, composable widgets, and async process sessions.

- **ESM-only.** Runeframe ships ECMAScript modules and nothing else. Use `import` (or dynamic `await import(...)`). There is no CommonJS entry point, so `require('runeframe')` does not work.
- **Node.js `>= 22.0.0`.**
- **Peer dependencies:** `ink ^7.0.2` and `react ^19.2.5`.

## Mouse-first capabilities

Runeframe's built-in controls measure their own mouse targets and route pointer input through the same providers as keyboard input:

- **Clickable measured built-ins** — buttons, list rows, tabs, sidebar rows, inputs, and modal actions become clickable inside a measured `MouseLayout` tree, with no per-control rectangles required.
- **Hover, wheel, and captured drag** — measured built-ins add hover cues and wheel scrolling (`List`/`SelectableList` row windows, and `AppShell` with `scrollContent`), while explicit `MouseArea` regions expose hover (`onEnter`/`onLeave`/`onMove`) and captured left-button drag (`onDragStart`/`onDragMove`/`onDragEnd`/`onDragCancel`).
- **Keyboard alongside mouse** — built-in controls retain their keyboard interactions and focus behavior. If you build a custom `MouseArea`, provide its keyboard alternative yourself. Without a valid measured root, keyboard behavior remains available and automatic mouse targets stay inactive.
- **Input routing** — TTY mouse reporting uses SGR; on Windows, the optional `runeframe/windows-input` transport normalizes console records through the same mouse router.

See [Mouse interaction and scrolling](#mouse-interaction-and-scrolling) for `MouseLayout` origin requirements and geometry limits, and [Windows input (Ink)](#windows-input-ink) for the Windows transport. To try the showcase, run `npm run test-app` from the repository root (installs and smoke-tests `examples/test-app`, then launches the interactive app).

## Install

```bash
npm install runeframe
```

Install the peer dependencies in your application if your package manager does not install them automatically:

```bash
npm install ink react
```

Three import-only ESM entry points are published; use the Windows-specific one
only on Windows (or import it dynamically):

```ts
import { FrameworkProvider, ScreenRegistry } from 'runeframe'
import { KeyboardRegistry, ScreenTransition } from 'runeframe/experimental'
import { createWindowsInputTransport } from 'runeframe/windows-input'
```

The package `exports` map exposes only `types` and `import` conditions.

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

The Quickstart is a keyboard-capable shell as shown. Measured mouse targets require wrapping the layout in `MouseLayout` with the correct origin and, on Windows, providing the native input transport; see [Mouse interaction and scrolling](#mouse-interaction-and-scrolling) and [Windows input (Ink)](#windows-input-ink) for full instructions.

## FrameworkProvider

`FrameworkProvider` is the single composition root for an application. Every capability is always enabled; there are no opt-in composition flags.

Provider order (outermost → innermost):

1. `ThemeProvider` — design tokens (`themeMode: 'dark' | 'light'`, default `'dark'`) plus optional `theme?: ThemeOverrides` overrides.
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
  theme={{ colors: { focus: { ring: 'magenta' } } }}
  onModalClose={() => {}}
>
  <App />
</FrameworkProvider>
```

`FrameworkProviderProps`: `registry`, `defaultScreen`, `children`, `themeMode?`, `theme?`, `onModalClose?`.

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

## Mouse interaction and scrolling

`FrameworkProvider` includes Runeframe's mouse input handling. Built-in controls can measure their own mouse targets when they render inside the opt-in `MouseLayout` tree. `MouseLayout` is a Box-equivalent adapter; it uses Ink's public layout metrics and adds no wrapper around the Box it represents.

```tsx
import React from 'react'
import { Text } from 'ink'
import {
  AppShell,
  FrameworkProvider,
  List,
  MouseLayout,
  ScreenOutlet,
  ScreenRegistry,
} from 'runeframe'

// Use this only when the live root is actually at zero-based cell (0, 0).
const liveRootOrigin = { x: 0, y: 0 }
const items = Array.from({ length: 24 }, (_, index) => ({
  id: `item-${index + 1}`,
  label: `Item ${index + 1}`,
}))
const registry = new ScreenRegistry()
registry.register({
  id: 'home',
  title: 'Home',
  sidebar: true,
  category: 'main',
  component: () => <List items={items} maxVisible={8} />,
})

function App() {
  return (
    <FrameworkProvider registry={registry} defaultScreen="home">
      {/* Use as the root layout node; replace an existing root Box when possible. */}
      <MouseLayout origin={liveRootOrigin} flexDirection="column">
        <AppShell
          sidebar={<Text>Navigation</Text>}
          sidebarPosition="fixed"
          scrollContent
        >
          <ScreenOutlet />
        </AppShell>
      </MouseLayout>
    </FrameworkProvider>
  )
}
```

The example only has valid automatic coordinates if the supplied origin is correct. For nested application-owned `Box` ancestors between this root and a target, replace each with a nested `MouseLayout` using the same Box props; Runeframe measures its own built-in layout nodes. An ordinary `Box` in that path breaks the geometry chain and cannot be detected through Ink's public API. Use `MouseLayout` in place of an existing layout node when possible: introducing a new Box-equivalent node can change layout.

- **Origin and output limits.** The root origin is an assertion, not something Runeframe can discover. Normal-screen scrollback, `<Static>` output before the live tree, and uncoordinated stdout/stderr writes can move the live frame; automatic coordinates are only valid if the application keeps the origin accurate. Alternate-screen output at `(0, 0)` is common, not guaranteed. Without a valid measured root, keyboard behavior remains available and automatic targets stay inactive.
- **Built-in targets.** Measurable controls such as buttons, navigation rows, list rows, tabs, inputs, and modal actions can use automatic hit areas inside the measured tree. No per-control rectangles are needed. `List`/`SelectableList` scroll their visible row window with the wheel and keep keyboard focus visible. `AppShell` wheel scrolling is enabled with `scrollContent` and `sidebarPosition="fixed"`, whether the sidebar is visible or hidden; a nested list gets the first chance and passes wheel input outward at its boundary. Wheel input changes viewport position only; it does not select or activate a row.
- **Clipping limits.** Runeframe models its own measured viewport clips and scroll offsets. Arbitrary consumer clipping, transforms, and scroll containers are not inferred and are outside the automatic-geometry guarantee.
- **Interactive output only.** TTY mouse reporting uses SGR; the Windows-native transport normalizes console records through the same mouse router. The test suite exercises synthetic input. Local win-x64 keyboard and click/wheel checks were reported in Windows Terminal with PowerShell and cmd. User-reported, not automated evidence: the physical test-app mouse check works well on macOS with zsh; a keyboard issue observed in that environment remains a later follow-up. Other terminal emulators and PTYs remain unverified.

### Explicit `MouseArea`

`MouseArea` remains the headless, explicit-bounds primitive. It renders `children` unchanged and registers a caller-supplied rectangle with the surrounding mouse registry. Without a `MouseProvider` it renders children and does nothing.

```tsx
<MouseArea
  bounds={{ x: 0, y: 0, width: 24, height: 1 }}
  onClick={({ x, y }) => selectAt(x, y)}
>
  <Text>Click target</Text>
</MouseArea>
```

`MouseBounds` uses zero-based terminal cells and half-open rectangles: `[x, x + width) × [y, y + height)`. Explicit bounds remain caller-owned and are not inferred from Ink/Yoga layout. Click behavior is unchanged: a matching left-button press and release must land on the area. `MouseArea` also accepts motion callbacks: `onEnter`/`onLeave`/`onMove` for hover and `onDragStart`/`onDragMove`/`onDragEnd`/`onDragCancel` for captured left-button drags. Hover and drag callbacks receive the current cell as `x`/`y`; drag callbacks also receive the press origin as `startX`/`startY`. `scope`, `priority` (default `0`), `disabled`, modal eligibility, and overlap behavior are unchanged. Types: `MouseAreaProps`, `MouseBounds`, `MouseClickEvent`, `MousePointerEvent`, `MouseDragEvent`.

## Windows input (Ink)

Runeframe publishes a Windows-only, import-only ESM subpath, `runeframe/windows-input`, for applications that want the native console input owner instead of Ink reading `process.stdin`. Load it dynamically (or only on win32) so non-Windows runs never import it.

```tsx
import { render } from 'ink'
import { FrameworkProvider } from 'runeframe'

const { createWindowsInputTransport } = await import('runeframe/windows-input')

let instance: ReturnType<typeof render> | undefined
let pendingFailure: Error | undefined

const input = await createWindowsInputTransport({
  onInputFailure: (error) => {
    pendingFailure = error
    instance?.unmount()
  },
})

try {
  instance = render(
    <FrameworkProvider
      registry={registry}
      defaultScreen="home"
      mouseEventSource={input.mouseEvents}
    >
      <App />
    </FrameworkProvider>,
    { stdin: input.stdin },
  )
  // A failure may land before `render` returns; honor the latch.
  if (pendingFailure) instance.unmount()
  await instance.waitUntilExit()
} finally {
  // Ink must be unmounted before the transport releases the console.
  instance?.unmount()
  await input.close()
}
```

`registry`, `defaultScreen`, and `App` are the application objects from the Quickstart. `input.stdin` is the Ink-facing stream (keyboard bytes only) and `input.mouseEvents` is the normalized mouse source; passing it as `mouseEventSource` routes that channel through `MouseProvider` instead of the post-Ink SGR interceptor. A wrapper component can accept the source as a prop and forward it to `FrameworkProvider` the same way.

- **Lifecycle.** Create the transport before `render`. If the helper fails after readiness, `onInputFailure` fires once and the host unmounts Ink; every exit path then unmounts Ink and awaits `input.close()` in a `finally`. `close()` is idempotent and uses a bounded graceful helper stop.
- **Packaging.** The helper is a self-contained NativeAOT executable shipped for `win-x64` and `win-arm64`; consumers need no .NET SDK or runtime, and unsupported platform/arch or a missing binary fails closed before `render`.
- **Capability.** The helper is the sole reader of the console input queue; JavaScript never reads `process.stdin` or calls `setRawMode`. Keyboard bytes plus normalized left-button press/release, vertical wheel, and hover/drag motion events are routed through the shared SGR multiplexer and parser. Windows `MOUSE_MOVED` records map to press-form SGR motion (`Cb=32` with the left button held, `Cb=35` with no button), so `MouseArea` hover and captured drag callbacks work; motion never synthesizes a press, release, or click, and click/wheel behavior is unchanged. Right/middle buttons and horizontal wheel remain unsupported.
- **Acceptance.** Local win-x64 testing in Windows Terminal PowerShell and cmd reports working keyboard input and mouse clicks/wheel. Automated tests cover hover/drag and input routing; the user reported that the physical test-app checklist, including hover/drag and click alignment after toasts, worked in Windows Terminal. Per-action telemetry was not collected. ARM64 runtime behavior and other terminal emulators remain unverified.

## Theme

Theming is additive: optional overrides layer on top of the built-in theme instead of replacing it. `ThemeProvider` and `FrameworkProvider` keep their existing `mode` / `themeMode` props (`'dark' | 'light'`, default `'dark'`) and also accept `theme?: ThemeOverrides`. With no `theme` prop, the default dark palette and comfortable density are exactly the current appearance; every override resolves on top of that base.

```tsx
<FrameworkProvider
  registry={registry}
  defaultScreen="home"
  themeMode="dark"
  theme={{ colors: { focus: { ring: 'magenta' } } }}
>
  <App />
</FrameworkProvider>
```

`useTheme()` returns the fully resolved tokens for the surrounding provider. `useTheme<MyExtensions>()` adds an `extensions` field typed as `MyExtensions`, so applications can read their own values from the same resolved theme.

```tsx
const { colors } = useTheme()
<Text color={colors.focus.ring}>focused</Text>
```

### Overrides and inheritance

`ThemeOverrides` is recursively partial: every field is optional, and `undefined` inherits the value already resolved by the enclosing provider. Plain objects deep-merge, arrays are replaced as a whole, and `0`/`''` are retained. A nested `ThemeProvider` inherits its parent's resolved values and deep-merges its own `theme` on top, so a screen or subtree can adjust a few tokens without resetting everything else. Setting `mode` on a nested provider swaps the color base to that mode's defaults while the other groups keep inheriting.

| Group | Contents |
| --- | --- |
| `colors` | Partial nested palette: `text`, `status`, `focus`, `surface`, `border`. |
| `spacing` | Spacing tokens; keys stay open so custom widgets can add tokens. |
| `typography` | Typographic role tokens. |
| `borderStyles` | Border style tokens. |
| `density` | Spacing preset: `'compact' \| 'comfortable' \| 'spacious'` (default `'comfortable'`). Changes scale the inherited spacing, so nested density changes compose. |
| `symbols` | Global glyph groups for the built-in widgets (see below). |
| `layout` | Global layout keys: `narrowColumns`, `mediumColumns`, `sidebarMaxItems`, `listMaxVisible`, `sidebarWidth`, `dividerWidth`, `modalPaddingX`, `modalPaddingY`, `modalMarginY`, `statusBarBorderStyle`, `modalBorderStyle`, `commandPaletteBorderStyle`, `debugInspectorBorderStyle`, `choicePromptMarginBottom`. |
| `components` | Per-component overrides keyed by component name; each accepts `colors`, `spacing`, `symbols`, `layout`, and `borderStyle`. Component names are an open map, so custom widgets can define their own keys. |
| `extensions` | Free-form namespace for application data, typed through `useTheme<MyExtensions>()`. |

Density presets scale spacing tokens only; they do not automatically resize every component or layout dimension. Use `layout` and named component overrides for the dimensions each built-in exposes.

Global symbol groups and their keys:

| Group | Keys (defaults) |
| --- | --- |
| `button` | `open`, `close` (`[`, `]`) |
| `badge` | `open`, `close` (`[`, `]`) |
| `divider` | `horizontal` (`─`) |
| `list` | `marker` (`•`) |
| `radioList` | `selected`, `unselected` (`•`, `○`) |
| `sidebar` | `active`, `item` (`›`, `•`) |
| `tabs` | `separator` (`|`) |
| `input` | `open`, `close`, `separator` (`[`, `]`, `|`) |
| `stepFlow` | `back`, `next` (`[←]`, `[→/Enter]`) |

Overrides expose only these documented token groups. Components keep rendering through the same resolved tokens, so there is no pass-through of arbitrary Ink props, and not every arbitrary style is replaceable — only the tokens a component actually consumes can be changed. When both apply, a component override takes precedence over the global semantic token, which takes precedence over the built-in default.

### Usage

```tsx
import { Text } from 'ink'
import type { ThemeOverrides } from 'runeframe'
import { FrameworkProvider, useTheme } from 'runeframe'

// Typed application extensions are read back through useTheme<T>().
type BrandExtensions = {
  brand: {
    accent: string
    logo: string
  }
}

const brandTheme: ThemeOverrides = {
  // Custom palette: only the roles you name change; everything else inherits.
  colors: {
    focus: { ring: 'magenta' },
    status: { success: 'greenBright' },
  },
  // Global symbol group (see the table above).
  symbols: {
    list: { marker: '▸' },
  },
  // Named component override; fields: colors, spacing, symbols, layout, borderStyle.
  components: {
    button: {
      colors: { primary: 'magenta', focused: 'magentaBright' },
      symbols: { open: '❮', close: '❯' },
    },
  },
  // Custom extension data merged alongside the built-in tokens.
  extensions: {
    brand: { accent: 'magenta', logo: '✦' },
  },
}

function BrandHeader() {
  const { extensions } = useTheme<BrandExtensions>()
  return <Text color={extensions.brand.accent}>{extensions.brand.logo} Ready</Text>
}

export function App() {
  return (
    <FrameworkProvider
      registry={registry}
      defaultScreen="home"
      theme={brandTheme}
    >
      <BrandHeader />
    </FrameworkProvider>
  )
}
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

`examples/test-app` is a standalone local-source consumer: its TypeScript and Vitest aliases resolve the `runeframe` entry points to this repository's `src/`, while React and Ink are shared from the root install. `npm run test-app` installs its own dependencies on first run (later launches reuse the installed copy while its lockfile stamp is current), runs the automated showcase smoke test, and then starts the interactive Ink app. `npm run test-app:check` is the non-interactive typecheck-and-test command used by CI.

See `REPOSITORY_SETUP.md` for repository configuration and release flow.
