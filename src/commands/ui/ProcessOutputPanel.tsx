import { Box, Text } from 'ink'
import { useTheme } from '../../design-system/ThemeProvider.js'
import { componentOverrides } from '../../components/primitives/themeOverrides.js'
import type {
  SessionEvent,
  SessionStatus,
} from '../process/AsyncSessionRunner.js'

export interface ProcessOutputPanelProps {
  /** Canonical session event stream (stdout/stderr/status/error/exit). */
  events: readonly SessionEvent[]
  /** Lifecycle status of the session. */
  status: SessionStatus
  /** The command that is running, or the last command that ran. */
  activeCommand?: string | null
  /** Maximum number of visible output lines. Older lines are dropped. */
  maxVisibleLines?: number
}

const STATUS_LABELS: Record<SessionStatus, string> = {
  idle: 'Idle',
  starting: 'Starting...',
  running: 'Running...',
  complete: 'Complete',
  error: 'Error',
}

/**
 * Presentational component that renders the output of a session.
 * Shows stdout/stderr lines with stream-aware coloring, the active command,
 * and a status bar. Reads the canonical `SessionEvent`/`SessionStatus`
 * contract only.
 */
export function ProcessOutputPanel({
  events,
  status,
  activeCommand,
  maxVisibleLines = 500,
}: ProcessOutputPanelProps) {
  const theme = useTheme()
  const overrides = componentOverrides(theme, 'processOutputPanel')
  const idleColor = overrides?.colors?.idle ?? theme.colors.text.secondary
  const startingColor = overrides?.colors?.starting ?? theme.colors.status.warning
  const runningColor = overrides?.colors?.running ?? theme.colors.status.success
  const completeColor = overrides?.colors?.complete ?? theme.colors.focus.ring
  const errorColor = overrides?.colors?.error ?? theme.colors.status.error
  const infoColor = overrides?.colors?.info ?? theme.colors.status.info
  const commandColor = overrides?.colors?.command ?? theme.colors.text.secondary
  const stderrColor = overrides?.colors?.stderr ?? theme.colors.status.warning
  const exitSuccessColor =
    overrides?.colors?.exitSuccess ?? theme.colors.status.success
  const exitErrorColor = overrides?.colors?.exitError ?? theme.colors.status.error

  const statusColors: Record<SessionStatus, string> = {
    idle: idleColor,
    starting: startingColor,
    running: runningColor,
    complete: completeColor,
    error: errorColor,
  }

  const output = events.filter(
    (event) => event.type === 'stdout' || event.type === 'stderr',
  )
  const visible =
    maxVisibleLines > 0 && output.length > maxVisibleLines
      ? output.slice(-maxVisibleLines)
      : output

  let exitCode: number | null = null
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (event?.type === 'exit') {
      exitCode = event.exitCode ?? null
      break
    }
  }

  const statusColor = statusColors[status]
  const statusLabel = STATUS_LABELS[status]

  return (
    <Box flexDirection="column">
      {/* Status bar */}
      <Box>
        <Text color={infoColor}>[</Text>
        <Text color={statusColor}>{statusLabel}</Text>
        {activeCommand && (
          <Text color={commandColor}>
            {' '}
            {activeCommand.length > 40
              ? activeCommand.slice(0, 37) + '...'
              : activeCommand}
          </Text>
        )}
        {exitCode !== null && (
          <Text color={exitCode === 0 ? exitSuccessColor : exitErrorColor}>
            {' '}
            (exit {exitCode})
          </Text>
        )}
        <Text color={infoColor}>]</Text>
      </Box>

      {/* Output lines */}
      {visible.length > 0 && (
        <Box flexDirection="column">
          {visible.map((line, i) => (
            <Text
              key={i}
              color={line.type === 'stderr' ? stderrColor : undefined}
            >
              {line.data}
            </Text>
          ))}
        </Box>
      )}

      {visible.length === 0 && (status === 'running' || status === 'starting') && (
        <Box>
          <Text dimColor color={overrides?.colors?.muted}>
            Waiting for output...
          </Text>
        </Box>
      )}
    </Box>
  )
}
