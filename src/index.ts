// @maivandrahmani/englishos-tui-framework — stable barrel exports
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
} from './interaction/KeyEventNormalizer.js'
export * from './design-system/tokens.js'
export { ThemeProvider, useTheme } from './design-system/ThemeProvider.js'
export { FrameworkProvider } from './FrameworkProvider.js'
export type { FrameworkProviderProps } from './FrameworkProvider.js'
export { AppShell } from './components/AppShell.js'
export type { AppShellProps } from './components/AppShell.js'
export { Panel } from './components/Panel.js'
export type { PanelProps } from './components/Panel.js'
export { Table } from './components/Table.js'
export type { TableProps, Column } from './components/Table.js'
export { Card } from './components/Card.js'
export type { CardProps } from './components/Card.js'
export { Button } from './components/Button.js'
export type { ButtonProps, ButtonVariant } from './components/Button.js'
export { Badge } from './components/Badge.js'
export type { BadgeProps, BadgeVariant } from './components/Badge.js'
export { Section } from './components/Section.js'
export type { SectionProps } from './components/Section.js'
export { Divider } from './components/Divider.js'
export type { DividerProps } from './components/Divider.js'
export { Spacer } from './components/Spacer.js'
export type { SpacerProps } from './components/Spacer.js'
export { EmptyState } from './components/EmptyState.js'
export type { EmptyStateProps } from './components/EmptyState.js'
export { LoadingState } from './components/LoadingState.js'
export type { LoadingStateProps } from './components/LoadingState.js'
export type { ScreenDefinition, ScreenCategory } from './screens/screen.js'
export {
  NavigationProvider,
  useNavigation,
  useNavigationState,
  useNavigationActions,
  useModalState,
  useModalActions,
} from './navigation/NavigationProvider.js'
export type {
  NavigationEntry,
  ModalEntry,
  NavigationContextValue,
  NavigationStateValue,
  NavigationActionsValue,
  ModalStateValue,
  ModalActionsValue,
  NavigationProviderProps,
} from './navigation/NavigationProvider.js'
export { ScreenRegistry } from './screens/registry.js'
export { ScreenProvider, useScreen, ScreenRenderer } from './screens/ScreenProvider.js'
export { StatusBar } from './components/StatusBar.js'
export type { StatusBarProps } from './components/StatusBar.js'
export { HotkeyHintBar } from './components/HotkeyHintBar.js'
export type { HotkeyHintBarProps } from './components/HotkeyHintBar.js'
export { TopBar } from './components/TopBar.js'
export type { TopBarProps } from './components/TopBar.js'
export { Breadcrumbs } from './components/Breadcrumbs.js'
export type { BreadcrumbsProps } from './components/Breadcrumbs.js'
export { Tabs } from './components/Tabs.js'
export type { TabsProps, Tab } from './components/Tabs.js'
export { Sidebar } from './components/Sidebar.js'
export type {
  SidebarProps,
  SidebarItem,
  SidebarSectionTitles,
} from './components/Sidebar.js'
export { KeyboardScopeProvider, useKeyboardScope, useShellSuspension } from './interaction/KeyboardScopeProvider.js'
export type { ScopeStackEntry } from './interaction/KeyboardScopeProvider.js'
export { useKeyHandler, useKeyBinding } from './interaction/useKeyHandler.js'
export type {
  KeyHandler,
  KeyBindingOptions,
  UseKeyHandlerOptions,
} from './interaction/useKeyHandler.js'
export {
  FocusTreeProvider,
  useFocusZone,
  useFocusGroup,
  useFocusable,
} from './interaction/FocusTreeProvider.js'
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
} from './interaction/FocusTreeProvider.js'
export { ActionRegistry } from './commands/ActionRegistry.js'
export type { Action, ActionMatch } from './commands/ActionRegistry.js'
export {
  ScopedActionRegistryProvider,
  useScopedActionRegistry,
  useRegisterActions,
  useActiveActions,
} from './commands/ScopedActionRegistryProvider.js'
export type {
  ScopedActionRegistryContextValue,
  ScopedActionRegistryProviderProps,
} from './commands/ScopedActionRegistryProvider.js'
export { CommandPalette } from './components/CommandPalette.js'
export type { CommandPaletteProps } from './components/CommandPalette.js'
export { NodeProcessRunner } from './commands/ProcessRunner.js'
export type { ProcessRunner, RunningProcess } from './commands/ProcessRunner.js'
export { useCommandSession } from './commands/useCommandSession.js'
export type {
  CommandSessionMode,
  SessionStatus,
  UseCommandSessionOptions,
  CommandSessionAPI,
  OutputLine,
} from './commands/useCommandSession.js'
export { AsyncSessionRunner } from './commands/AsyncSessionRunner.js'
export type {
  SessionStatus as AsyncSessionStatus,
  SessionOptions as AsyncSessionOptions,
  SessionEvent,
  SessionLifecycle,
} from './commands/AsyncSessionRunner.js'
export { useAsyncSession } from './commands/useAsyncSession.js'
export type { UseAsyncSessionOptions } from './commands/useAsyncSession.js'
export { CommandBar } from './components/CommandBar.js'
export type { CommandBarProps } from './components/CommandBar.js'
export { ProcessOutputPanel } from './components/ProcessOutputPanel.js'
export type { ProcessOutputPanelProps } from './components/ProcessOutputPanel.js'
export { ModalProvider, useModal } from './components/ModalProvider.js'
export type { ModalProviderProps } from './components/ModalProvider.js'
export { ModalDialog } from './components/ModalDialog.js'
export type { ModalDialogProps } from './components/ModalDialog.js'
export { ConfirmCancel } from './components/ConfirmCancel.js'
export type { ConfirmCancelProps } from './components/ConfirmCancel.js'
export { ConfirmModal } from './components/ConfirmModal.js'
export type { ConfirmModalProps } from './components/ConfirmModal.js'
export { ConfirmDialog, useConfirmDialog } from './components/ConfirmDialog.js'
export type { ConfirmDialogProps, UseConfirmDialogOptions, UseConfirmDialogResult } from './components/ConfirmDialog.js'
export { InfoModal } from './components/InfoModal.js'
export type { InfoModalProps } from './components/InfoModal.js'
export { ToastProvider, useToast } from './components/ToastProvider.js'
export type { ToastVariant, Toast, ToastResult, ToastContextValue, ToastProviderProps } from './components/ToastProvider.js'
export { List } from './components/List.js'
export type { ListItem, ListProps } from './components/List.js'
export { SearchInput } from './components/SearchInput.js'
export type { SearchInputProps } from './components/SearchInput.js'
export { TextInput } from './components/TextInput.js'
export type { TextInputProps } from './components/TextInput.js'
export { NumberInput } from './components/NumberInput.js'
export type { NumberInputProps } from './components/NumberInput.js'
export { CommandInput } from './components/CommandInput.js'
export type { CommandInputProps } from './components/CommandInput.js'
export { SelectableList } from './components/SelectableList.js'
export type { SelectableListProps } from './components/SelectableList.js'
export { ChoicePrompt } from './components/ChoicePrompt.js'
export type { ChoiceItem, ChoicePromptProps } from './components/ChoicePrompt.js'
export { StepFlow } from './components/StepFlow.js'
export type { Step, StepContext, StepFlowProps } from './components/StepFlow.js'
export { ListSelect } from './components/ListSelect.js'
export type { ListSelectItem, ListSelectProps } from './components/ListSelect.js'
export { OptionGrid } from './components/OptionGrid.js'
export type { OptionGridOption, OptionGridProps } from './components/OptionGrid.js'
export { RadioList } from './components/RadioList.js'
export type { RadioListOption, RadioListProps } from './components/RadioList.js'
export { detectCollisions } from './commands/CollisionDetector.js'
export type { CollisionWarning } from './commands/CollisionDetector.js'
export { EventTracer } from './interaction/EventTracer.js'
export type { TraceEntry } from './interaction/EventTracer.js'
export { KeyboardDebugInspector } from './interaction/KeyboardDebugInspector.js'
export type { KeyboardDebugInspectorProps } from './interaction/KeyboardDebugInspector.js'

export * as experimental from './experimental/index.js'
