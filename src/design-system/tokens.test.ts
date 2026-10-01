import { describe, it, expect } from 'vitest'
import {
  spacing,
  semanticColors,
  typography,
  borderStyles,
  themeSymbols,
  themeLayout,
} from './tokens.js'

describe('spacing', () => {
  it('has all required keys', () => {
    expect(Object.keys(spacing)).toEqual(['xs', 'sm', 'md', 'lg', 'xl', 'xxl'])
  })

  it('values are positive integers', () => {
    for (const value of Object.values(spacing)) {
      expect(Number.isInteger(value)).toBe(true)
      expect(value).toBeGreaterThan(0)
    }
  })

  it('is ordered smallest to largest', () => {
    const values = Object.values(spacing)
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThan(values[i - 1])
    }
  })
})

describe('semanticColors', () => {
  const requiredCategories = ['text', 'status', 'focus', 'surface', 'border'] as const

  it('has all required categories', () => {
    expect(Object.keys(semanticColors).sort()).toEqual([...requiredCategories].sort())
  })

  it('text has primary, secondary, muted, inverse', () => {
    expect(Object.keys(semanticColors.text)).toEqual(['primary', 'secondary', 'muted', 'inverse'])
  })

  it('status has success, warning, error, info', () => {
    expect(Object.keys(semanticColors.status)).toEqual(['success', 'warning', 'error', 'info'])
  })

  it('focus has ring, active, selected', () => {
    expect(Object.keys(semanticColors.focus)).toEqual(['ring', 'active', 'selected'])
  })

  it('surface has base, elevated, overlay', () => {
    expect(Object.keys(semanticColors.surface)).toEqual(['base', 'elevated', 'overlay'])
  })

  it('border has default, focus, error', () => {
    expect(Object.keys(semanticColors.border)).toEqual(['default', 'focus', 'error'])
  })

  it('all color values are strings', () => {
    for (const category of Object.values(semanticColors)) {
      for (const value of Object.values(category)) {
        expect(typeof value).toBe('string')
        expect(value.length).toBeGreaterThan(0)
      }
    }
  })
})

describe('typography', () => {
  it('has all required tokens', () => {
    expect(Object.keys(typography)).toEqual(['heading', 'label', 'body', 'caption', 'code'])
  })

  it('all values are strings', () => {
    for (const value of Object.values(typography)) {
      expect(typeof value).toBe('string')
    }
  })
})

describe('borderStyles', () => {
  it('has all required tokens', () => {
    expect(Object.keys(borderStyles)).toEqual(['panel', 'card', 'modal', 'table'])
  })

  it('all values are strings', () => {
    for (const value of Object.values(borderStyles)) {
      expect(typeof value).toBe('string')
    }
  })
})

describe('themeSymbols', () => {
  it('matches the historical rendering defaults', () => {
    expect(themeSymbols).toEqual({
      button: { open: '[', close: ']' },
      badge: { open: '[', close: ']' },
      divider: { horizontal: '─' },
      list: { marker: '•' },
      radioList: { selected: '•', unselected: '○' },
      sidebar: { active: '›', item: '•' },
      tabs: { separator: '|' },
      input: { open: '[', close: ']', separator: '|' },
      stepFlow: { back: '[←]', next: '[→/Enter]' },
    })
  })

  it('all values are strings', () => {
    const collect = (value: unknown): void => {
      if (typeof value === 'object' && value !== null) {
        for (const entry of Object.values(value)) collect(entry)
        return
      }
      expect(typeof value).toBe('string')
    }
    collect(themeSymbols)
  })
})

describe('themeLayout', () => {
  it('matches the historical layout defaults', () => {
    expect(themeLayout).toEqual({
      narrowColumns: 80,
      mediumColumns: 100,
      sidebarMaxItems: 8,
      listMaxVisible: 10,
      sidebarWidth: 20,
      dividerWidth: 28,
      modalPaddingX: 1,
      modalPaddingY: 1,
      modalMarginY: 1,
      statusBarBorderStyle: 'single',
      modalBorderStyle: 'round',
      commandPaletteBorderStyle: 'round',
      debugInspectorBorderStyle: 'single',
      choicePromptMarginBottom: 1,
    })
  })

  it('numeric metrics are integers', () => {
    for (const [key, value] of Object.entries(themeLayout)) {
      if (key.endsWith('BorderStyle')) continue
      expect(Number.isInteger(value)).toBe(true)
    }
  })
})
