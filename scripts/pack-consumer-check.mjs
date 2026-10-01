#!/usr/bin/env node
/**
 * Real packed-consumer contract check for the ESM-only Runeframe package.
 *
 * `npm run pack:check` builds + stages the package and then runs this script.
 * It:
 *   1. packs an actual tarball with lifecycle scripts suppressed (no duplicate
 *      build),
 *   2. installs the tarball by path into a disposable consumer project under
 *      node_modules/.cache (never referenced by source or local dist paths),
 *   3. verifies ESM imports of `runeframe`, `runeframe/experimental` and
 *      `runeframe/windows-input` by package name resolve to the extracted
 *      tarball, expose the canonical MouseArea / FrameworkProvider values, keep
 *      private mouse internals unexported, and resolve the Windows helper
 *      executables inside the installed package,
 *   4. asserts the tarball ships both staged AOT executables, no framework
 *      dependent `.runtimeconfig.json`/`.deps.json` sidecars and no CJS,
 *   5. verifies `require()` of all entry points is rejected with
 *      ERR_PACKAGE_PATH_NOT_EXPORTED (no broken CJS entry),
 *   6. typechecks a TypeScript consumer importing MouseBounds/MouseAreaProps
 *      from the tarball's declarations,
 *   7. on a Windows host, smoke-runs the installed host-architecture helper
 *      with `--help` (no `dotnet` CLI, no CONIN opening) and expects the usage
 *      text and exit 0.
 *
 * The full check requires the staged NativeAOT executables; run
 * `npm run build:native-windows` once before `npm run pack:check`. Peer
 * `react`/`ink` resolve from this repository's dev install through the
 * consumer's parent node_modules chain; nothing is fetched from a registry.
 * All scratch state is removed in `finally`.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  HELPER_EXECUTABLE_NAME,
  NATIVE_RIDS,
  STAGED_BINARIES_RELATIVE,
} from './stage-native-windows.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')

const scratchRoot = path.join(
  repoRoot,
  'node_modules',
  '.cache',
  'runeframe-pack-consumer-check',
)
const tarballDir = path.join(scratchRoot, 'tarball')
const consumerDir = path.join(scratchRoot, 'consumer')

const REQUIRED_DIST_ARTIFACTS = [
  'dist/index.js',
  'dist/index.d.ts',
  'dist/experimental/index.js',
  'dist/experimental/index.d.ts',
  'dist/windows-input.js',
  'dist/windows-input.d.ts',
]

/** Published JS entries: exactly these three, no shared chunks. */
const REQUIRED_JS_ENTRIES = [
  'dist/index.js',
  'dist/experimental/index.js',
  'dist/windows-input.js',
]

/** Staged NativeAOT executables, one per supported RID. */
const REQUIRED_NATIVE_ARTIFACTS = NATIVE_RIDS.map(
  (rid) => `${STAGED_BINARIES_RELATIVE}/${rid}/${HELPER_EXECUTABLE_NAME}`,
)

const FRAMEWORK_DEPENDENT_SUFFIXES = ['.runtimeconfig.json', '.deps.json']

function log(message) {
  console.log(`[pack:check] ${message}`)
}

function listFilesRecursive(directory) {
  const files = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...listFilesRecursive(entryPath))
    else files.push(entryPath)
  }
  return files
}

function toPosixRelative(absolutePath) {
  return path.relative(repoRoot, absolutePath).split(path.sep).join('/')
}

function run(command, args, { cwd = repoRoot, shell = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    shell,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.error) {
    throw new Error(`Failed to run ${command}: ${result.error.message}`)
  }
  if (result.status !== 0) {
    const details = [
      `Command failed (exit ${result.status}): ${command} ${args.join(' ')}`,
      result.stdout?.trim(),
      result.stderr?.trim(),
    ].filter(Boolean)
    throw new Error(details.join('\n'))
  }
  return result
}

function runNpm(args, cwd) {
  const npmExecPath = process.env.npm_execpath
  if (npmExecPath && fs.existsSync(npmExecPath)) {
    return run(process.execPath, [npmExecPath, ...args], { cwd })
  }
  // Direct invocation outside an npm script: .cmd wrappers need a shell on
  // Windows (Node refuses to spawn them without one).
  const isWindows = process.platform === 'win32'
  return run(isWindows ? 'npm.cmd' : 'npm', args, { cwd, shell: isWindows })
}

function assertNodeVersion() {
  const major = Number.parseInt(process.versions.node.split('.')[0], 10)
  assert.ok(
    major >= 22,
    `pack:check requires Node >=22, running ${process.versions.node}`,
  )
}

function assertBuildArtifacts() {
  for (const relativePath of [
    ...REQUIRED_DIST_ARTIFACTS,
    ...REQUIRED_NATIVE_ARTIFACTS,
  ]) {
    assert.ok(
      fs.existsSync(path.join(repoRoot, relativePath)),
      `missing build artifact ${relativePath}; run \`npm run build && npm run stage:native-windows\` first`,
    )
  }
  assert.ok(
    !fs.existsSync(path.join(repoRoot, 'dist', 'index.cjs')),
    'ESM-only build must not emit dist/index.cjs',
  )

  const distFiles = listFilesRecursive(path.join(repoRoot, 'dist')).map(
    toPosixRelative,
  )
  const cjsArtifacts = distFiles.filter((file) => file.endsWith('.cjs'))
  assert.deepEqual(
    cjsArtifacts,
    [],
    `dist/ must not contain CJS artifacts: ${cjsArtifacts.join(', ')}`,
  )
  const jsEntries = distFiles
    .filter((file) => file.endsWith('.js'))
    .sort()
  assert.deepEqual(
    jsEntries,
    [...REQUIRED_JS_ENTRIES].sort(),
    `dist/ must contain exactly the published JS entries, found: ${jsEntries.join(', ')}`,
  )
  for (const relativePath of REQUIRED_NATIVE_ARTIFACTS) {
    const stats = fs.statSync(path.join(repoRoot, relativePath))
    assert.ok(
      stats.size > 0,
      `${relativePath} must be a non-empty AOT executable`,
    )
  }
}

function packTarball() {
  const result = runNpm(
    [
      'pack',
      '--ignore-scripts',
      '--json',
      '--pack-destination',
      tarballDir,
    ],
    repoRoot,
  )
  let entries
  try {
    entries = JSON.parse(result.stdout)
  } catch {
    throw new Error(
      `Unparsable npm pack --json output:\n${result.stdout}\n${result.stderr}`,
    )
  }
  assert.ok(Array.isArray(entries) && entries.length === 1, 'npm pack must emit exactly one tarball entry')
  const entry = entries[0]
  const tarballPath = path.isAbsolute(entry.filename)
    ? entry.filename
    : path.join(tarballDir, entry.filename)
  assert.ok(fs.existsSync(tarballPath), `tarball not found at ${tarballPath}`)

  const packedPaths = (entry.files ?? []).map((file) => file.path)
  for (const required of [
    'package.json',
    ...REQUIRED_DIST_ARTIFACTS,
    ...REQUIRED_NATIVE_ARTIFACTS,
  ]) {
    assert.ok(
      packedPaths.includes(required),
      `tarball is missing ${required} (packed: ${packedPaths.join(', ')})`,
    )
  }
  const cjsArtifacts = packedPaths.filter((file) => file.endsWith('.cjs'))
  assert.deepEqual(
    cjsArtifacts,
    [],
    `ESM-only tarball must not ship CJS artifacts: ${cjsArtifacts.join(', ')}`,
  )
  const frameworkDependentArtifacts = packedPaths.filter((file) =>
    FRAMEWORK_DEPENDENT_SUFFIXES.some((suffix) => file.endsWith(suffix)),
  )
  assert.deepEqual(
    frameworkDependentArtifacts,
    [],
    `tarball must not ship framework-dependent sidecars: ${frameworkDependentArtifacts.join(', ')}`,
  )
  const packedJsEntries = packedPaths
    .filter((file) => file.startsWith('dist/') && file.endsWith('.js'))
    .sort()
  assert.deepEqual(
    packedJsEntries,
    [...REQUIRED_JS_ENTRIES].sort(),
    `tarball must ship exactly the published JS entries, found: ${packedJsEntries.join(', ')}`,
  )
  log(`packed ${path.basename(tarballPath)} with ${packedPaths.length} files`)
  return tarballPath
}

function installConsumer(tarballPath) {
  fs.writeFileSync(
    path.join(consumerDir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'runeframe-pack-consumer-check',
        version: '0.0.0',
        private: true,
        type: 'module',
      },
      null,
      2,
    )}\n`,
  )
  // --legacy-peer-deps keeps npm from installing/fetching the peers: the
  // consumer resolves react/ink from this repository's dev install instead.
  runNpm(
    [
      'install',
      '--no-save',
      '--ignore-scripts',
      '--legacy-peer-deps',
      '--no-audit',
      '--no-fund',
      '--loglevel=error',
      tarballPath,
    ],
    consumerDir,
  )

  const installedPackageDir = path.join(consumerDir, 'node_modules', 'runeframe')
  const installedManifestPath = path.join(installedPackageDir, 'package.json')
  assert.ok(
    fs.existsSync(installedManifestPath),
    'tarball did not install runeframe into the consumer node_modules',
  )
  const manifest = JSON.parse(fs.readFileSync(installedManifestPath, 'utf8'))

  assert.equal(manifest.type, 'module', 'published package must keep type:module')
  assert.equal(
    manifest.main,
    undefined,
    'ESM-only package must not declare a CJS main',
  )
  assert.equal(
    manifest.dependencies,
    undefined,
    'package must not ship runtime dependencies',
  )
  assert.equal(
    manifest.exports?.['.']?.require,
    undefined,
    'root exports must not keep a require condition',
  )
  assert.equal(
    manifest.exports?.['./experimental']?.require,
    undefined,
    './experimental exports must not keep a require condition',
  )
  assert.equal(
    manifest.exports?.['.']?.default,
    undefined,
    'root exports must not keep a default fallback into the ESM graph',
  )
  assert.equal(
    manifest.exports?.['./experimental']?.default,
    undefined,
    './experimental exports must not keep a default fallback into the ESM graph',
  )
  assert.equal(manifest.exports?.['.']?.import, './dist/index.js')
  assert.equal(manifest.exports?.['.']?.types, './dist/index.d.ts')
  assert.equal(
    manifest.exports?.['./experimental']?.import,
    './dist/experimental/index.js',
  )
  assert.equal(
    manifest.exports?.['./experimental']?.types,
    './dist/experimental/index.d.ts',
  )
  assert.equal(
    manifest.exports?.['./windows-input']?.import,
    './dist/windows-input.js',
  )
  assert.equal(
    manifest.exports?.['./windows-input']?.types,
    './dist/windows-input.d.ts',
  )
  assert.equal(
    manifest.exports?.['./windows-input']?.require,
    undefined,
    './windows-input exports must not keep a require condition',
  )
  assert.equal(
    manifest.exports?.['./windows-input']?.default,
    undefined,
    './windows-input exports must not keep a default fallback',
  )
  assert.equal(manifest.engines?.node, '>=22.0.0')
  assert.equal(manifest.peerDependencies?.react, '^19.2.5')
  assert.equal(manifest.peerDependencies?.ink, '^7.0.2')

  const distEntries = fs.readdirSync(path.join(installedPackageDir, 'dist'))
  assert.ok(
    !distEntries.some((name) => name.endsWith('.cjs')),
    `installed dist/ must not contain .cjs files: ${distEntries.join(', ')}`,
  )
  const experimentalDistEntries = fs.readdirSync(
    path.join(installedPackageDir, 'dist', 'experimental'),
  )
  assert.ok(
    !experimentalDistEntries.some((name) => name.endsWith('.cjs')),
    `installed dist/experimental/ must not contain .cjs files: ${experimentalDistEntries.join(', ')}`,
  )

  for (const relativePath of REQUIRED_DIST_ARTIFACTS) {
    assert.ok(
      fs.existsSync(path.join(installedPackageDir, relativePath)),
      `installed package is missing ${relativePath}`,
    )
  }
  for (const relativePath of REQUIRED_NATIVE_ARTIFACTS) {
    const installedPath = path.join(installedPackageDir, relativePath)
    assert.ok(
      fs.existsSync(installedPath),
      `installed package is missing ${relativePath}`,
    )
    assert.ok(
      fs.statSync(installedPath).size > 0,
      `installed ${relativePath} must be a non-empty AOT executable`,
    )
  }
  for (const rid of NATIVE_RIDS) {
    const stagedEntries = fs.readdirSync(
      path.join(installedPackageDir, STAGED_BINARIES_RELATIVE, rid),
    )
    assert.deepEqual(
      stagedEntries,
      [HELPER_EXECUTABLE_NAME],
      `installed dist/binaries/${rid}/ must contain exactly the AOT executable, found: ${stagedEntries.join(', ')}`,
    )
  }
  log('installed tarball into disposable consumer (no registry traffic)')
  return installedPackageDir
}

function writeConsumerFixtures() {
  fs.writeFileSync(
    path.join(consumerDir, 'consumer.mjs'),
    `import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = process.env.RUNEFRAME_REPO_ROOT
const consumerDir = process.env.RUNEFRAME_CONSUMER_DIR
assert.ok(repoRoot && consumerDir, 'RUNEFRAME_REPO_ROOT and RUNEFRAME_CONSUMER_DIR are required')

// Package-name resolution must land on the extracted tarball, never on source
// or the repository's own dist directory.
assert.equal(
  fileURLToPath(import.meta.resolve('runeframe')),
  path.join(consumerDir, 'node_modules', 'runeframe', 'dist', 'index.js'),
)
assert.equal(
  fileURLToPath(import.meta.resolve('runeframe/experimental')),
  path.join(consumerDir, 'node_modules', 'runeframe', 'dist', 'experimental', 'index.js'),
)
assert.equal(
  fileURLToPath(import.meta.resolve('runeframe/windows-input')),
  path.join(consumerDir, 'node_modules', 'runeframe', 'dist', 'windows-input.js'),
)

// Peers resolve from this repository's dev install via the parent chain.
for (const peer of ['react', 'ink']) {
  const resolved = fileURLToPath(import.meta.resolve(peer))
  assert.ok(
    resolved.startsWith(repoRoot + path.sep),
    peer + ' resolved outside the repo dev install: ' + resolved,
  )
}

const root = await import('runeframe')
const experimental = await import('runeframe/experimental')

const stableRootValues = [
  'MouseArea',
  'FrameworkProvider',
  'NavigationProvider',
  'useNavigation',
  'ScreenRegistry',
  'ScreenOutlet',
  'ModalProvider',
  'useModal',
  'AsyncSessionRunner',
  'useAsyncSession',
  'NodeProcessRunner',
  'ProcessOutputPanel',
  'ThemeProvider',
  'useTheme',
  'InputConsumptionResult',
  'normalizeKey',
]
for (const name of stableRootValues) {
  assert.ok(name in root, 'missing stable root export: ' + name)
}
assert.equal(typeof root.MouseArea, 'function', 'MouseArea must be a value export')
assert.equal(typeof root.FrameworkProvider, 'function', 'FrameworkProvider must be a value export')
assert.equal(typeof root.NavigationProvider, 'function', 'NavigationProvider must be a value export')
assert.equal(root.InputConsumptionResult.Consumed, 1, 'InputConsumptionResult must be live')
assert.equal(root.KEY_ENTER, 'enter', 'KEY_ENTER must be live')
assert.equal(
  typeof root.experimental.ScreenTransition,
  'function',
  'experimental namespace must be exposed from the root',
)

const privateMouseInternals = [
  'MouseProvider',
  'useMouseRegistry',
  'MouseInputParser',
  'MouseAreaRegistration',
  'MouseRegistryValue',
  'MOUSE_ENABLE_SEQUENCE',
  'MOUSE_RESET_SEQUENCE',
  'DEFAULT_MOUSE_PREFIX_TIMEOUT_MS',
  'createSgrInputMultiplexer',
  'DEFAULT_SGR_INPUT_FLUSH_TIMEOUT_MS',
  'MAX_SGR_INPUT_FLUSH_TIMEOUT_MS',
]
for (const name of privateMouseInternals) {
  assert.ok(!(name in root), 'private mouse internal leaked from root: ' + name)
  assert.ok(!(name in experimental), 'private mouse internal leaked from /experimental: ' + name)
}

assert.equal(typeof experimental.KeyboardRegistry, 'function', 'KeyboardRegistry must be a value export')
assert.equal(typeof experimental.ScreenTransition, 'function', 'ScreenTransition must be a value export')

// The Windows entry is a separate graph: importing it must resolve inside the
// installed package and its helper resolution must point at the staged
// binaries next to the installed dist, never at repository paths.
const windowsInput = await import('runeframe/windows-input')
const installedDist = path.join(consumerDir, 'node_modules', 'runeframe', 'dist')

assert.equal(
  typeof windowsInput.createWindowsInputTransport,
  'function',
  'createWindowsInputTransport must be a value export',
)
assert.equal(
  windowsInput.WINDOWS_INPUT_HELPER_EXECUTABLE,
  'Runeframe.Win32Input.exe',
  'helper executable name must be exported',
)
assert.equal(
  windowsInput.resolveWindowsInputExecutable('win32', 'x64'),
  path.join(installedDist, 'binaries', 'win-x64', 'Runeframe.Win32Input.exe'),
  'x64 helper resolution must point inside the installed package',
)
assert.equal(
  windowsInput.resolveWindowsInputExecutable('win32', 'arm64'),
  path.join(installedDist, 'binaries', 'win-arm64', 'Runeframe.Win32Input.exe'),
  'arm64 helper resolution must point inside the installed package',
)
assert.equal(windowsInput.resolveWindowsInputExecutable('linux', 'x64'), null)
assert.equal(windowsInput.resolveWindowsInputExecutable('win32', 'ia32'), null)

// The root entry must not eagerly import or re-export the Windows transport.
assert.ok(
  !('createWindowsInputTransport' in root),
  'root must not eagerly expose the Windows transport',
)
assert.ok(
  !('resolveWindowsInputExecutable' in root),
  'root must not eagerly expose the Windows helper resolver',
)

console.log('esm consumer import check passed')
`,
  )

  fs.writeFileSync(
    path.join(consumerDir, 'require-check.cjs'),
    `const assert = require('node:assert/strict')

function expectRequireRejected(specifier) {
  try {
    require(specifier)
  } catch (error) {
    assert.equal(
      error.code,
      'ERR_PACKAGE_PATH_NOT_EXPORTED',
      specifier + ' was rejected with unexpected code: ' + error.code + ' (' + error.message + ')',
    )
    return
  }
  assert.fail(
    specifier + ' was require()-able; the package must stay ESM-only (no CJS entry)',
  )
}

expectRequireRejected('runeframe')
expectRequireRejected('runeframe/experimental')
expectRequireRejected('runeframe/windows-input')
console.log('cjs rejection check passed (ERR_PACKAGE_PATH_NOT_EXPORTED)')
`,
  )

  fs.writeFileSync(
    path.join(consumerDir, 'consumer-types.ts'),
    `import type { MouseAreaProps, MouseBounds, MouseClickEvent } from 'runeframe'
import { FrameworkProvider, MouseArea, NavigationProvider } from 'runeframe'
import type { Keybinding } from 'runeframe/experimental'
import { KeyboardRegistry, ScreenTransition } from 'runeframe/experimental'
import {
  createWindowsInputTransport,
  resolveWindowsInputExecutable,
} from 'runeframe/windows-input'
import type {
  WindowsInputTransport,
  WindowsInputTransportOptions,
} from 'runeframe/windows-input'

// @ts-expect-error private mouse provider internals must stay unexported
import type { MouseAreaRegistration, MouseProviderProps, MouseRegistryValue } from 'runeframe'

const bounds: MouseBounds = { x: 0, y: 0, width: 2, height: 1 }
const onClick = (event: MouseClickEvent): void => {
  void event.x
}
const props: MouseAreaProps = { bounds, onClick }
const keybinding: Keybinding = {
  keys: 'q',
  scope: 'global',
  handler: () => {},
  description: 'quit',
}
const values = [MouseArea, FrameworkProvider, NavigationProvider, KeyboardRegistry, ScreenTransition] as const

const windowsOptions: WindowsInputTransportOptions = { readyTimeoutMs: 1_000 }
const windowsValues = [createWindowsInputTransport, resolveWindowsInputExecutable] as const

export type PackedConsumerContract = [typeof props, typeof keybinding, (typeof values)[number]]
export type PackedWindowsConsumerContract = [
  WindowsInputTransport,
  typeof windowsOptions,
  (typeof windowsValues)[number],
]
`,
  )

  fs.writeFileSync(
    path.join(consumerDir, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          jsx: 'react-jsx',
        },
        files: ['consumer-types.ts'],
      },
      null,
      2,
    )}\n`,
  )
}

function runConsumerChecks() {
  const environment = {
    ...process.env,
    RUNEFRAME_REPO_ROOT: repoRoot,
    RUNEFRAME_CONSUMER_DIR: consumerDir,
  }
  const runConsumer = (script) => {
    const result = spawnSync(process.execPath, [script], {
      cwd: consumerDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: environment,
    })
    if (result.status !== 0) {
      throw new Error(
        [
          `Consumer check failed: node ${script} (exit ${result.status})`,
          result.stdout?.trim(),
          result.stderr?.trim(),
        ]
          .filter(Boolean)
          .join('\n'),
      )
    }
    return result
  }

  runConsumer('consumer.mjs')
  log('ESM consumer import check passed')

  runConsumer('require-check.cjs')
  log('CJS rejection check passed (ERR_PACKAGE_PATH_NOT_EXPORTED)')

  const tscBin = path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc')
  assert.ok(
    fs.existsSync(tscBin),
    'typescript is required for the packed consumer typecheck',
  )
  run(process.execPath, [tscBin, '-p', 'tsconfig.json'], { cwd: consumerDir })
  log('TypeScript consumer typecheck passed')
}

/**
 * Windows-host-only smoke of the staged AOT executable: run it directly (no
 * `dotnet` CLI) with `--help`, which returns before CONIN is ever opened.
 * Non-Windows hosts skip this step; the static checks above still cover the
 * staged artifacts.
 */
function runInstalledHelperSmoke(installedPackageDir) {
  if (process.platform !== 'win32') {
    log('skipping native --help smoke: host is not win32')
    return
  }
  const rid =
    process.arch === 'x64'
      ? 'win-x64'
      : process.arch === 'arm64'
        ? 'win-arm64'
        : null
  if (rid === null) {
    log(`skipping native --help smoke: unsupported host architecture ${process.arch}`)
    return
  }
  const executablePath = path.join(
    installedPackageDir,
    STAGED_BINARIES_RELATIVE,
    rid,
    HELPER_EXECUTABLE_NAME,
  )
  const result = spawnSync(executablePath, ['--help'], {
    encoding: 'utf8',
    timeout: 15_000,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.error) {
    throw new Error(
      `native --help smoke failed to launch ${executablePath}: ${result.error.message}`,
    )
  }
  assert.equal(
    result.status,
    0,
    `native --help smoke must exit 0, got ${result.status}: ${result.stderr}`,
  )
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  assert.match(
    output,
    /usage:/i,
    `native --help smoke must print usage, got: ${output}`,
  )
  log(
    `native --help smoke passed (${rid}, exit 0, usage printed, no dotnet CLI, CONIN untouched)`,
  )
}

function main() {
  assertNodeVersion()
  assertBuildArtifacts()
  fs.rmSync(scratchRoot, { recursive: true, force: true })
  fs.mkdirSync(tarballDir, { recursive: true })
  fs.mkdirSync(consumerDir, { recursive: true })
  try {
    const tarballPath = packTarball()
    const installedPackageDir = installConsumer(tarballPath)
    writeConsumerFixtures()
    runConsumerChecks()
    runInstalledHelperSmoke(installedPackageDir)
  } finally {
    fs.rmSync(scratchRoot, { recursive: true, force: true })
    log('cleaned scratch directory')
  }
  log(`all packed-consumer checks passed on Node ${process.versions.node}`)
}

main()
