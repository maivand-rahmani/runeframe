import { Box, Text } from 'ink'
import { useTheme } from '../../design-system/ThemeProvider.js'
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

const STATUS_COLORS: Record<SessionStatus, string> = {
  idle: 'gray',
  starting: 'yellow',
  running: 'green',
  complete: 'cyan',
  error: 'red',
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
  const { colors } = useTheme()

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

  const statusColor = STATUS_COLORS[status]
  const statusLabel = STATUS_LABELS[status]

  return (
    <Box flexDirection="column">
      {/* Status bar */}
      <Box>
        <Text color={colors.status.info}>[</Text>
        <Text color={statusColor}>{statusLabel}</Text>
        {activeCommand && (
          <Text color={colors.text.secondary}>
            {' '}
            {activeCommand.length > 40
              ? activeCommand.slice(0, 37) + '...'
              : activeCommand}
          </Text>
        )}
        {exitCode !== null && (
          <Text color={exitCode === 0 ? colors.status.success : colors.status.error}>
            {' '}
            (exit {exitCode})
          </Text>
        )}
        <Text color={colors.status.info}>]</Text>
      </Box>

      {/* Output lines */}
      {visible.length > 0 && (
        <Box flexDirection="column">
          {visible.map((line, i) => (
            <Text
              key={i}
              color={line.type === 'stderr' ? colors.status.warning : undefined}
            >
              {line.data}
            </Text>
          ))}
        </Box>
      )}

      {visible.length === 0 && (status === 'running' || status === 'starting') && (
        <Box>
          <Text dimColor>Waiting for output...</Text>
        </Box>
      )}
    </Box>
  )
}
