#!/usr/bin/env node
/**
 * Local-source harness for `examples/test-app`.
 *
 * The app is a local-source consumer now: TypeScript `paths` in
 * `examples/test-app/tsconfig.json` and the Vitest alias in
 * `examples/test-app/vitest.config.ts` map the bare `runeframe`,
 * `runeframe/experimental` and `runeframe/windows-input` specifiers to the
 * repository entry points (`src/index.ts`, `src/experimental/index.ts`,
 * `src/input/transports/windows/index.ts`), while `react` and `ink` resolve as
 * singletons from the repository root `node_modules`. This runner:
 *
 *   1. validates that the local source entry points exist, that
 *      `examples/test-app/package.json` declares no package-local `runeframe`,
 *      `react` or `ink` dependency, and that its lockfile never resolves a
 *      published `runeframe` package from the registry,
 *   2. installs `examples/test-app` with `npm ci` only when its dependencies are
 *      absent or stale, using a lockfile-hash stamp under its own `node_modules`
 *      so an already-installed launch never touches the registry,
 *   3. verifies the install left no package-local `runeframe`, `react` or `ink`
 *      copies behind and that `react`/`ink` resolve from the repository root
 *      singleton installs,
 *   4. check mode (`--check`, CI): runs typecheck + the full test suite and exits;
 *   5. launch mode (default, `npm run test-app`): runs the automated showcase
 *      smoke test, then starts the interactive Ink app with Ctrl-C forwarded to
 *      the child process.
 *
 * Usage:
 *   node scripts/test-app.mjs          # smoke test, then interactive app
 *   node scripts/test-app.mjs --check  # install + typecheck + tests (no launch)
 */
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const projectDir = path.join(repoRoot, 'examples', 'test-app')
const projectManifestPath = path.join(projectDir, 'package.json')
const projectLockPath = path.join(projectDir, 'package-lock.json')
const projectModulesDir = path.join(projectDir, 'node_modules')
const rootManifestPath = path.join(repoRoot, 'package.json')
const rootModulesDir = path.join(repoRoot, 'node_modules')
const stampPath = path.join(
  projectModulesDir,
  '.runeframe-test-app-install-stamp.json',
)

// Local-source entry points the test app aliases the bare `runeframe`,
// `runeframe/experimental` and `runeframe/windows-input` specifiers to; they
// must exist in the repository.
const LOCAL_SOURCE_FILES = [
  path.join('src', 'index.ts'),
  path.join('src', 'experimental', 'index.ts'),
  path.join('src', 'input', 'transports', 'windows', 'index.ts'),
]
// Must never exist under examples/test-app/node_modules: runeframe comes from
// the repository source, react/ink from the repository root singleton install.
const FORBIDDEN_LOCAL_PACKAGES = ['runeframe', 'react', 'ink']
const ROOT_SINGLETON_PACKAGES = ['react', 'ink']

function log(message) {
  console.log(`[test-app] ${message}`)
}

function fail(message) {
  throw new Error(message)
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function assertSupportedNode() {
  const major = Number.parseInt(process.versions.node.split('.')[0], 10)
  if (!(major >= 22)) {
    fail(`Node >=22 is required for examples/test-app, running ${process.versions.node}`)
  }
}

/** Dependencies the app expects to install locally (singletons excluded). */
function declaredLocalPackages(manifest) {
  const names = new Set()
  for (const field of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ]) {
    for (const name of Object.keys(manifest[field] ?? {})) {
      names.add(name)
    }
  }
  return [...names]
    .filter((name) => !FORBIDDEN_LOCAL_PACKAGES.includes(name))
    .sort()
}

function assertProjectManifest() {
  if (!fs.existsSync(projectManifestPath)) {
    fail(`missing ${path.relative(repoRoot, projectManifestPath)}`)
  }
  const manifest = readJson(projectManifestPath)
  for (const field of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ]) {
    for (const name of FORBIDDEN_LOCAL_PACKAGES) {
      if (manifest[field]?.[name] !== undefined) {
        fail(
          `examples/test-app/package.json declares "${name}" in ${field}; the app ` +
            'must consume runeframe from the repository source and react/ink from ' +
            'the repository root node_modules, never a package-local copy.',
        )
      }
    }
  }
}

function assertLocalSource() {
  if (!fs.existsSync(rootManifestPath)) {
    fail('missing repository root package.json')
  }
  const rootManifest = readJson(rootManifestPath)
  if (rootManifest.name !== 'runeframe') {
    fail(
      `repository root package.json is ${JSON.stringify(rootManifest.name)}, ` +
        'expected "runeframe"',
    )
  }
  for (const relative of LOCAL_SOURCE_FILES) {
    const filePath = path.join(repoRoot, relative)
    if (!fs.existsSync(filePath)) {
      fail(
        `local runeframe source entry point is missing: ${relative}. The test app ` +
          'resolves the bare runeframe specifiers via tsconfig paths / Vitest ' +
          'aliases to these repository files.',
      )
    }
  }
  for (const name of ROOT_SINGLETON_PACKAGES) {
    const manifestPath = path.join(rootModulesDir, name, 'package.json')
    if (!fs.existsSync(manifestPath)) {
      fail(
        `the repository root node_modules is missing ${name}; run \`npm install\` ` +
          'at the repository root before the test app so both share one instance.',
      )
    }
  }
}

function assertLockHasNoPublishedRuneframe() {
  if (!fs.existsSync(projectLockPath)) {
    fail(
      'examples/test-app/package-lock.json is missing; run `npm install` inside ' +
        'examples/test-app and commit the lockfile so `npm ci` stays deterministic.',
    )
  }
  const lockText = fs.readFileSync(projectLockPath, 'utf8')
  let lock
  try {
    lock = JSON.parse(lockText)
  } catch (error) {
    fail(`unparseable examples/test-app/package-lock.json: ${error.message}`)
  }
  if (lock.packages?.['node_modules/runeframe'] || lock.dependencies?.runeframe) {
    fail(
      'examples/test-app/package-lock.json still contains a package-local ' +
        'runeframe entry; runeframe must resolve from the repository src via ' +
        'tsconfig paths / Vitest alias. Regenerate the lockfile with `npm install`.',
    )
  }
  if (lockText.includes('registry.npmjs.org/runeframe')) {
    fail(
      'examples/test-app/package-lock.json still resolves the published runeframe ' +
        'registry package; remove the dependency and regenerate the lockfile.',
    )
  }
}

/**
 * Lockfile-only stamp key: any change to examples/test-app/package-lock.json
 * invalidates the install, nothing else does.
 */
function computeLockHash() {
  if (!fs.existsSync(projectLockPath)) {
    fail(
      'examples/test-app/package-lock.json is missing; run `npm install` inside ' +
        'examples/test-app and commit the lockfile so `npm ci` stays deterministic.',
    )
  }
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(projectLockPath))
    .digest('hex')
}

function localPackagePath(name) {
  return path.join(projectModulesDir, ...name.split('/'))
}

function assertNoLocalCopies() {
  for (const name of FORBIDDEN_LOCAL_PACKAGES) {
    const localPath = localPackagePath(name)
    if (fs.existsSync(localPath)) {
      fail(
        `${path.relative(repoRoot, localPath)} is a package-local ${name} copy; ` +
          'the app must consume runeframe from the repository source and react/ink ' +
          'from the repository root node_modules.',
      )
    }
  }
}

function assertDeclaredPackagesInstalled() {
  const manifest = readJson(projectManifestPath)
  for (const name of declaredLocalPackages(manifest)) {
    const manifestPath = path.join(localPackagePath(name), 'package.json')
    if (!fs.existsSync(manifestPath)) {
      fail(
        `examples/test-app is missing its declared dependency "${name}"; ` +
          'delete examples/test-app/node_modules and rerun so `npm ci` installs it.',
      )
    }
  }
}

function assertRootSingletonResolution() {
  const projectRequire = createRequire(path.join(projectDir, 'package.json'))
  const rootPrefix = rootModulesDir + path.sep
  for (const name of ROOT_SINGLETON_PACKAGES) {
    let resolved
    try {
      resolved = projectRequire.resolve(name)
    } catch (error) {
      fail(
        `could not resolve ${name} from examples/test-app (${error.message}); ` +
          'run `npm install` at the repository root first.',
      )
    }
    if (!resolved.startsWith(rootPrefix)) {
      fail(
        `${name} resolves to ${resolved} instead of the repository root ` +
          `node_modules singleton (${rootModulesDir}); remove the package-local copy.`,
      )
    }
  }
}

function isInstallCurrent() {
  if (!fs.existsSync(stampPath)) return false
  let stamp
  try {
    stamp = readJson(stampPath)
  } catch {
    return false
  }
  if (stamp.lockHash !== computeLockHash()) return false
  for (const name of FORBIDDEN_LOCAL_PACKAGES) {
    if (fs.existsSync(localPackagePath(name))) return false
  }
  for (const name of declaredLocalPackages(readJson(projectManifestPath))) {
    const manifestPath = path.join(localPackagePath(name), 'package.json')
    if (!fs.existsSync(manifestPath)) return false
  }
  return true
}

function writeStamp() {
  fs.writeFileSync(
    stampPath,
    `${JSON.stringify(
      {
        lockHash: computeLockHash(),
        installedAt: new Date().toISOString(),
        node: process.versions.node,
      },
      null,
      2,
    )}\n`,
  )
}

/**
 * Windows requires a shell to spawn `npm.cmd`; when running under an npm
 * script we reuse the current npm CLI through `process.execPath` instead.
 */
function npmInvocation(args) {
  const npmExecPath = process.env.npm_execpath
  if (npmExecPath && fs.existsSync(npmExecPath)) {
    return { command: process.execPath, args: [npmExecPath, ...args], shell: false }
  }
  const isWindows = process.platform === 'win32'
  return {
    command: isWindows ? 'npm.cmd' : 'npm',
    args,
    shell: isWindows,
  }
}

function spawnNpm(args, { cwd, stdio = 'inherit' }) {
  const invocation = npmInvocation(args)
  return spawn(invocation.command, invocation.args, {
    cwd,
    stdio,
    shell: invocation.shell,
    env: process.env,
  })
}

function runNpmToCompletion(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawnNpm(args, { cwd })
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`npm ${args.join(' ')} was terminated by ${signal}`))
        return
      }
      resolve(code ?? 1)
    })
  })
}

/**
 * Run the interactive app and forward SIGINT/SIGTERM so Ctrl-C reaches the
 * child cleanly. Resolves with the child's exit code (130/143 on signals).
 */
function runInteractiveNpm(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawnNpm(args, { cwd })
    let settled = false
    let forceTimer = null

    const forward = (signal) => {
      if (settled) return
      if (!child.killed) {
        try {
          child.kill(signal)
        } catch {
          // The child may already be gone; the exit handler below wins.
        }
      }
      if (forceTimer === null) {
        forceTimer = setTimeout(() => {
          if (!settled) {
            try {
              child.kill('SIGKILL')
            } catch {
              // Ignore: the exit handler resolves the promise.
            }
          }
        }, 5000)
        forceTimer.unref?.()
      }
    }

    const cleanup = () => {
      settled = true
      if (forceTimer !== null) clearTimeout(forceTimer)
      process.removeListener('SIGINT', forward)
      process.removeListener('SIGTERM', forward)
    }

    process.on('SIGINT', forward)
    process.on('SIGTERM', forward)
    child.on('error', (error) => {
      cleanup()
      reject(error)
    })
    child.on('exit', (code, signal) => {
      cleanup()
      if (signal) {
        const signalNumber = os.constants.signals[signal] ?? 0
        resolve(128 + signalNumber)
        return
      }
      resolve(code ?? 1)
    })
  })
}

async function ensureInstalled() {
  if (isInstallCurrent()) {
    log('dependencies already installed for the current lockfile; skipping npm ci')
    return
  }
  log('installing examples/test-app dependencies (npm ci, lockfile-driven)')
  const exitCode = await runNpmToCompletion(
    ['ci', '--no-audit', '--no-fund', '--loglevel=error'],
    projectDir,
  )
  if (exitCode !== 0) {
    fail(
      `npm ci in examples/test-app failed with exit code ${exitCode}. Ensure the ` +
        'committed package-lock.json is in sync and the registry is reachable.',
    )
  }
  assertNoLocalCopies()
  assertDeclaredPackagesInstalled()
  writeStamp()
  log('install complete (lockfile stamp written)')
}

async function main() {
  assertSupportedNode()
  const checkMode = process.argv.includes('--check')
  log(`mode: ${checkMode ? 'check (typecheck + tests)' : 'launch (smoke + interactive app)'}`)

  assertProjectManifest()
  assertLocalSource()
  assertLockHasNoPublishedRuneframe()
  await ensureInstalled()
  assertNoLocalCopies()
  assertDeclaredPackagesInstalled()
  assertRootSingletonResolution()

  if (checkMode) {
    const typecheckCode = await runNpmToCompletion(['run', 'typecheck'], projectDir)
    if (typecheckCode !== 0) {
      log(`typecheck failed with exit code ${typecheckCode}`)
      process.exitCode = typecheckCode
      return
    }
    const testCode = await runNpmToCompletion(['run', 'test'], projectDir)
    if (testCode !== 0) {
      log(`tests failed with exit code ${testCode}`)
      process.exitCode = testCode
      return
    }
    log('typecheck and tests passed')
    return
  }

  const smokeCode = await runNpmToCompletion(['run', 'smoke'], projectDir)
  if (smokeCode !== 0) {
    log(`showcase smoke test failed with exit code ${smokeCode}; not launching the app`)
    process.exitCode = smokeCode
    return
  }
  log('showcase smoke test passed; launching the interactive app (Ctrl-C exits)')
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    log(
      'note: stdin/stdout are not TTYs; the interactive Ink app needs a real ' +
        'terminal for key input. Use `npm run test-app:check` in CI.',
    )
  }
  const launchCode = await runInteractiveNpm(['run', 'start'], projectDir)
  process.exitCode = launchCode
  log(`interactive app exited with code ${launchCode}`)
}

main().catch((error) => {
  console.error(`[test-app] ${error.message}`)
  process.exitCode = 1
})
