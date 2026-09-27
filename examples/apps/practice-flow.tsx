import React from 'react'
import { Box, Text } from 'ink'
import {
  FrameworkProvider,
  AppShell,
  TopBar,
  ScreenRegistry,
  useNavigation,
  StepFlow,
  ChoicePrompt,
  NumberInput,
  TextInput,
  HotkeyHintBar,
  ScreenOutlet,
} from '../../src/index.js'

// ── Practice track options ──

const TRACKS = [
  { value: 'grammar', label: 'Grammar', key: 'g', description: 'Practice grammar exercises' },
  { value: 'vocabulary', label: 'Vocabulary', key: 'v', description: 'Build your vocabulary' },
  { value: 'listening', label: 'Listening', key: 'l', description: 'Improve listening comprehension' },
  { value: 'speaking', label: 'Speaking', key: 's', description: 'Practice pronunciation' },
]

const MODES = [
  { value: 'easy', label: 'Easy', key: 'e', description: 'Gentle pace with hints' },
  { value: 'normal', label: 'Normal', key: 'n', description: 'Standard difficulty' },
  { value: 'hard', label: 'Hard', key: 'h', description: 'Fast paced, no hints' },
]

// ── Screen registry ──

const registry = new ScreenRegistry()
registry.register({
  id: 'practice',
  title: 'Practice Flow',
  sidebar: true,
  category: 'main',
  component: () => <PracticeScreen />,
})

// ── Practice screen with StepFlow ──

function PracticeScreen() {
  return (
    <Box flexDirection="column">
      <StepFlow
        steps={[
          {
            id: 'track',
            title: 'Choose a Track',
            component: (ctx) => (
              <ChoicePrompt
                label="Select a practice track:"
                items={TRACKS}
                onSelect={(item) => {
                  ctx.setData('track', item.value)
                  ctx.setData('trackLabel', item.label)
                  ctx.goNext()
                }}
                onCancel={() => {
                  console.log('Practice flow cancelled')
                }}
              />
            ),
          },
          {
            id: 'mode',
            title: 'Choose Difficulty',
            component: (ctx) => (
              <ChoicePrompt
                label="Select difficulty mode:"
                items={MODES}
                onSelect={(item) => {
                  ctx.setData('mode', item.value)
                  ctx.setData('modeLabel', item.label)
                  ctx.goNext()
                }}
              />
            ),
          },
          {
            id: 'count',
            title: 'Number of Questions',
            component: (ctx) => (
              <NumberInput
                label="Questions"
                defaultValue={10}
                min={1}
                max={100}
                onSubmit={(value) => {
                  ctx.setData('count', value)
                  ctx.goNext()
                }}
              />
            ),
          },
          {
            id: 'name',
            title: 'Your Name',
            component: (ctx) => (
              <TextInput
                placeholder="Enter your name"
                onSubmit={(value) => {
                  ctx.setData('name', value)
                  ctx.goNext()
                }}
              />
            ),
          },
          {
            id: 'review',
            title: 'Review & Start',
            component: (ctx) => (
              <Box flexDirection="column">
                <Text bold>Review your choices:</Text>
                <Box marginTop={1}>
                  <Text>Track: </Text>
                  <Text bold>{String(ctx.data.trackLabel)}</Text>
                </Box>
                <Box>
                  <Text>Mode: </Text>
                  <Text bold>{String(ctx.data.modeLabel)}</Text>
                </Box>
                <Box>
                  <Text>Questions: </Text>
                  <Text bold>{String(ctx.data.count)}</Text>
                </Box>
                <Box>
                  <Text>Name: </Text>
                  <Text bold>{String(ctx.data.name)}</Text>
                </Box>
                <Box marginTop={1}>
                  <Text dimColor>Press Enter to start or Esc to cancel</Text>
                </Box>
              </Box>
            ),
          },
        ]}
        onComplete={(data) => {
          console.log('Practice session starting:', data)
        }}
        onCancel={() => {
          console.log('Practice flow cancelled')
        }}
      />
      <Box marginTop={1}>
        <HotkeyHintBar />
      </Box>
    </Box>
  )
}

// ── Shell ──

function Shell() {
  const { currentScreen } = useNavigation()
  return (
    <AppShell topBar={<TopBar appName="Practice Flow Demo" screenTitle={currentScreen.title} />}>
      <ScreenOutlet />
    </AppShell>
  )
}

// ── App ──

export function App() {
  return (
    <FrameworkProvider registry={registry} defaultScreen="practice">
      <Shell />
    </FrameworkProvider>
  )
}
