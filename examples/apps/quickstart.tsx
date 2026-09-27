import React from 'react'
import { Text } from 'ink'
import {
  FrameworkProvider,
  ScreenRegistry,
  AppShell,
  TopBar,
  useNavigation,
  ScreenOutlet,
} from '../../src/index.js'

const registry = new ScreenRegistry()
registry.register({
  id: 'home',
  title: 'Home',
  sidebar: true,
  category: 'main',
  component: () => <Text>Hello from runeframe</Text>,
})

function Shell() {
  const { currentScreen } = useNavigation()
  return (
    <AppShell topBar={<TopBar appName="Runeframe" screenTitle={currentScreen.title} />}>
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
