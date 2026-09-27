import { describe, it, expect } from 'vitest'
import { NodeProcessRunner } from './ProcessRunner.js'

/**
 * Focused smoke tests for the default process adapter.
 * Uses `process.execPath` so the same tests run on every platform without
 * depending on shell built-ins or PATH.
 */
describe('NodeProcessRunner', () => {
  it('spawns an executable with args and captures stdout', async () => {
    const runner = new NodeProcessRunner()
    const proc = runner.spawn(process.execPath, [
      '-e',
      'process.stdout.write("args-ok")',
    ])

    const chunks: string[] = []
    proc.onStdout((data) => chunks.push(data))
    const code = await new Promise<number | null>((resolve) => {
      proc.onExit(resolve)
    })

    expect(code).toBe(0)
    expect(chunks.join('')).toContain('args-ok')
  })

  it('captures stderr and non-zero exit codes', async () => {
    const runner = new NodeProcessRunner()
    const proc = runner.spawn(process.execPath, [
      '-e',
      'process.stderr.write("boom"); process.exit(3)',
    ])

    const chunks: string[] = []
    proc.onStderr((data) => chunks.push(data))
    const code = await new Promise<number | null>((resolve) => {
      proc.onExit(resolve)
    })

    expect(code).toBe(3)
    expect(chunks.join('')).toContain('boom')
  })

  it('forwards stdin written through sendStdin', async () => {
    const runner = new NodeProcessRunner()
    const proc = runner.spawn(process.execPath, [
      '-e',
      'process.stdin.once("data", (d) => { process.stdout.write(d); process.exit(0) })',
    ])

    const chunks: string[] = []
    proc.onStdout((data) => chunks.push(data))
    const exited = new Promise<void>((resolve) => {
      proc.onExit(() => resolve())
    })

    proc.sendStdin('ping\n')
    await exited

    expect(chunks.join('')).toContain('ping')
  })

  it('stops emitting after kill', async () => {
    const runner = new NodeProcessRunner()
    const proc = runner.spawn(process.execPath, [
      '-e',
      'setInterval(() => {}, 1000)',
    ])

    const exited = new Promise<void>((resolve) => {
      proc.onExit(() => resolve())
    })

    proc.kill()
    await exited

    expect(() => proc.sendStdin('late')).not.toThrow()
  })
})
