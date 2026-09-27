import { useState, useCallback, useRef, useEffect, type ReactNode } from 'react'
import { Box, Text } from 'ink'
import { useKeyHandler } from '../interaction/useKeyHandler.js'
import { InputConsumptionResult } from '../types.js'

export interface StepContext {
  /** Current step id. */
  step: string
  /** Accumulated data from all prior steps. */
  data: Record<string, unknown>
  /** Merge a key-value pair into the shared step data. */
  setData: (key: string, value: unknown) => void
  /** Advance to next step; fires onComplete if on the last step. */
  goNext: () => void
  /** Return to previous step; fires onCancel if on the first step. */
  goBack: () => void
  /** Jump to a named step by its id. */
  goTo: (stepId: string) => void
  /** True when the current step is the first. */
  isFirst: boolean
  /** True when the current step is the last. */
  isLast: boolean
  /** Title of the current step. */
  title: string
}

export interface Step {
  /** Unique identifier for this step. */
  id: string
  /** Display title shown in the step indicator. */
  title: string
  /** Renders the step content. Receives StepContext for data access + navigation. */
  component: (ctx: StepContext) => ReactNode
  /** Called when the step becomes active. */
  onEnter?: () => void
  /** Called when the step is about to be left. */
  onExit?: () => void
  /** Optional guard — goNext is a no-op when this returns false. */
  canProceed?: () => boolean
}

export interface StepFlowProps {
  /** Ordered list of steps. */
  steps: Step[]
  /** Pre-populated data available to all steps. */
  initialData?: Record<string, unknown>
  /** Fires when the last step calls goNext(). Receives accumulated data. */
  onComplete?: (data: Record<string, unknown>) => void
  /** Fires when the first step calls goBack(). */
  onCancel?: () => void
}

export function StepFlow({
  steps,
  initialData,
  onComplete,
  onCancel,
}: StepFlowProps) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0)
  const [data, setDataState] = useState<Record<string, unknown>>(initialData ?? {})

  const currentStep = steps[currentStepIndex]!
  const isFirst = currentStepIndex === 0
  const isLast = currentStepIndex === steps.length - 1

  const dataRef = useRef(data)
  dataRef.current = data
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete
  const onCancelRef = useRef(onCancel)
  onCancelRef.current = onCancel
  const stepsRef = useRef(steps)
  stepsRef.current = steps

  const goNext = useCallback(() => {
    const s = stepsRef.current
    if (isLast) {
      onCompleteRef.current?.(dataRef.current)
      return
    }
    const cur = s[currentStepIndex]
    if (cur?.canProceed && !cur.canProceed()) return
    cur?.onExit?.()
    setCurrentStepIndex((prev) => prev + 1)
  }, [isLast, currentStepIndex])

  const goBack = useCallback(() => {
    const s = stepsRef.current
    if (isFirst) {
      onCancelRef.current?.()
      return
    }
    s[currentStepIndex]?.onExit?.()
    setCurrentStepIndex((prev) => prev - 1)
  }, [isFirst, currentStepIndex])

  const goTo = useCallback(
    (stepId: string) => {
      const s = stepsRef.current
      const idx = s.findIndex((st) => st.id === stepId)
      if (idx >= 0) {
        s[currentStepIndex]?.onExit?.()
        setCurrentStepIndex(idx)
      }
    },
    [currentStepIndex],
  )

  const setData = useCallback((key: string, value: unknown) => {
    setDataState((prev) => ({ ...prev, [key]: value }))
  }, [])

  const currentStepRef = useRef(currentStep)
  currentStepRef.current = currentStep

  useEffect(() => {
    currentStepRef.current.onEnter?.()
  }, [currentStepIndex])

  useKeyHandler(
    (event) => {
      if (event.enter || event.right) {
        goNext()
        return InputConsumptionResult.Consumed
      }
      if (event.left || event.escape) {
        goBack()
        return InputConsumptionResult.Consumed
      }
      return InputConsumptionResult.NotConsumed
    },
    'stepflow',
    { deps: [goNext, goBack] },
  )

  const stepContext: StepContext = {
    step: currentStep.id,
    data,
    setData,
    goNext,
    goBack,
    goTo,
    isFirst,
    isLast,
    title: currentStep.title,
  }

  return (
    <Box flexDirection="column">
      <Box>
        <Text dimColor>
          [{currentStepIndex + 1}/{steps.length}] {currentStep.title}
        </Text>
      </Box>

      <Box>{currentStep.component(stepContext)}</Box>

      <Box>
        {isFirst ? (
          <Text dimColor>[esc] Cancel</Text>
        ) : (
          <Text dimColor>[←] Back</Text>
        )}
        <Text> </Text>
        <Text dimColor>
          [→{isLast || steps.length === 0 ? '' : '/Enter'}]{' '}
          {isLast ? 'Finish' : 'Next'}
        </Text>
      </Box>
    </Box>
  )
}
