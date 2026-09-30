import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  HELPER_EXECUTABLE_NAME,
  NATIVE_RIDS,
  PRODUCTION_CSPROJ_RELATIVE,
  SOURCE_BINARIES_RELATIVE,
  buildNativeWindows,
  parseRidArgs,
} from './build-native-windows.mjs'
import {
  PE_MACHINE_BY_RID,
  STAGED_BINARIES_RELATIVE,
  WINDOWS_ENTRY_RELATIVE,
  isFrameworkDependentArtifact,
  parsePeMachine,
  stageNativeWindows,
  validateAotExecutable,
} from './stage-native-windows.mjs'

// Fast synthetic tests only: no `dotnet`, no real NativeAOT build, no process
// execution and no writes outside fresh temp directories.

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

function createFixtureRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runeframe-native-'))
  tempRoots.push(root)
  return root
}

function makePeImage(machine) {
  const buffer = Buffer.alloc(0x100, 0)
  buffer.write('MZ', 0, 'ascii')
  buffer.writeUInt32LE(0x80, 0x3c) // e_lfanew -> PE header
  buffer.writeUInt32LE(0x00004550, 0x80) // 'PE\0\0'
  buffer.writeUInt16LE(machine, 0x84) // COFF Machine
  buffer.writeUInt16LE(0x20b, 0x98) // PE32+ optional header magic
  return buffer
}

function writeFixtureExe(filePath, machine) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, makePeImage(machine))
}

function touchWindowsEntry(root) {
  const entryPath = path.join(root, WINDOWS_ENTRY_RELATIVE)
  fs.mkdirSync(path.dirname(entryPath), { recursive: true })
  fs.writeFileSync(entryPath, '// built windows entry\n')
}

function sourceExePath(root, rid) {
  return path.join(root, SOURCE_BINARIES_RELATIVE, rid, HELPER_EXECUTABLE_NAME)
}

function makeValidSourceRepo() {
  const root = createFixtureRepo()
  touchWindowsEntry(root)
  for (const rid of NATIVE_RIDS) {
    writeFixtureExe(sourceExePath(root, rid), PE_MACHINE_BY_RID[rid])
  }
  return root
}

describe('parsePeMachine', () => {
  it('reads the COFF machine for PE32+ x64 and ARM64 images', () => {
    expect(parsePeMachine(makePeImage(0x8664))).toBe(0x8664)
    expect(parsePeMachine(makePeImage(0xaa64))).toBe(0xaa64)
  })

  it('rejects non-PE buffers with descriptive errors', () => {
    expect(() => parsePeMachine('not a buffer')).toThrow(/Buffer/)
    expect(() => parsePeMachine(Buffer.from('short'))).toThrow(/DOS header/)
    expect(() => parsePeMachine(Buffer.alloc(0x80, 0))).toThrow(/MZ/)

    const badOffset = Buffer.alloc(0x80, 0)
    badOffset.write('MZ', 0, 'ascii')
    badOffset.writeUInt32LE(0xffff, 0x3c)
    expect(() => parsePeMachine(badOffset)).toThrow(/PE header offset/)

    const badSignature = makePeImage(0x8664)
    badSignature.writeUInt32LE(0x12345678, 0x80)
    expect(() => parsePeMachine(badSignature)).toThrow(/PE\\0\\0/)

    const pe32Only = makePeImage(0x8664)
    pe32Only.writeUInt16LE(0x10b, 0x98)
    expect(() => parsePeMachine(pe32Only)).toThrow(/PE32\+/)
  })
})

describe('validateAotExecutable', () => {
  it('accepts a matching machine and reports size and machine', () => {
    const root = createFixtureRepo()
    const exePath = sourceExePath(root, 'win-x64')
    writeFixtureExe(exePath, 0x8664)
    const result = validateAotExecutable(exePath, 'win-x64')
    expect(result.machine).toBe(0x8664)
    expect(result.size).toBe(fs.statSync(exePath).size)
  })

  it('rejects a machine mismatch for the requested RID', () => {
    const root = createFixtureRepo()
    const exePath = sourceExePath(root, 'win-arm64')
    writeFixtureExe(exePath, 0x8664)
    expect(() => validateAotExecutable(exePath, 'win-arm64')).toThrow(
      /machine 0x8664; expected 0xaa64/,
    )
  })

  it('rejects empty and non-PE files', () => {
    const root = createFixtureRepo()
    const emptyPath = sourceExePath(root, 'win-x64')
    fs.mkdirSync(path.dirname(emptyPath), { recursive: true })
    fs.writeFileSync(emptyPath, '')
    expect(() => validateAotExecutable(emptyPath, 'win-x64')).toThrow(
      /non-empty/,
    )

    const garbagePath = sourceExePath(root, 'win-arm64')
    fs.mkdirSync(path.dirname(garbagePath), { recursive: true })
    fs.writeFileSync(garbagePath, 'definitely not a PE image')
    expect(() => validateAotExecutable(garbagePath, 'win-arm64')).toThrow(
      /not a valid PE executable/,
    )
  })
})

describe('isFrameworkDependentArtifact', () => {
  it('matches only runtimeconfig/deps sidecars', () => {
    expect(isFrameworkDependentArtifact('a.runtimeconfig.json')).toBe(true)
    expect(isFrameworkDependentArtifact('a.deps.json')).toBe(true)
    expect(isFrameworkDependentArtifact('Runeframe.Win32Input.exe')).toBe(false)
    expect(isFrameworkDependentArtifact('Runeframe.Win32Input.pdb')).toBe(false)
  })
})

describe('stageNativeWindows', () => {
  it('fails closed with no AOT source binaries (default checkout) and stages nothing', () => {
    const root = createFixtureRepo()
    touchWindowsEntry(root)

    expect(() => stageNativeWindows({ repoRoot: root, log: () => {} })).toThrow(
      /missing NativeAOT helper/,
    )
    expect(fs.existsSync(path.join(root, STAGED_BINARIES_RELATIVE))).toBe(false)
  })

  it('fails closed when the built windows entry is missing', () => {
    const root = createFixtureRepo()
    for (const rid of NATIVE_RIDS) {
      writeFixtureExe(sourceExePath(root, rid), PE_MACHINE_BY_RID[rid])
    }

    expect(() => stageNativeWindows({ repoRoot: root, log: () => {} })).toThrow(
      /npm run build/,
    )
    expect(fs.existsSync(path.join(root, STAGED_BINARIES_RELATIVE))).toBe(false)
  })

  it('fails closed on a RID/machine mismatch before touching dist', () => {
    const root = makeValidSourceRepo()
    // Corrupt the ARM64 artifact with an x64 machine.
    writeFixtureExe(sourceExePath(root, 'win-arm64'), 0x8664)

    expect(() => stageNativeWindows({ repoRoot: root, log: () => {} })).toThrow(
      /expected 0xaa64/,
    )
    expect(fs.existsSync(path.join(root, STAGED_BINARIES_RELATIVE))).toBe(false)
  })

  it('fails closed when a framework-dependent sidecar exists in the publish output', () => {
    const root = makeValidSourceRepo()
    fs.writeFileSync(
      path.join(
        root,
        SOURCE_BINARIES_RELATIVE,
        'win-x64',
        'Runeframe.Win32Input.runtimeconfig.json',
      ),
      '{}',
    )

    expect(() => stageNativeWindows({ repoRoot: root, log: () => {} })).toThrow(
      /framework-dependent/,
    )
    expect(fs.existsSync(path.join(root, STAGED_BINARIES_RELATIVE))).toBe(false)
  })

  it('stages exactly the executables for both RIDs, never sidecars', () => {
    const root = makeValidSourceRepo()
    // Extra publish output that must not be staged.
    fs.writeFileSync(
      path.join(root, SOURCE_BINARIES_RELATIVE, 'win-x64', 'helper.pdb'),
      'pdb',
    )

    const plan = stageNativeWindows({ repoRoot: root, log: () => {} })
    expect(plan.map((entry) => entry.rid).sort()).toEqual([...NATIVE_RIDS].sort())

    for (const rid of NATIVE_RIDS) {
      const stagedDir = path.join(root, STAGED_BINARIES_RELATIVE, rid)
      expect(fs.readdirSync(stagedDir)).toEqual([HELPER_EXECUTABLE_NAME])
      expect(fs.readFileSync(path.join(stagedDir, HELPER_EXECUTABLE_NAME))).toEqual(
        fs.readFileSync(sourceExePath(root, rid)),
      )
    }
  })

  it('keeps the generated source binaries out of version control by default', () => {
    const gitignore = fs.readFileSync(path.join(repoRoot, '.gitignore'), 'utf8')
    expect(gitignore).toContain('src/input/transports/windows/binaries/')
  })
})

describe('buildNativeWindows', () => {
  function makeBuildFixture() {
    const root = createFixtureRepo()
    const csprojPath = path.join(root, PRODUCTION_CSPROJ_RELATIVE)
    fs.mkdirSync(path.dirname(csprojPath), { recursive: true })
    fs.writeFileSync(csprojPath, '<Project Sdk="Microsoft.NET.Sdk" />\n')
    return root
  }

  it('refuses to run outside win32', () => {
    expect(() => buildNativeWindows({ platform: 'linux' })).toThrow(/win32/)
    expect(() => buildNativeWindows({ platform: 'darwin' })).toThrow(/win32/)
  })

  it('publishes only the production csproj with NativeAOT flags for both RIDs', () => {
    const root = makeBuildFixture()
    const calls = []
    const run = (command, args, options) => {
      calls.push({ command, args, options })
      return { status: 0, error: undefined }
    }

    const rids = buildNativeWindows({
      platform: 'win32',
      repoRoot: root,
      run,
      fileExists: () => true,
      log: () => {},
    })

    expect(rids).toEqual(NATIVE_RIDS)
    expect(calls).toHaveLength(2)
    for (const [index, rid] of NATIVE_RIDS.entries()) {
      const { command, args } = calls[index]
      expect(command).toBe('dotnet')
      expect(args).toEqual([
        'publish',
        path.join(root, PRODUCTION_CSPROJ_RELATIVE),
        '-c',
        'Release',
        '-r',
        rid,
        '-p:PublishAot=true',
        '-p:SelfContained=true',
        '-o',
        path.join(root, SOURCE_BINARIES_RELATIVE, rid),
      ])
      expect(JSON.stringify(args)).not.toContain('test-app')
      expect(JSON.stringify(args)).not.toContain('examples')
    }
  })

  it('fails on a non-zero publish exit and on a spawn error', () => {
    const root = makeBuildFixture()
    expect(() =>
      buildNativeWindows({
        platform: 'win32',
        repoRoot: root,
        run: () => ({ status: 1, error: undefined }),
        fileExists: () => true,
        log: () => {},
      }),
    ).toThrow(/dotnet publish failed for win-x64/)

    expect(() =>
      buildNativeWindows({
        platform: 'win32',
        repoRoot: root,
        run: () => ({ status: null, error: new Error('spawn dotnet ENOENT') }),
        fileExists: () => true,
        log: () => {},
      }),
    ).toThrow(/failed to run dotnet publish/)
  })

  it('rejects unsupported RIDs and unknown arguments', () => {
    const root = makeBuildFixture()
    expect(() =>
      buildNativeWindows({ platform: 'win32', repoRoot: root, rids: ['linux-x64'] }),
    ).toThrow(/unsupported RID/)
    expect(() =>
      buildNativeWindows({ platform: 'win32', repoRoot: root, rids: [] }),
    ).toThrow(/no RIDs requested/)

    expect(parseRidArgs([])).toEqual(['win-x64', 'win-arm64'])
    expect(parseRidArgs(['--rid', 'win-x64'])).toEqual(['win-x64'])
    expect(parseRidArgs(['--rid=win-arm64', '--rid', 'win-x64'])).toEqual([
      'win-arm64',
      'win-x64',
    ])
    expect(() => parseRidArgs(['--bogus'])).toThrow(/unknown argument/)
    expect(() => parseRidArgs(['--rid'])).toThrow(/requires a value/)
  })
})
