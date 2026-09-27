import { useNavigation } from '../navigation/NavigationProvider.js'

/**
 * Generic outlet for the current route.
 *
 * Renders the `component` of the screen registered under the provider's
 * current route. Must be rendered inside `<NavigationProvider>` (normally
 * via `<FrameworkProvider>`); it does not depend on the removed screen
 * context.
 */
export function ScreenOutlet() {
  const { currentScreen, params } = useNavigation()

  return <>{currentScreen.component({ params, modalProps: {} })}</>
}
