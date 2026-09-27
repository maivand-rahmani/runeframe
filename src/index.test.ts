import { describe, it, expect } from 'vitest'
import * as root from './index.js'

describe('public barrel', () => {
  it('exposes the canonical focus/input contract', () => {
    expect(typeof root.FrameworkProvider).toBe('function')
    expect(typeof root.useFocusZone).toBe('function')
    expect(typeof root.useFocusGroup).toBe('function')
    expect(typeof root.useFocusable).toBe('function')
    expect(typeof root.useKeyHandler).toBe('function')
    expect(typeof root.useKeyBinding).toBe('function')
    expect(root.InputConsumptionResult.Consumed).toBe(1)
    expect(root.KEY_ENTER).toBe('enter')
    expect(typeof root.normalizeKey).toBe('function')
  })

  it('does not export any removed legacy generation', () => {
    // FocusScope generation
    expect(root).not.toHaveProperty('FocusScope')
    expect(root).not.toHaveProperty('useFocusScope')

    // v2-suffixed focus API (renamed to canonical useFocusable)
    expect(root).not.toHaveProperty('useFocusableV2')

    // Region generation
    expect(root).not.toHaveProperty('RegionProvider')
    expect(root).not.toHaveProperty('useRegionContext')
    expect(root).not.toHaveProperty('useFocusableRegion')
    expect(root).not.toHaveProperty('useInputInRegion')
    expect(root).not.toHaveProperty('useScopedInputInRegion')

    // Raw scope input hooks
    expect(root).not.toHaveProperty('useInputInScope')
    expect(root).not.toHaveProperty('useScopedInputInScope')
  })
})
