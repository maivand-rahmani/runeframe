#!/usr/bin/env node
/**
 * Package-consumer harness for `examples/test-app`.
 *
 * The app is a standalone consumer project pinned to the published
 * `runeframe@0.5.0` registry package. This runner:
 *
 *   1. validates that `examples/test-app/package.json` still depends on
 *      `runeframe` with the exact `"0.5.0"` specifier (never `file:`/link/workspace),
 *   2. installs `examples/test-app` with `npm ci` only when its dependencies are
 *      absent or stale, using a lockfile-hash stamp under its own `node_modules`
 *      so an already-installed launch never touches the registry,
 *   3. verifies the installed package is exactly `runeframe@0.5.0`, resolved
 *      from `https://registry.npmjs.org/` and not a symlink into the repository,
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
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const projectDir = path.join(repoRoot, 'examples', 'test-app')
const projectManifestPath = path.join(projectDir, 'package.json')
const projectLockPath = path.join(projectDir, 'package-lock.json')
const installedPackageDir = path.join(projectDir, 'node_modules', 'runeframe')
const stampPath = path.join(
  projectDir,
  'node_modules',
  '.runeframe-test-app-install-stamp.json',
)

const EXPECTED_RUNEFRAME_VERSION = '0.5.0'
const REQUIRED_PACKAGES = [
  'runeframe',
  'react',
  'ink',
  'vitest',
  'tsx',
  'typescript',
  'ink-testing-library',
]

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

function assertProjectManifest() {
  if (!fs.existsSync(projectManifestPath)) {
    fail(`missing ${path.relative(repoRoot, projectManifestPath)}`)
  }
  const manifest = readJson(projectManifestPath)
  const specifier = manifest.dependencies?.runeframe
  if (specifier !== EXPECTED_RUNEFRAME_VERSION) {
    fail(
      `examples/test-app/package.json must depend on runeframe exactly ` +
        `"${EXPECTED_RUNEFRAME_VERSION}" (found ${JSON.stringify(specifier)}). ` +
        'The harness must consume the published registry package, never a local ' +
        'tarball, file:, link: or workspace specifier.',
    )
  }
}

function computeLockHash() {
  if (!fs.existsSync(projectLockPath)) {
    fail(
      'examples/test-app/package-lock.json is missing; run `npm install` inside ' +
        'examples/test-app and commit the lockfile so `npm ci` can install from ' +
        'the public registry.',
    )
  }
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(projectManifestPath))
  hash.update(fs.readFileSync(projectLockPath))
  return hash.digest('hex')
}

function readInstalledVersion() {
  const manifestPath = path.join(installedPackageDir, 'package.json')
  if (!fs.existsSync(manifestPath)) return null
  try {
    return readJson(manifestPath).version ?? null
  } catch {
    return null
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
  if (stamp.runeframeVersion !== EXPECTED_RUNEFRAME_VERSION) return false
  if (readInstalledVersion() !== EXPECTED_RUNEFRAME_VERSION) return false
  for (const name of REQUIRED_PACKAGES) {
    const manifestPath = path.join(
      projectDir,
      'node_modules',
      ...name.split('/'),
      'package.json',
    )
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
        runeframeVersion: EXPECTED_RUNEFRAME_VERSION,
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

function assertInstalledRuneframe() {
  const manifestPath = path.join(installedPackageDir, 'package.json')
  if (!fs.existsSync(manifestPath)) {
    fail(
      `runeframe is not installed at ${path.relative(repoRoot, installedPackageDir)}; ` +
        'the install step did not produce the expected consumer dependency.',
    )
  }
  const installed = readJson(manifestPath)
  if (installed.version !== EXPECTED_RUNEFRAME_VERSION) {
    fail(
      `installed runeframe version is ${installed.version ?? 'unknown'}, expected ` +
        `exactly ${EXPECTED_RUNEFRAME_VERSION}. Remove examples/test-app/node_modules ` +
        'and rerun so `npm ci` installs the pinned registry version.',
    )
  }
  if (fs.lstatSync(installedPackageDir).isSymbolicLink()) {
    fail(
      `${path.relative(repoRoot, installedPackageDir)} is a symlink; the harness ` +
        'must consume the published registry tarball, not a link to the repository.',
    )
  }

  const lock = readJson(projectLockPath)
  const locked = lock.packages?.['node_modules/runeframe']
  if (!locked || locked.version !== EXPECTED_RUNEFRAME_VERSION) {
    fail(
      'examples/test-app/package-lock.json does not lock runeframe to exactly ' +
        `${EXPECTED_RUNEFRAME_VERSION}; regenerate the lockfile with \`npm install\`.`,
    )
  }
  const resolved = String(locked.resolved ?? '')
  if (locked.link === true || !resolved.startsWith('https://registry.npmjs.org/')) {
    fail(
      'the lockfile entry for runeframe must resolve from ' +
        `https://registry.npmjs.org/ (found ${JSON.stringify(locked.resolved)}); ` +
        'file:/link:/workspace installs are not allowed.',
    )
  }
}

async function ensureInstalled() {
  if (isInstallCurrent()) {
    log('dependencies already installed for the current lockfile; skipping npm ci')
    return
  }
  log('installing examples/test-app dependencies from the public registry (npm ci)')
  const exitCode = await runNpmToCompletion(
    ['ci', '--no-audit', '--no-fund', '--loglevel=error'],
    projectDir,
  )
  if (exitCode !== 0) {
    fail(
      `npm ci in examples/test-app failed with exit code ${exitCode}. Ensure the ` +
        'registry is reachable and the committed package-lock.json is in sync.',
    )
  }
  assertInstalledRuneframe()
  writeStamp()
  log('install complete (lockfile stamp written)')
}

async function main() {
  assertSupportedNode()
  const checkMode = process.argv.includes('--check')
  log(`mode: ${checkMode ? 'check (typecheck + tests)' : 'launch (smoke + interactive app)'}`)

  assertProjectManifest()
  await ensureInstalled()
  assertInstalledRuneframe()

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
