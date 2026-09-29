import { describe, expect, it } from 'vitest'
import { AsyncSessionRunner, NodeProcessRunner } from 'runeframe'
import type { SessionStatus } from 'runeframe'

function startAndWait(
  runner: AsyncSessionRunner,
  script: string,
): Promise<number | null> {
  return new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('session did not exit within 20s')),
      20000,
    )
    runner.start(process.execPath, ['-e', script], {
      onExit: (exitCode) => {
        clearTimeout(timer)
        resolve(exitCode)
      },
      onError: (error) => {
        clearTimeout(timer)
        reject(error)
      },
    })
  })
}

describe('real NodeProcessRunner session output', () => {
  it('captures stdout and stderr from a real child process', async () => {
    const runner = new AsyncSessionRunner({ runner: new NodeProcessRunner() })
    const exitCode = await startAndWait(
      runner,
      "process.stdout.write('runeframe-session-stdout\\n'); process.stderr.write('runeframe-session-stderr\\n')",
    )

    expect(exitCode).toBe(0)
    expect(runner.status).toBe<SessionStatus>('complete')

    const output = runner.output.map((event) => event.data).join('')
    expect(output).toContain('runeframe-session-stdout')
    expect(output).toContain('runeframe-session-stderr')
  })

  it('reports a nonzero exit code and error status', async () => {
    const runner = new AsyncSessionRunner({ runner: new NodeProcessRunner() })
    const exitCode = await startAndWait(
      runner,
      "process.stdout.write('before-exit\\n'); process.exitCode = 7",
    )

    expect(exitCode).toBe(7)
    expect(runner.status).toBe<SessionStatus>('error')
    expect(runner.exitCode).toBe(7)

    const exitEvent = runner.events.find((event) => event.type === 'exit')
    expect(exitEvent?.data).toBe('7')
    expect(exitEvent?.exitCode).toBe(7)
  })
})
