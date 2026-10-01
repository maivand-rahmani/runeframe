import type { ProcessRunner, RunningProcess } from '../src/commands/process/ProcessRunner.js'

/**
 * Mock `ProcessRunner` for CI-safe integration tests.
 *
 * Simulates process lifecycle without spawning real child processes:
 * - `spawn()` returns a `MockRunningProcess` that emits stdout output
 *   and fires `onExit(0)` after a short async delay.
 * - `sendStdin` is a no-op (mock input capture).
 * - `kill()` and `cleanup()` tear down internal state.
 *
 * @example
 * ```ts
 * const runner = new MockProcessRunner()
 * const proc = runner.spawn('echo hello')
 * proc.onStdout((line) => console.log(line))
 * proc.onExit((code) => console.log('exit', code))
 * ```
 */
export class MockProcessRunner implements ProcessRunner {
  private _isRunning = false

  spawn(command: string): RunningProcess {
    return new MockRunningProcess(command, this)
  }

  get isRunning(): boolean {
    return this._isRunning
  }

  _markRunning(): void {
    this._isRunning = true
  }

  _markExited(): void {
    this._isRunning = false
  }

  kill(): void {
    this._isRunning = false
  }

  cleanup(): void {
    this._isRunning = false
  }
}

class MockRunningProcess implements RunningProcess {
  private _command: string
  private runner: MockProcessRunner
  private stdoutListeners = new Set<(data: string) => void>()
  private stderrListeners = new Set<(data: string) => void>()
  private exitListeners = new Set<(code: number | null) => void>()
  private _exited = false

  constructor(command: string, runner: MockProcessRunner) {
    this._command = command
    this.runner = runner
    this.runner._markRunning()

    setTimeout(() => {
      this._emitStdout(`Hello from mock process`)
      this._emitStdout(`Exit code: 0`)
      this._emitExit(0)
    }, 100)
  }

  sendStdin(_data: string): void {}

  kill(): void {
    if (this._exited) return
    this._exited = true
    this._emitExit(null)
    this.runner._markExited()
  }

  onStdout(cb: (data: string) => void): () => void {
    this.stdoutListeners.add(cb)
    return () => {
      this.stdoutListeners.delete(cb)
    }
  }

  onStderr(cb: (data: string) => void): () => void {
    this.stderrListeners.add(cb)
    return () => {
      this.stderrListeners.delete(cb)
    }
  }

  onExit(cb: (code: number | null) => void): () => void {
    this.exitListeners.add(cb)
    return () => {
      this.exitListeners.delete(cb)
    }
  }

  private _emitStdout(data: string): void {
    for (const cb of this.stdoutListeners) cb(data)
  }

  private _emitStderr(data: string): void {
    for (const cb of this.stderrListeners) cb(data)
  }

  private _emitExit(code: number | null): void {
    this._exited = true
    for (const cb of this.exitListeners) cb(code)
    this.runner._markExited()
  }
}
