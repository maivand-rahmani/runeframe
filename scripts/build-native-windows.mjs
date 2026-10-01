#!/usr/bin/env node
/**
 * NativeAOT build for the production Windows input helper.
 *
 * `npm run build:native-windows` runs this script on Windows only. For each
 * supported RID it invokes the production csproj directly:
 *
 *   dotnet publish <production csproj> -c Release -r win-x64
 *     -p:PublishAot=true -p:SelfContained=true
 *     -o src/input/transports/windows/binaries/win-x64
 *
 * The publish output lands in the git-ignored source `binaries/win-<rid>/`
 * directory; `npm run stage:native-windows` validates it and copies only the
 * executable into `dist/`. Only the production helper is built: the test-only
 * harness under `tests/native/win32-input` is never involved, and no runtime
 * compilation happens at install time. `dotnet` must already be installed
 * and the NativeAOT C++ workload/toolchain available.
 *
 * This script is intentionally separate from `npm run build`: the default
 * build stays JS+DTS-only and works on any platform without native binaries.
 *
 * Usage:
 *   node scripts/build-native-windows.mjs
 *   node scripts/build-native-windows.mjs --rid win-x64
 *   node scripts/build-native-windows.mjs --rid win-x64 --rid win-arm64
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
export const repoRoot = path.resolve(scriptDir, '..')

/** RIDs this package ships; both artifacts are required to stage a release. */
export const NATIVE_RIDS = ['win-x64', 'win-arm64']

/** Executable file name produced by the production csproj AssemblyName. */
export const HELPER_EXECUTABLE_NAME = 'Runeframe.Win32Input.exe'

/** Git-ignored publish output root (relative to the repository root). */
export const SOURCE_BINARIES_RELATIVE = 'src/input/transports/windows/binaries'

/** Production csproj only; the test-only harness is never involved. */
export const PRODUCTION_CSPROJ_RELATIVE =
  'src/input/transports/windows/native/Runeframe.WindowsInput.Native.csproj'

function normalizeRids(rids) {
  const normalized = rids === undefined ? [...NATIVE_RIDS] : [...rids]
  if (normalized.length === 0) {
    throw new Error('no RIDs requested; expected win-x64 and/or win-arm64')
  }
  for (const rid of normalized) {
    if (!NATIVE_RIDS.includes(rid)) {
      throw new Error(
        `unsupported RID '${rid}'; supported: ${NATIVE_RIDS.join(', ')}`,
      )
    }
  }
  return [...new Set(normalized)]
}

/**
 * Publish the production helper for each requested RID with NativeAOT.
 *
 * Injectable `platform`/`run`/`fileExists` exist for fast script tests; the
 * defaults use the real host and `child_process.spawnSync`. Any spawn error,
 * non-zero exit or missing published executable fails the build.
 */
export function buildNativeWindows(options = {}) {
  const platform = options.platform ?? process.platform
  if (platform !== 'win32') {
    throw new Error(
      `build:native-windows requires win32 (running on '${platform}'); the helper is Windows-only and no cross-build is attempted`,
    )
  }

  const root = options.repoRoot ?? repoRoot
  const rids = normalizeRids(options.rids)
  const run = options.run ?? spawnSync
  const fileExists = options.fileExists ?? fs.existsSync
  const log = options.log ?? console.log

  const csprojPath = path.join(root, PRODUCTION_CSPROJ_RELATIVE)
  if (!fileExists(csprojPath)) {
    throw new Error(`production native project not found at ${csprojPath}`)
  }

  for (const rid of rids) {
    const outputDir = path.join(root, SOURCE_BINARIES_RELATIVE, rid)
    fs.mkdirSync(outputDir, { recursive: true })
    const args = [
      'publish',
      csprojPath,
      '-c',
      'Release',
      '-r',
      rid,
      '-p:PublishAot=true',
      '-p:SelfContained=true',
      '-o',
      outputDir,
    ]
    log(`[build:native-windows] dotnet ${args.join(' ')}`)
    const result = run('dotnet', args, { cwd: root, stdio: 'inherit' })
    if (result.error) {
      throw new Error(
        `failed to run dotnet publish for ${rid}: ${result.error.message}`,
      )
    }
    if (result.status !== 0) {
      throw new Error(
        `dotnet publish failed for ${rid} (exit ${result.status === null ? 'null' : result.status})`,
      )
    }

    const executablePath = path.join(outputDir, HELPER_EXECUTABLE_NAME)
    if (!fileExists(executablePath)) {
      throw new Error(
        `dotnet publish reported success for ${rid} but ${executablePath} is missing`,
      )
    }
    log(`[build:native-windows] published ${executablePath}`)
  }

  return rids
}

/** Parse repeatable `--rid win-x64` / `--rid=win-x64` arguments. */
export function parseRidArgs(argv) {
  if (argv.length === 0) return [...NATIVE_RIDS]
  const rids = []
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--rid') {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) {
        throw new Error('--rid requires a value (win-x64 or win-arm64)')
      }
      rids.push(value)
      index += 1
    } else if (arg.startsWith('--rid=')) {
      rids.push(arg.slice('--rid='.length))
    } else {
      throw new Error(
        `unknown argument '${arg}'; usage: node scripts/build-native-windows.mjs [--rid win-x64] [--rid win-arm64]`,
      )
    }
  }
  return normalizeRids(rids)
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url

if (invokedDirectly) {
  try {
    const rids = buildNativeWindows({ rids: parseRidArgs(process.argv.slice(2)) })
    console.log(`[build:native-windows] done: ${rids.join(', ')}`)
  } catch (error) {
    console.error(
      `[build:native-windows] ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exitCode = 1
  }
}
