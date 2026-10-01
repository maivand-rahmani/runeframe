// runeframe — stable barrel exports
export type * from './types.js'
export { InputConsumptionResult } from './types.js'
export * from './constants.js'
export {
  normalizeKey,
  KEY_ENTER,
  KEY_ESCAPE,
  KEY_TAB,
  KEY_BACKSPACE,
  KEY_DELETE,
  KEY_UP,
  KEY_DOWN,
  KEY_LEFT,
  KEY_RIGHT,
  KEY_SPACE,
} from './interaction/keyboard/KeyEventNormalizer.js'
export * from './design-system/tokens.js'
export { ThemeProvider, useTheme } from './design-system/ThemeProvider.js'
export { FrameworkProvider } from './FrameworkProvider.js'
export type { FrameworkProviderProps } from './FrameworkProvider.js'
export { AppShell } from './components/layout/AppShell.js'
export type { AppShellProps } from './components/layout/AppShell.js'
export { Panel } from './components/primitives/Panel.js'
export type { PanelProps } from './components/primitives/Panel.js'
export { Table } from './components/primitives/Table.js'
export type { TableProps, Column } from './components/primitives/Table.js'
export { Card } from './components/primitives/Card.js'
export type { CardProps } from './components/primitives/Card.js'
export { Button } from './components/primitives/Button.js'
export type { ButtonProps, ButtonVariant } from './components/primitives/Button.js'
export { Badge } from './components/primitives/Badge.js'
export type { BadgeProps, BadgeVariant } from './components/primitives/Badge.js'
export { Section } from './components/primitives/Section.js'
export type { SectionProps } from './components/primitives/Section.js'
export { Divider } from './components/primitives/Divider.js'
export type { DividerProps } from './components/primitives/Divider.js'
export { Spacer } from './components/primitives/Spacer.js'
export type { SpacerProps } from './components/primitives/Spacer.js'
export { EmptyState } from './components/feedback/EmptyState.js'
export type { EmptyStateProps } from './components/feedback/EmptyState.js'
export { LoadingState } from './components/feedback/LoadingState.js'
export type { LoadingStateProps } from './components/feedback/LoadingState.js'
export type { ScreenDefinition, ScreenCategory } from './screens/screen.js'
export { NavigationProvider, useNavigation } from './navigation/NavigationProvider.js'
export type {
  NavigationEntry,
  ModalEntry,
  NavigationContextValue,
  NavigationProviderProps,
} from './navigation/NavigationProvider.js'
export { ScreenRegistry } from './screens/registry.js'
export { ScreenOutlet } from './screens/ScreenOutlet.js'
export { StatusBar } from './components/layout/StatusBar.js'
export type { StatusBarProps } from './components/layout/StatusBar.js'
export { HotkeyHintBar } from './commands/ui/HotkeyHintBar.js'
export type { HotkeyHintBarProps } from './commands/ui/HotkeyHintBar.js'
export { TopBar } from './components/layout/TopBar.js'
export type { TopBarProps } from './components/layout/TopBar.js'
export { Breadcrumbs } from './components/navigation/Breadcrumbs.js'
export type { BreadcrumbsProps } from './components/navigation/Breadcrumbs.js'
export { Tabs } from './components/navigation/Tabs.js'
export type { TabsProps, Tab } from './components/navigation/Tabs.js'
export { Sidebar } from './components/navigation/Sidebar.js'
export type {
  SidebarProps,
  SidebarItem,
  SidebarSectionTitles,
} from './components/navigation/Sidebar.js'
export { KeyboardScopeProvider, useKeyboardScope, useShellSuspension } from './interaction/keyboard/KeyboardScopeProvider.js'
export type { ScopeStackEntry } from './interaction/keyboard/KeyboardScopeProvider.js'
export { useKeyHandler, useKeyBinding } from './interaction/keyboard/useKeyHandler.js'
export type {
  KeyHandler,
  KeyBindingOptions,
  UseKeyHandlerOptions,
} from './interaction/keyboard/useKeyHandler.js'
export {
  FocusTreeProvider,
  useFocusZone,
  useFocusGroup,
  useFocusable,
} from './interaction/focus/FocusTreeProvider.js'
export type {
  FocusZoneContextValue,
  FocusGroupContextValue,
  UseFocusZoneOptions,
  UseFocusZoneResult,
  UseFocusGroupOptions,
  UseFocusGroupResult,
  UseFocusableOptions,
  UseFocusableResult,
  FocusTreeProviderProps,
} from './interaction/focus/FocusTreeProvider.js'
export { ActionRegistry } from './commands/actions/ActionRegistry.js'
export type { Action, ActionMatch } from './commands/actions/ActionRegistry.js'
export {
  ScopedActionRegistryProvider,
  useScopedActionRegistry,
  useRegisterActions,
  useActiveActions,
} from './commands/actions/ScopedActionRegistryProvider.js'
export type {
  ScopedActionRegistryContextValue,
  ScopedActionRegistryProviderProps,
} from './commands/actions/ScopedActionRegistryProvider.js'
export { CommandPalette } from './commands/ui/CommandPalette.js'
export type { CommandPaletteProps } from './commands/ui/CommandPalette.js'
export { NodeProcessRunner } from './commands/process/ProcessRunner.js'
export type { ProcessRunner, RunningProcess } from './commands/process/ProcessRunner.js'
export {
  AsyncSessionRunner,
  DEFAULT_MAX_OUTPUT_LINES,
} from './commands/process/AsyncSessionRunner.js'
export type {
  SessionStatus,
  SessionOptions,
  SessionEvent,
  SessionEventType,
  SessionLifecycle,
} from './commands/process/AsyncSessionRunner.js'
export { useAsyncSession } from './commands/process/useAsyncSession.js'
export type {
  UseAsyncSessionOptions,
  UseAsyncSessionResult,
} from './commands/process/useAsyncSession.js'
export { ProcessOutputPanel } from './commands/ui/ProcessOutputPanel.js'
export type { ProcessOutputPanelProps } from './commands/ui/ProcessOutputPanel.js'
export { ModalProvider, useModal } from './components/overlays/ModalProvider.js'
export type { ModalProviderProps } from './components/overlays/ModalProvider.js'
export { ModalDialog } from './components/overlays/ModalDialog.js'
export type { ModalDialogProps } from './components/overlays/ModalDialog.js'
export { ConfirmCancel } from './components/overlays/ConfirmCancel.js'
export type { ConfirmCancelProps } from './components/overlays/ConfirmCancel.js'
export { ConfirmModal } from './components/overlays/ConfirmModal.js'
export type { ConfirmModalProps } from './components/overlays/ConfirmModal.js'
export { ConfirmDialog, useConfirmDialog } from './components/overlays/ConfirmDialog.js'
export type { ConfirmDialogProps, UseConfirmDialogOptions, UseConfirmDialogResult } from './components/overlays/ConfirmDialog.js'
export { InfoModal } from './components/overlays/InfoModal.js'
export type { InfoModalProps } from './components/overlays/InfoModal.js'
export { ToastProvider, useToast } from './components/feedback/ToastProvider.js'
export type { ToastVariant, Toast, ToastResult, ToastContextValue, ToastProviderProps } from './components/feedback/ToastProvider.js'
export { List } from './components/selection/List.js'
export type { ListItem, ListProps } from './components/selection/List.js'
export { SearchInput } from './components/inputs/SearchInput.js'
export type { SearchInputProps } from './components/inputs/SearchInput.js'
export { TextInput } from './components/inputs/TextInput.js'
export type { TextInputProps } from './components/inputs/TextInput.js'
export { NumberInput } from './components/inputs/NumberInput.js'
export type { NumberInputProps } from './components/inputs/NumberInput.js'
export { CommandInput } from './components/inputs/CommandInput.js'
export type { CommandInputProps } from './components/inputs/CommandInput.js'
export { SelectableList } from './components/selection/SelectableList.js'
export type { SelectableListProps } from './components/selection/SelectableList.js'
export { ChoicePrompt } from './components/selection/ChoicePrompt.js'
export type { ChoiceItem, ChoicePromptProps } from './components/selection/ChoicePrompt.js'
export { StepFlow } from './components/StepFlow.js'
export type { Step, StepContext, StepFlowProps } from './components/StepFlow.js'
export { ListSelect } from './components/selection/ListSelect.js'
export type { ListSelectItem, ListSelectProps } from './components/selection/ListSelect.js'
export { OptionGrid } from './components/selection/OptionGrid.js'
export type { OptionGridOption, OptionGridProps } from './components/selection/OptionGrid.js'
export { RadioList } from './components/selection/RadioList.js'
export type { RadioListOption, RadioListProps } from './components/selection/RadioList.js'
export { detectCollisions } from './commands/actions/CollisionDetector.js'
export type { CollisionWarning } from './commands/actions/CollisionDetector.js'
export { EventTracer } from './interaction/debug/EventTracer.js'
export type { TraceEntry } from './interaction/debug/EventTracer.js'
export { KeyboardDebugInspector } from './interaction/debug/KeyboardDebugInspector.js'
export type { KeyboardDebugInspectorProps } from './interaction/debug/KeyboardDebugInspector.js'
export { MouseArea } from './interaction/mouse/MouseArea.js'
export type {
  MouseAreaProps,
  MouseBounds,
  MouseClickEvent,
  MouseDragEvent,
  MousePointerEvent,
} from './interaction/mouse/MouseArea.js'
export { MouseLayout } from './interaction/mouse/MouseLayout.js'
export type {
  MouseLayoutOrigin,
  MouseLayoutProps,
} from './interaction/mouse/MouseLayout.js'

export * as experimental from './experimental/index.js'
