import { useState, useCallback, useRef, useEffect, type ReactNode } from 'react'
import { Box, Text } from 'ink'
import { useKeyHandler } from '../interaction/keyboard/useKeyHandler.js'
import { InputConsumptionResult } from '../types.js'
import { MouseLayout } from '../interaction/mouse/MouseLayout.js'
import { useAutoMouseArea } from '../interaction/mouse/useAutoMouseArea.js'
import { useMouseGeometry } from '../interaction/mouse/MouseGeometryContext.js'
import { useMouseRegistry } from '../interaction/mouse/MouseProvider.js'

function StepActionTarget({
  onClick,
  children,
}: {
  onClick: () => void
  children: ReactNode
}) {
  const geometry = useMouseGeometry()
  const registry = useMouseRegistry()
  const hasMeasuredMouseHost =
    geometry !== null &&
    geometry.origin !== null &&
    geometry.clip !== null &&
    registry !== null

  if (!hasMeasuredMouseHost) return children

  return <MeasuredStepAction onClick={onClick}>{children}</MeasuredStepAction>
}

function MeasuredStepAction({
  onClick,
  children,
}: {
  onClick: () => void
  children: ReactNode
}) {
  const ref = useAutoMouseArea({ onClick })
  return (
    <MouseLayout ref={ref} flexDirection="row">
      {children}
    </MouseLayout>
  )
}

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
    <MouseLayout flexDirection="column">
      <Box>
        <Text dimColor>
          [{currentStepIndex + 1}/{steps.length}] {currentStep.title}
        </Text>
      </Box>

      <MouseLayout>{currentStep.component(stepContext)}</MouseLayout>

      <MouseLayout>
        {isFirst ? (
          <StepActionTarget onClick={goBack}>
            <Text dimColor>[esc] Cancel</Text>
          </StepActionTarget>
        ) : (
          <StepActionTarget onClick={goBack}>
            <Text dimColor>[←] Back</Text>
          </StepActionTarget>
        )}
        <Text> </Text>
        <StepActionTarget onClick={goNext}>
          <Text dimColor>
            [→{isLast || steps.length === 0 ? '' : '/Enter'}]{' '}
            {isLast ? 'Finish' : 'Next'}
          </Text>
        </StepActionTarget>
      </MouseLayout>
    </MouseLayout>
  )
}
