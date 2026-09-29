import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { MouseAreaProps, MouseBounds, MouseClickEvent } from 'runeframe'
import { KeyboardRegistry, ScreenTransition } from 'runeframe/experimental'
import type {
  Keybinding,
  ScreenTransitionProps,
  TransitionType,
} from 'runeframe/experimental'

// Static type check: these type-only imports must resolve through the
// installed package declarations (`runeframe` and `runeframe/experimental`).
type ExperimentalContract = {
  binding: Keybinding
  transition: TransitionType
  transitionProps: ScreenTransitionProps
}
type RootContract = {
  bounds: MouseBounds
  click: MouseClickEvent
  area: MouseAreaProps
}
// @ts-expect-error private mouse internals must stay unexported from the root
type _NoMouseProvider = import('runeframe').MouseProvider

const projectDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)
const projectModulesDir = path.join(projectDir, 'node_modules')
const installedPackageDir = path.join(projectModulesDir, 'runeframe')

function readJson(filePath: string): Record<string, any> {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

describe('installed runeframe package resolution', () => {
  it('resolves runeframe and runeframe/experimental inside examples/test-app/node_modules', () => {
    expect(fileURLToPath(import.meta.resolve('runeframe'))).toBe(
      path.join(installedPackageDir, 'dist', 'index.js'),
    )
    expect(fileURLToPath(import.meta.resolve('runeframe/experimental'))).toBe(
      path.join(installedPackageDir, 'dist', 'experimental', 'index.js'),
    )
  })

  it('resolves react and ink from this project (single React instance)', () => {
    const prefix = projectModulesDir + path.sep
    for (const peer of ['react', 'ink']) {
      const resolved = fileURLToPath(import.meta.resolve(peer))
      expect(resolved.startsWith(prefix)).toBe(true)
    }
  })

  it('installs exactly runeframe 0.5.0 from the public registry', () => {
    const installed = readJson(path.join(installedPackageDir, 'package.json'))
    expect(installed.name).toBe('runeframe')
    expect(installed.version).toBe('0.5.0')
    expect(installed.type).toBe('module')
    // ESM-only contract: no synchronous CJS entry.
    expect(installed.exports?.['.']?.require).toBeUndefined()
    expect(installed.exports?.['./experimental']?.require).toBeUndefined()
    expect(fs.lstatSync(installedPackageDir).isSymbolicLink()).toBe(false)

    const appManifest = readJson(path.join(projectDir, 'package.json'))
    expect(appManifest.dependencies.runeframe).toBe('0.5.0')
    expect(appManifest.dependencies.runeframe).not.toMatch(
      /^(\^|~|file:|link:|workspace:)/,
    )

    const lock = readJson(path.join(projectDir, 'package-lock.json'))
    const locked = lock.packages['node_modules/runeframe']
    expect(locked.version).toBe('0.5.0')
    expect(locked.resolved).toBe(
      'https://registry.npmjs.org/runeframe/-/runeframe-0.5.0.tgz',
    )
  })

  it('exposes the canonical root API from the installed package', async () => {
    const api = (await import('runeframe')) as Record<string, unknown>
    const functionExports = [
      'FrameworkProvider',
      'NavigationProvider',
      'ScreenRegistry',
      'ScreenOutlet',
      'ModalProvider',
      'ThemeProvider',
      'AsyncSessionRunner',
      'NodeProcessRunner',
      'ProcessOutputPanel',
      'MouseArea',
      'useNavigation',
      'useModal',
      'useTheme',
      'useAsyncSession',
    ]
    for (const name of functionExports) {
      expect(typeof api[name], `runeframe must export ${name}`).toBe('function')
    }
    for (const internal of ['MouseProvider', 'useMouseRegistry']) {
      expect(api[internal], `${internal} must stay unexported`).toBeUndefined()
    }
  })

  it('exposes the experimental subpath as values and types', () => {
    expect(typeof KeyboardRegistry).toBe('function')
    expect(typeof ScreenTransition).toBe('function')

    const contract: ExperimentalContract | null = null
    const rootContract: RootContract | null = null
    void contract
    void rootContract
  })
})
