import { useRef, type ReactNode } from 'react'
import { Text } from 'ink'
import { useTheme } from '../design-system/ThemeProvider.js'
import type { ThemeTokens } from '../types.js'
import { MouseArea } from '../interaction/MouseArea.js'
import type { MouseBounds } from '../interaction/MouseArea.js'
import { useKeyHandler } from '../interaction/useKeyHandler.js'
import { InputConsumptionResult } from '../types.js'

export type ButtonVariant = 'default' | 'primary' | 'danger' | 'ghost'

export interface ButtonProps {
  variant?: ButtonVariant
  disabled?: boolean
  focused?: boolean
  children: ReactNode
  onActivate?: () => void
  mouseBounds?: MouseBounds
}

export interface ButtonAppearance {
  color?: string
  dimColor?: boolean
  bold?: boolean
}

export function resolveButtonAppearance(
  theme: ThemeTokens,
  variant: ButtonVariant,
  focused: boolean,
  disabled: boolean,
): ButtonAppearance {
  if (disabled) {
    return {
      color: theme.colors.text.secondary,
      dimColor: true,
    }
  }

  if (focused) {
    return {
      color: theme.colors.focus.ring,
      bold: true,
    }
  }

  switch (variant) {
    case 'primary':
      return { color: theme.colors.status.info }
    case 'danger':
      return { color: theme.colors.status.error }
    case 'ghost':
      return { color: theme.colors.text.secondary, dimColor: true }
    case 'default':
    default:
      return { color: theme.colors.text.primary }
  }
}

export function Button({
  variant = 'default',
  disabled = false,
  focused = false,
  children,
  onActivate,
  mouseBounds,
}: ButtonProps) {
  const theme = useTheme()
  const appearance = resolveButtonAppearance(theme, variant, focused, disabled)

  const content = (
    <Text
      color={appearance.color}
      dimColor={appearance.dimColor}
      bold={appearance.bold}
    >
      [{children}]
    </Text>
  )

  // Keep decorative, render-only buttons usable outside the interaction
  // providers. The interaction hooks are only mounted when requested.
  if (onActivate == null && mouseBounds == null) return content

  return (
    <ButtonInteraction
      disabled={disabled}
      focused={focused}
      mouseBounds={mouseBounds}
      onActivate={onActivate}
    >
      {content}
    </ButtonInteraction>
  )
}

function ButtonInteraction({
  disabled,
  focused,
  mouseBounds,
  onActivate,
  children,
}: {
  disabled: boolean
  focused: boolean
  mouseBounds?: MouseBounds
  onActivate?: () => void
  children: ReactNode
}) {
  const onActivateRef = useRef(onActivate)
  const disabledRef = useRef(disabled)
  const mouseBoundsRef = useRef(mouseBounds)
  onActivateRef.current = onActivate
  disabledRef.current = disabled
  mouseBoundsRef.current = mouseBounds

  const content =
    onActivate == null ? (
      children
    ) : (
      <ButtonKeyboardActivation
        disabled={disabled}
        focused={focused}
        onActivate={onActivate}
      >
        {children}
      </ButtonKeyboardActivation>
    )

  if (mouseBounds == null) return content

  return (
    <MouseArea
      bounds={mouseBounds}
      disabled={disabled || onActivate == null}
      onClick={() => {
        const currentBounds = mouseBoundsRef.current
        if (
          !disabledRef.current &&
          currentBounds != null &&
          sameMouseBounds(currentBounds, mouseBounds)
        ) {
          onActivateRef.current?.()
        }
      }}
    >
      {content}
    </MouseArea>
  )
}

function ButtonKeyboardActivation({
  disabled,
  focused,
  onActivate,
  children,
}: {
  disabled: boolean
  focused: boolean
  onActivate: () => void
  children: ReactNode
}) {
  const onActivateRef = useRef(onActivate)
  onActivateRef.current = onActivate

  useKeyHandler(
    (event) => {
      if (!event.enter || !focused || disabled) {
        return InputConsumptionResult.NotConsumed
      }
      onActivateRef.current()
      return InputConsumptionResult.Consumed
    },
    'navigation',
    { enabled: focused && !disabled },
  )

  return children
}

function sameMouseBounds(left: MouseBounds, right: MouseBounds): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  )
}
