import React from 'react'
import { Box, Text } from 'ink'
import {
  FrameworkProvider,
  ScreenRegistry,
  AppShell,
  TopBar,
  useNavigation,
  ScreenOutlet,
  useAsyncSession,
  useKeyHandler,
  useTheme,
  ProcessOutputPanel,
  NodeProcessRunner,
} from '../../src/index.js'

const registry = new ScreenRegistry()
registry.register({
  id: 'home',
  title: 'Command Console',
  sidebar: true,
  category: 'main',
  component: () => <HomeScreen />,
})

const runner = new NodeProcessRunner()

type ConsoleMode = 'browse' | 'command' | 'stdin'

function HomeScreen() {
  const { colors } = useTheme()
  const session = useAsyncSession({ runner })
  const [mode, setMode] = React.useState<ConsoleMode>('browse')
  const [input, setInput] = React.useState('')
  const [activeCommand, setActiveCommand] = React.useState<string | null>(null)

  const beginCommand = () => {
    setMode('command')
    setInput('')
  }

  const cancelProcess = () => {
    session.cancel()
    setMode('browse')
    setActiveCommand(null)
  }

  const submitInput = () => {
    if (mode === 'stdin') {
      session.sendInput(input + '\n')
      setInput('')
      return
    }

    const command = input.trim()
    if (!command) return

    setActiveCommand(command)
    session.start(command)
    setMode('stdin')
    setInput('')
  }

  // Enter on the console screen opens the command prompt.
  useKeyHandler(
    (event) => {
      if (!event.enter) return false
      beginCommand()
      return true
    },
    'navigation',
    { priority: 70 },
  )

  // Typing while the command prompt is open.
  useKeyHandler(
    (event) => {
      if (event.escape) {
        setMode('browse')
        setInput('')
        return true
      }
      if (event.enter) {
        submitInput()
        return true
      }
      if (event.backspace) {
        setInput((prev) => prev.slice(0, -1))
        return true
      }
      if (event.isPrintable && event.text !== '') {
        setInput((prev) => prev + event.text)
        return true
      }
      return false
    },
    'command',
    { enabled: mode === 'command', priority: 70 },
  )

  // Typing while stdin is forwarded to the running process.
  useKeyHandler(
    (event) => {
      if (event.escape) {
        cancelProcess()
        return true
      }
      if (event.enter) {
        session.sendInput(input + '\n')
        setInput('')
        return true
      }
      if (event.backspace) {
        setInput((prev) => prev.slice(0, -1))
        return true
      }
      if (event.isPrintable && event.text !== '') {
        setInput((prev) => prev + event.text)
        return true
      }
      return false
    },
    'process',
    { enabled: mode === 'stdin', priority: 70 },
  )

  return (
    <Box flexDirection="column">
      {mode === 'browse' ? (
        <Text dimColor>Press Enter to type a command.</Text>
      ) : (
        <Box>
          <Text bold color={colors.focus.active}>
            {mode === 'command' ? '> ' : ''}
          </Text>
          {input.length > 0 ? (
            <Text>{input}</Text>
          ) : (
            <Text dimColor>
              {mode === 'command' ? 'Type a command...' : 'Type stdin...'}
            </Text>
          )}
          <Text color={colors.focus.ring}>|</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <ProcessOutputPanel
          events={session.events}
          status={session.status}
          activeCommand={activeCommand}
        />
      </Box>
    </Box>
  )
}

function Shell() {
  const { currentScreen } = useNavigation()
  return (
    <AppShell
      topBar={
        <TopBar appName="Runeframe" screenTitle={currentScreen.title} />
      }
    >
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
