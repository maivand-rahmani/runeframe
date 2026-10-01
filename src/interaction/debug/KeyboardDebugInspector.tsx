import { useMemo } from 'react'
import { Text, Box, type BoxProps } from 'ink'
import type { EventTracer } from './EventTracer.js'
import { useKeyboardScope } from '../keyboard/KeyboardScopeProvider.js'
import { useTheme } from '../../design-system/ThemeProvider.js'
import { componentOverrides } from '../../components/primitives/themeOverrides.js'
import type { NormalizedKeyEvent } from '../../types.js'

export interface KeyboardDebugInspectorProps {
  tracer: EventTracer
  getActiveScopeStack?: () => string[]
  getActiveFocusPath?: () => string[]
}

function formatEvent(event: NormalizedKeyEvent): string {
  const parts: string[] = []
  if (event.ctrl) parts.push('Ctrl')
  if (event.shift) parts.push('Shift')
  if (event.meta) parts.push('Meta')
  parts.push(event.key || event.rawInput)
  return parts.join('+')
}

export function KeyboardDebugInspector({
  tracer,
  getActiveScopeStack,
  getActiveFocusPath,
}: KeyboardDebugInspectorProps) {
  const theme = useTheme()
  const overrides = componentOverrides(theme, 'keyboardDebugInspector')
  const borderStyle = (overrides?.borderStyle ??
    theme.layout?.debugInspectorBorderStyle ??
    'single') as BoxProps['borderStyle']
  const paddingX = overrides?.spacing?.paddingX ?? theme.spacing.xs
  const consumedColor =
    overrides?.colors?.consumed ?? theme.colors.status.success
  const unconsumedColor =
    overrides?.colors?.unconsumed ?? theme.colors.status.warning
  const { activeScopes } = useKeyboardScope()
  const trace = useMemo(() => tracer.getTrace().slice(-10), [tracer])
  const scopeStack = useMemo(
    () => getActiveScopeStack?.() ?? activeScopes,
    [getActiveScopeStack, activeScopes],
  )
  const focusPath = useMemo(
    () => getActiveFocusPath?.() ?? [],
    [getActiveFocusPath],
  )

  return (
    <Box
      flexDirection="column"
      borderStyle={borderStyle}
      paddingX={paddingX}
    >
      <Text bold dimColor>
        ⚡ Keyboard Debug
      </Text>

      <Box marginTop={1} flexDirection="column">
        <Text dimColor>Scope Stack:</Text>
        {scopeStack.length > 0 ? (
          <Text>  [{scopeStack.join(' → ')}]</Text>
        ) : (
          <Text dimColor>  (empty)</Text>
        )}
      </Box>

      {getActiveFocusPath && (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>Focus Path:</Text>
          {focusPath.length > 0 ? (
            <Text>  [{focusPath.join(' → ')}]</Text>
          ) : (
            <Text dimColor>  (empty)</Text>
          )}
        </Box>
      )}

      <Box marginTop={1} flexDirection="column">
        <Text dimColor>Trace (last {Math.min(trace.length, 10)}):</Text>
        {trace.length === 0 ? (
          <Text dimColor>  No events traced.</Text>
        ) : (
          trace.map((entry, i) => (
            <Text key={i}>
              {'  '}
              <Text color={entry.consumedBy ? consumedColor : unconsumedColor}>
                {formatEvent(entry.event)}
              </Text>
              {entry.consumedBy ? (
                <Text> → consumed by {entry.consumedBy}</Text>
              ) : (
                <Text dimColor> (unconsumed)</Text>
              )}
              {entry.handlerChain.length > 0 && (
                <Text dimColor>  [{entry.handlerChain.join(' → ')}]</Text>
              )}
            </Text>
          ))
        )}
      </Box>
    </Box>
  )
}
