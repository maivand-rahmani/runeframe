import { describe, it, expect, vi } from 'vitest'
import { render } from 'ink-testing-library'
import type { ReactElement } from 'react'
import { Text } from 'ink'
import { ThemeProvider } from '../design-system/ThemeProvider.js'
import { KeyboardScopeProvider } from '../interaction/keyboard/KeyboardScopeProvider.js'
import { ScopedActionRegistryProvider } from '../commands/actions/ScopedActionRegistryProvider.js'
import { StepFlow, type Step, type StepContext } from './StepFlow.js'
import { FrameworkProvider } from '../FrameworkProvider.js'
import { MouseLayout } from '../interaction/mouse/MouseLayout.js'
import { ScreenRegistry } from '../screens/registry.js'
import { TextInput } from './inputs/TextInput.js'
import stripAnsi from 'strip-ansi'

function renderWithProviders(ui: ReactElement) {
  return render(
    <ThemeProvider>
      <KeyboardScopeProvider defaultScope="navigation">
        <ScopedActionRegistryProvider>{ui}</ScopedActionRegistryProvider>
      </KeyboardScopeProvider>
    </ThemeProvider>,
  )
}

const mouseRegistry = new ScreenRegistry()
mouseRegistry.register({ id: 'test', title: 'Test', component: () => null })

function renderWithMouse(ui: ReactElement) {
  return render(
    <FrameworkProvider registry={mouseRegistry} defaultScreen="test">
      {ui}
    </FrameworkProvider>,
  )
}

function delay(ms = 50) {
  return new Promise((r) => setTimeout(r, ms))
}

function findMarker(frame: string, marker: string): { x: number; y: number } {
  const lines = stripAnsi(frame).split('\n')
  for (let y = 0; y < lines.length; y++) {
    const x = lines[y]!.indexOf(marker)
    if (x !== -1) return { x, y }
  }
  throw new Error(`Marker not found: ${marker}`)
}

async function clickAt(
  stdin: { write: (data: string) => void },
  x: number,
  y: number,
) {
  stdin.write(`\u001B[<0;${x + 1};${y + 1}M`)
  await delay()
  stdin.write(`\u001B[<0;${x + 1};${y + 1}m`)
  await delay()
}

function makeCaptureStep(id: string, title: string) {
  let captured: StepContext | null = null
  const step: Step = {
    id,
    title,
    component: (ctx: StepContext) => {
      captured = ctx
      return <Text>{title}</Text>
    },
  }
  return { step, getContext: () => captured! }
}

const step1 = makeCaptureStep('pick-track', 'Pick Track')
const step2 = makeCaptureStep('pick-mode', 'Pick Mode')
const step3 = makeCaptureStep('pick-count', 'Pick Count')

describe('StepFlow', () => {
  it('renders first step', () => {
    const { lastFrame } = renderWithProviders(
      <StepFlow steps={[step1.step, step2.step]} />,
    )
    const frame = lastFrame()
    expect(frame).toContain('Pick Track')
    expect(frame).toContain('[1/2]')
    expect(frame).toContain('[esc] Cancel')
  })

  it('goNext advances to step 2', async () => {
    const { lastFrame } = renderWithProviders(
      <StepFlow steps={[step1.step, step2.step]} />,
    )
    await delay()
    step1.getContext().goNext()
    await delay()
    const frame = lastFrame()
    expect(frame).toContain('Pick Mode')
    expect(frame).toContain('[2/2]')
  })

  it('goBack returns to step 1', async () => {
    const { lastFrame } = renderWithProviders(
      <StepFlow steps={[step1.step, step2.step]} />,
    )
    await delay()
    step1.getContext().goNext()
    await delay()
    step2.getContext().goBack()
    await delay()
    const frame = lastFrame()
    expect(frame).toContain('Pick Track')
    expect(frame).toContain('[1/2]')
  })

  it('setData accumulates data across steps', async () => {
    let final: Record<string, unknown> = {}
    renderWithProviders(
      <StepFlow
        steps={[step1.step, step2.step, step3.step]}
        onComplete={(d) => { final = d }}
      />,
    )
    await delay()
    step1.getContext().setData('track', 'react')
    step1.getContext().goNext()
    await delay()
    step2.getContext().setData('mode', 'practice')
    step2.getContext().goNext()
    await delay()
    step3.getContext().goNext()
    await delay()
    expect(final).toEqual({ track: 'react', mode: 'practice' })
  })

  it('onComplete fires with accumulated data on last step goNext', async () => {
    const complete = vi.fn()
    renderWithProviders(
      <StepFlow steps={[step1.step, step2.step]} onComplete={complete} />,
    )
    await delay()
    step1.getContext().setData('x', 1)
    step1.getContext().goNext()
    await delay()
    step2.getContext().goNext()
    await delay()
    expect(complete).toHaveBeenCalledWith({ x: 1 })
  })

  it('onCancel fires when goBack on first step', async () => {
    const cancel = vi.fn()
    renderWithProviders(
      <StepFlow steps={[step1.step, step2.step]} onCancel={cancel} />,
    )
    await delay()
    step1.getContext().goBack()
    await delay()
    expect(cancel).toHaveBeenCalled()
  })

  it('goTo jumps to named step', async () => {
    const { lastFrame } = renderWithProviders(
      <StepFlow steps={[step1.step, step2.step, step3.step]} />,
    )
    await delay()
    step1.getContext().goTo('pick-count')
    await delay()
    const frame = lastFrame()
    expect(frame).toContain('Pick Count')
    expect(frame).toContain('[3/3]')
  })

  it('step indicator shows current position', async () => {
    const { lastFrame } = renderWithProviders(
      <StepFlow steps={[step1.step, step2.step, step3.step]} />,
    )
    await delay()
    expect(lastFrame()).toContain('[1/3]')

    step1.getContext().goNext()
    await delay()
    expect(lastFrame()).toContain('[2/3]')

    step2.getContext().goNext()
    await delay()
    expect(lastFrame()).toContain('[3/3]')
  })

  it('shows Back hint on non-first steps', async () => {
    const { lastFrame } = renderWithProviders(
      <StepFlow steps={[step1.step, step2.step]} />,
    )
    await delay()
    step1.getContext().goNext()
    await delay()
    const frame = lastFrame()
    expect(frame).toContain('[←] Back')
    expect(frame).toContain('Finish')
  })

  it('respects initialData', async () => {
    let final: Record<string, unknown> = {}
    renderWithProviders(
      <StepFlow
        steps={[step1.step]}
        initialData={{ preset: 'hard' }}
        onComplete={(d) => { final = d }}
      />,
    )
    await delay()
    step1.getContext().goNext()
    await delay()
    expect(final).toEqual({ preset: 'hard' })
  })

  it('calls onEnter when step becomes active', async () => {
    const onEnter = vi.fn()
    const step: Step = {
      id: 'a',
      title: 'A',
      component: () => <Text>A</Text>,
      onEnter,
    }
    renderWithProviders(<StepFlow steps={[step]} />)
    await delay()
    expect(onEnter).toHaveBeenCalled()
  })

  it('calls onExit when step is left via goNext', async () => {
    const onExit = vi.fn()
    let ctx: StepContext | null = null
    const stepA: Step = {
      id: 'a',
      title: 'A',
      component: (c) => {
        ctx = c
        return <Text>A</Text>
      },
      onExit,
    }
    const stepB = makeCaptureStep('b', 'B')
    renderWithProviders(<StepFlow steps={[stepA, stepB.step]} />)
    await delay()
    ctx!.goNext()
    await delay()
    expect(onExit).toHaveBeenCalled()
  })

  it('respects canProceed guard returning false', async () => {
    let ctx: StepContext | null = null
    const lockedStep: Step = {
      id: 'locked',
      title: 'Locked',
      component: (c) => {
        ctx = c
        return <Text>Locked</Text>
      },
      canProceed: () => false,
    }
    const s2 = makeCaptureStep('s2', 'S2')
    const { lastFrame } = renderWithProviders(
      <StepFlow steps={[lockedStep, s2.step]} />,
    )
    await delay()
    ctx!.goNext()
    await delay()
    expect(lastFrame()).toContain('Locked')
  })

  it('onCancel fires on keyboard Escape at first step', async () => {
    const cancel = vi.fn()
    const { stdin } = renderWithProviders(
      <StepFlow steps={[step1.step, step2.step]} onCancel={cancel} />,
    )
    await delay()
    stdin.write('\u001b')
    await delay()
    expect(cancel).toHaveBeenCalled()
  })

  it('goNext fires on keyboard Enter', async () => {
    const { stdin, lastFrame } = renderWithProviders(
      <StepFlow steps={[step1.step, step2.step]} />,
    )
    await delay()
    stdin.write('\r')
    await delay()
    expect(lastFrame()).toContain('Pick Mode')
  })

  it('goNext fires on keyboard Right arrow', async () => {
    const { stdin, lastFrame } = renderWithProviders(
      <StepFlow steps={[step1.step, step2.step]} />,
    )
    await delay()
    stdin.write('\u001b[C')
    await delay()
    expect(lastFrame()).toContain('Pick Mode')
  })

  it('hit-tests a field through StepFlow measured ancestors', async () => {
    const onChange = vi.fn()
    const fieldStep: Step = {
      id: 'field',
      title: 'Field',
      component: () => <TextInput placeholder="step field" onChange={onChange} />,
    }
    const { stdin, lastFrame } = renderWithMouse(
      <MouseLayout origin={{ x: 0, y: 0 }}>
        <StepFlow steps={[fieldStep]} />
      </MouseLayout>,
    )

    await delay()
    const field = findMarker(lastFrame() ?? '', 'step field')
    await clickAt(stdin, field.x, field.y)
    stdin.write('x')
    await delay()

    expect(onChange).toHaveBeenCalledWith('x')
  })

  it('routes Back, Cancel, Next and Finish mouse clicks through guarded navigation', async () => {
    let allowNext = false
    const canProceed = vi.fn(() => allowNext)
    const firstExit = vi.fn()
    const lastExit = vi.fn()
    const onCancel = vi.fn()
    const onComplete = vi.fn()
    const first: Step = {
      id: 'choose',
      title: 'Choose',
      component: () => <Text>Choose body</Text>,
      canProceed,
      onExit: firstExit,
    }
    const last: Step = {
      id: 'review',
      title: 'Review',
      component: () => <Text>Review body</Text>,
      // The last step completes rather than applying the intermediate-step guard.
      canProceed: () => false,
      onExit: lastExit,
    }

    const { stdin, lastFrame } = renderWithMouse(
      <MouseLayout origin={{ x: 0, y: 0 }}>
        <StepFlow
          steps={[first, last]}
          onCancel={onCancel}
          onComplete={onComplete}
        />
      </MouseLayout>,
    )

    await delay()
    let marker = findMarker(lastFrame() ?? '', 'Next')
    await clickAt(stdin, marker.x, marker.y)
    expect(lastFrame()).toContain('Choose body')
    expect(canProceed).toHaveBeenCalledTimes(1)
    expect(firstExit).not.toHaveBeenCalled()

    allowNext = true
    marker = findMarker(lastFrame() ?? '', 'Next')
    await clickAt(stdin, marker.x, marker.y)
    expect(lastFrame()).toContain('Review body')
    expect(firstExit).toHaveBeenCalledTimes(1)

    marker = findMarker(lastFrame() ?? '', 'Back')
    await clickAt(stdin, marker.x, marker.y)
    expect(lastFrame()).toContain('Choose body')
    expect(lastExit).toHaveBeenCalledTimes(1)

    marker = findMarker(lastFrame() ?? '', 'Cancel')
    await clickAt(stdin, marker.x, marker.y)
    expect(onCancel).toHaveBeenCalledTimes(1)

    marker = findMarker(lastFrame() ?? '', 'Next')
    await clickAt(stdin, marker.x, marker.y)
    expect(lastFrame()).toContain('Review body')
    marker = findMarker(lastFrame() ?? '', 'Finish')
    await clickAt(stdin, marker.x, marker.y)
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onComplete).toHaveBeenCalledWith({})
  })
})
