#!/usr/bin/env node
/**
 * Stage validated NativeAOT helpers into the published `dist/` tree.
 *
 * `npm run stage:native-windows` runs after `npm run build` (tsup `--clean`
 * wipes `dist/`). It fails closed unless BOTH produced AOT executables exist
 * and pass every check:
 *
 *   1. `src/input/transports/windows/binaries/win-<rid>/Runeframe.Win32Input.exe`
 *      exists for win-x64 and win-arm64 (the git-ignored publish output of
 *      `npm run build:native-windows`),
 *   2. the file is a valid PE32+ image whose COFF machine is 0x8664 (x64) or
 *      0xAA64 (ARM64) matching its RID,
 *   3. the publish output contains no framework-dependent
 *      `.runtimeconfig.json` / `.deps.json` sidecars (which would mean the
 *      publish was not actually self-contained NativeAOT),
 *   4. `dist/windows-input.js` exists, so staging cannot leave a `dist/` that
 *      ships binaries without the entry that resolves them.
 *
 * Only the executable is copied, to `dist/binaries/win-<rid>/`; no PDB, DLL or
 * JSON sidecar is ever staged, and no placeholder is ever created. Validation
 * of all RIDs happens before any `dist/` mutation, so a failure stages nothing.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  HELPER_EXECUTABLE_NAME,
  NATIVE_RIDS,
  SOURCE_BINARIES_RELATIVE,
} from './build-native-windows.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
export const repoRoot = path.resolve(scriptDir, '..')

export { HELPER_EXECUTABLE_NAME, NATIVE_RIDS, SOURCE_BINARIES_RELATIVE }

/** Published staging root (relative to the repository root). */
export const STAGED_BINARIES_RELATIVE = 'dist/binaries'

/** Entry that resolves `./binaries/win-<arch>/` from its own URL. */
export const WINDOWS_ENTRY_RELATIVE = 'dist/windows-input.js'

/** COFF machine values accepted for each RID. */
export const PE_MACHINE_BY_RID = {
  'win-x64': 0x8664,
  'win-arm64': 0xaa64,
}

const PE32_PLUS_MAGIC = 0x20b

/**
 * Extract the COFF machine type from a PE32+ image buffer, throwing a
 * descriptive error for anything that is not a structurally valid 64-bit PE
 * (DOS `MZ`, bounded `PE\0\0` header, PE32+ optional-header magic).
 */
export function parsePeMachine(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError('PE parsing requires a Buffer')
  }
  if (buffer.length < 0x40) {
    throw new Error('file is shorter than the DOS header')
  }
  if (buffer[0] !== 0x4d || buffer[1] !== 0x5a) {
    throw new Error('missing MZ signature')
  }
  const peOffset = buffer.readUInt32LE(0x3c)
  if (peOffset < 0x40 || peOffset + 0x1a > buffer.length) {
    throw new Error(`PE header offset ${peOffset} is out of range`)
  }
  if (buffer.readUInt32LE(peOffset) !== 0x00004550) {
    throw new Error('missing PE\\0\\0 signature')
  }
  const optionalMagic = buffer.readUInt16LE(peOffset + 0x18)
  if (optionalMagic !== PE32_PLUS_MAGIC) {
    throw new Error(
      `not a PE32+ image (optional header magic 0x${optionalMagic.toString(16)})`,
    )
  }
  return buffer.readUInt16LE(peOffset + 4)
}

/** True for names that mark a framework-dependent (non-AOT) publish. */
export function isFrameworkDependentArtifact(fileName) {
  return (
    fileName.endsWith('.runtimeconfig.json') || fileName.endsWith('.deps.json')
  )
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

/**
 * Validate one produced helper: non-empty, valid PE32+, machine matching its
 * RID. Returns `{ size, machine }`; throws otherwise.
 */
export function validateAotExecutable(executablePath, rid) {
  const expectedMachine = PE_MACHINE_BY_RID[rid]
  if (expectedMachine === undefined) {
    throw new Error(
      `unsupported RID '${rid}'; supported: ${NATIVE_RIDS.join(', ')}`,
    )
  }
  const stats = fs.statSync(executablePath)
  if (!stats.isFile() || stats.size === 0) {
    throw new Error(`${executablePath} is not a non-empty file`)
  }
  let machine
  try {
    machine = parsePeMachine(fs.readFileSync(executablePath))
  } catch (error) {
    throw new Error(
      `${executablePath} is not a valid PE executable: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (machine !== expectedMachine) {
    throw new Error(
      `${executablePath} has PE machine 0x${machine.toString(16)}; expected 0x${expectedMachine.toString(16)} for ${rid}`,
    )
  }
  return { size: stats.size, machine }
}

/**
 * Validate every produced helper and copy only the executables into
 * `dist/binaries/win-<rid>/`. Fails closed (and mutates nothing) unless both
 * RIDs are present, valid and sidecar-free, and the windows entry was built.
 * Returns the staged plan.
 */
export function stageNativeWindows(options = {}) {
  const root = options.repoRoot ?? repoRoot
  const log = options.log ?? console.log

  const windowsEntryPath = path.join(root, WINDOWS_ENTRY_RELATIVE)
  if (!fs.existsSync(windowsEntryPath)) {
    throw new Error(
      `missing ${WINDOWS_ENTRY_RELATIVE}; run \`npm run build\` before staging so tsup produced the windows entry`,
    )
  }

  // Validate everything before touching dist/: a failure stages nothing.
  const plan = []
  for (const rid of NATIVE_RIDS) {
    const sourceDir = path.join(root, SOURCE_BINARIES_RELATIVE, rid)
    const executablePath = path.join(sourceDir, HELPER_EXECUTABLE_NAME)
    if (!fs.existsSync(executablePath)) {
      throw new Error(
        `missing NativeAOT helper ${path.join(SOURCE_BINARIES_RELATIVE, rid, HELPER_EXECUTABLE_NAME)}; run \`npm run build:native-windows\` first (no placeholder is ever staged)`,
      )
    }
    const frameworkDependent = listFilesRecursive(sourceDir)
      .map((file) => path.basename(file))
      .filter(isFrameworkDependentArtifact)
    if (frameworkDependent.length > 0) {
      throw new Error(
        `framework-dependent publish artifacts found for ${rid}: ${frameworkDependent.join(', ')}; the helper must be a self-contained NativeAOT executable`,
      )
    }
    const { size, machine } = validateAotExecutable(executablePath, rid)
    plan.push({ rid, executablePath, size, machine })
  }

  // Deterministic staging: rebuild dist/binaries from the validated plan so
  // no stale sidecar or foreign file can ever be packed.
  const stagedRoot = path.join(root, STAGED_BINARIES_RELATIVE)
  fs.rmSync(stagedRoot, { recursive: true, force: true })
  for (const entry of plan) {
    const targetDir = path.join(stagedRoot, entry.rid)
    fs.mkdirSync(targetDir, { recursive: true })
    const targetPath = path.join(targetDir, HELPER_EXECUTABLE_NAME)
    fs.copyFileSync(entry.executablePath, targetPath)
    const copiedSize = fs.statSync(targetPath).size
    if (copiedSize !== entry.size) {
      throw new Error(
        `staged copy of ${targetPath} has size ${copiedSize}; expected ${entry.size}`,
      )
    }
    log(
      `[stage:native-windows] staged ${path.join(STAGED_BINARIES_RELATIVE, entry.rid, HELPER_EXECUTABLE_NAME)} (machine 0x${entry.machine.toString(16)}, ${entry.size} bytes)`,
    )
  }

  return plan
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url

if (invokedDirectly) {
  try {
    stageNativeWindows()
    console.log('[stage:native-windows] done')
  } catch (error) {
    console.error(
      `[stage:native-windows] ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exitCode = 1
  }
}
