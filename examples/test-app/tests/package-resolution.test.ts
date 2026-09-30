import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as bareRoot from 'runeframe'
import * as bareExperimental from 'runeframe/experimental'
import * as bareWindowsInput from 'runeframe/windows-input'
import type {
  MouseAreaProps,
  MouseBounds,
  MouseClickEvent,
  MouseLayoutProps,
} from 'runeframe'
import type {
  Keybinding,
  ScreenTransitionProps,
  TransitionType,
} from 'runeframe/experimental'
import type {
  WindowsInputTransport,
  WindowsInputTransportOptions,
} from 'runeframe/windows-input'
// The bare specifiers above are mapped to these exact repository source
// modules by `vitest.config.ts` and the tsconfig `paths`. Importing the source
// directly and comparing exports proves module identity instead of a
// package-local copy.
import * as localRoot from '../../../src/index.js'
import * as localExperimental from '../../../src/experimental/index.js'
import * as localWindowsInput from '../../../src/input/transports/windows/index.js'

// Static type check: these type-only imports must resolve through the aliased
// `runeframe`, `runeframe/experimental` and `runeframe/windows-input` source
// entrypoints.
type ExperimentalContract = {
  binding: Keybinding
  transition: TransitionType
  transitionProps: ScreenTransitionProps
}
type RootContract = {
  bounds: MouseBounds
  click: MouseClickEvent
  area: MouseAreaProps
  layoutProps: MouseLayoutProps
}
type WindowsInputContract = {
  options: WindowsInputTransportOptions
  transport: WindowsInputTransport
}
// @ts-expect-error private mouse internals must stay unexported from the root
type _NoMouseProvider = import('runeframe').MouseProvider

const testsDir = path.dirname(fileURLToPath(import.meta.url))
const projectDir = path.resolve(testsDir, '..')
const projectModulesDir = path.join(projectDir, 'node_modules')
const repoRoot = path.resolve(projectDir, '..', '..')
const rootModulesDir = path.join(repoRoot, 'node_modules')
const projectRequire = createRequire(import.meta.url)

// Must never exist under examples/test-app: runeframe comes from the
// repository source, react/ink from the repository root singleton install.
const forbiddenLocalPackages = ['runeframe', 'react', 'ink']

function expectSameModuleExports(
  bare: object,
  local: object,
  label: string,
): void {
  const bareExports = bare as Record<string, unknown>
  const localExports = local as Record<string, unknown>
  expect(
    Object.keys(bareExports).sort(),
    `${label} must expose the same exports as the repository source`,
  ).toEqual(Object.keys(localExports).sort())
  for (const [name, value] of Object.entries(localExports)) {
    expect(
      bareExports[name],
      `${label}.${name} must be the repository source export (module identity)`,
    ).toBe(value)
  }
}

describe('runeframe imports resolve to the repository source', () => {
  it('resolves the bare root specifier to src/index.ts by module identity', () => {
    expectSameModuleExports(bareRoot, localRoot, 'runeframe')
  })

  it('resolves the bare experimental specifier to src/experimental/index.ts by module identity', () => {
    expectSameModuleExports(
      bareExperimental,
      localExperimental,
      'runeframe/experimental',
    )
  })

  it('resolves the bare windows-input specifier to the local transport source by module identity', () => {
    expectSameModuleExports(
      bareWindowsInput,
      localWindowsInput,
      'runeframe/windows-input',
    )
  })

  it('anchors the windows-input alias to the repository transport entry and its helper binaries', () => {
    const sourceWindowsDir = path.join(
      repoRoot,
      'src',
      'input',
      'transports',
      'windows',
    )
    expect(
      fs.existsSync(path.join(sourceWindowsDir, 'index.ts')),
      'the windows-input alias must target the repository source entry',
    ).toBe(true)
    expect(
      fs.existsSync(path.join(projectModulesDir, 'runeframe')),
      'examples/test-app must not keep a package-local runeframe copy',
    ).toBe(false)
    expect(
      bareWindowsInput.resolveWindowsInputExecutable('win32', 'x64'),
      'helper resolution must anchor next to the repository source entry, not dist',
    ).toBe(
      path.join(
        sourceWindowsDir,
        'binaries',
        'win-x64',
        'Runeframe.Win32Input.exe',
      ),
    )
    expect(
      bareWindowsInput.resolveWindowsInputExecutable('win32', 'arm64'),
    ).toBe(
      path.join(
        sourceWindowsDir,
        'binaries',
        'win-arm64',
        'Runeframe.Win32Input.exe',
      ),
    )
    expect(
      bareWindowsInput.resolveWindowsInputExecutable('linux', 'x64'),
    ).toBeNull()
    expect(
      bareWindowsInput.resolveWindowsInputExecutable('win32', 'ia32'),
    ).toBeNull()
  })

  it('does not expose the Windows transport from the root entry', () => {
    const rootApi = bareRoot as unknown as Record<string, unknown>
    const localRootApi = localRoot as unknown as Record<string, unknown>
    for (const name of [
      'createWindowsInputTransport',
      'resolveWindowsInputExecutable',
      'WINDOWS_INPUT_HELPER_EXECUTABLE',
    ]) {
      expect(
        rootApi[name],
        `${name} must not be exported from the runeframe root entry`,
      ).toBeUndefined()
      expect(
        localRootApi[name],
        `${name} must not be exported from the repository root source`,
      ).toBeUndefined()
    }
  })

  it('keeps no package-local runeframe, react or ink copies', () => {
    for (const name of forbiddenLocalPackages) {
      const localPath = path.join(projectModulesDir, ...name.split('/'))
      expect(
        fs.existsSync(localPath),
        `${name} must not be installed under examples/test-app/node_modules (found ${localPath})`,
      ).toBe(false)
    }
  })

  it('resolves react and ink from the shared repository root install', () => {
    const rootPrefix = rootModulesDir + path.sep
    for (const name of ['react', 'ink']) {
      const resolved = projectRequire.resolve(name)
      expect(
        resolved.startsWith(rootPrefix),
        `${name} must resolve from the repository root node_modules (resolved ${resolved})`,
      ).toBe(true)
    }
  })

  it('retains the canonical root API through the aliased source', () => {
    const api = bareRoot as unknown as Record<string, unknown>
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
    expect(api.MouseLayout, 'runeframe must export MouseLayout').toBeDefined()
    for (const internal of ['MouseProvider', 'useMouseRegistry']) {
      expect(api[internal], `${internal} must stay unexported`).toBeUndefined()
    }
  })

  it('exposes the experimental subpath as values and types', () => {
    expect(typeof bareExperimental.KeyboardRegistry).toBe('function')
    expect(typeof bareExperimental.ScreenTransition).toBe('function')

    const contract: ExperimentalContract | null = null
    const rootContract: RootContract | null = null
    void contract
    void rootContract
  })

  it('keeps the SGR input multiplexer private to the framework source', () => {
    const experimentalApi = bareExperimental as unknown as Record<string, unknown>
    for (const name of [
      'createSgrInputMultiplexer',
      'DEFAULT_SGR_INPUT_FLUSH_TIMEOUT_MS',
      'MAX_SGR_INPUT_FLUSH_TIMEOUT_MS',
    ]) {
      expect(
        experimentalApi[name],
        `${name} must not be exported from runeframe/experimental`,
      ).toBeUndefined()
    }
  })

  it('exposes the windows-input subpath as values and types', () => {
    expect(typeof bareWindowsInput.createWindowsInputTransport).toBe('function')
    expect(
      typeof bareWindowsInput.resolveWindowsInputExecutable,
    ).toBe('function')
    expect(bareWindowsInput.WINDOWS_INPUT_HELPER_EXECUTABLE).toBe(
      'Runeframe.Win32Input.exe',
    )

    const contract: WindowsInputContract | null = null
    void contract
  })
})
