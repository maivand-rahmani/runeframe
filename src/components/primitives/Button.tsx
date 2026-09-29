import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { Box, Text } from 'ink'
import { useTheme } from '../../design-system/ThemeProvider.js'
import type { ThemeTokens } from '../../types.js'
import { MouseArea } from '../../interaction/mouse/MouseArea.js'
import type { MouseBounds } from '../../interaction/mouse/MouseArea.js'
import { useMouseRegistry } from '../../interaction/mouse/MouseProvider.js'
import { useMouseGeometry } from '../../interaction/mouse/MouseGeometryContext.js'
import { useAutoMouseArea } from '../../interaction/mouse/useAutoMouseArea.js'
import { useKeyHandler } from '../../interaction/keyboard/useKeyHandler.js'
import { InputConsumptionResult } from '../../types.js'

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
  const registry = useMouseRegistry()
  const geometry = useMouseGeometry()

  // Mouse and keyboard handlers read this snapshot, which is refreshed only
  // from a commit-phase layout effect. Writing the refs during render would
  // let a render React abandons leak a new callback, disabled flag or explicit
  // bounds into the currently committed area.
  const committedRef = useRef({ onActivate, disabled, mouseBounds })
  useLayoutEffect(() => {
    committedRef.current = { onActivate, disabled, mouseBounds }
  })

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

  // Explicit bounds stay authoritative and unchanged.
  if (mouseBounds != null) {
    return (
      <MouseArea
        bounds={mouseBounds}
        disabled={disabled || onActivate == null}
        onClick={() => {
          const committed = committedRef.current
          if (
            !committed.disabled &&
            committed.mouseBounds != null &&
            sameMouseBounds(committed.mouseBounds, mouseBounds)
          ) {
            committed.onActivate?.()
          }
        }}
      >
        {content}
      </MouseArea>
    )
  }

  // Automatic bounds are only instrumented beneath a `MouseLayout` inside a
  // `MouseProvider`. The area is inert until the anchored tree has measured.
  if (onActivate != null && geometry != null && registry != null) {
    return (
      <ButtonAutoMouseTarget disabled={disabled} onActivate={onActivate}>
        {content}
      </ButtonAutoMouseTarget>
    )
  }

  return content
}

function ButtonAutoMouseTarget({
  disabled,
  onActivate,
  children,
}: {
  disabled: boolean
  onActivate: () => void
  children: ReactNode
}) {
  // `useAutoMouseArea` installs this render's callback and disabled state only
  // from its commit-phase layout effect, so a render that never commits cannot
  // reach the registered area.
  const ref = useAutoMouseArea({ disabled, onClick: onActivate })

  // This measured Box is a real Yoga node and can reflow tightly constrained
  // flex rows differently from a bare Ink Text node. Keep it from shrinking
  // below its content; the opt-in layout tradeoff is documented and tested.
  return (
    <Box ref={ref} flexShrink={0}>
      {children}
    </Box>
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
  const committedOnActivateRef = useRef(onActivate)
  useLayoutEffect(() => {
    committedOnActivateRef.current = onActivate
  })

  useKeyHandler(
    (event) => {
      if (!event.enter || !focused || disabled) {
        return InputConsumptionResult.NotConsumed
      }
      committedOnActivateRef.current()
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
