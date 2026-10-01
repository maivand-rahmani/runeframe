import { describe, it, expect, vi } from 'vitest'
import { render } from 'ink-testing-library'
import { Text } from 'ink'
import type { ReactElement } from 'react'
import { ThemeProvider } from '../../design-system/ThemeProvider.js'
import { KeyboardScopeProvider } from '../../interaction/keyboard/KeyboardScopeProvider.js'
import { ConfirmDialog, useConfirmDialog } from './ConfirmDialog.js'

function renderInTheme(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>)
}

function delay(ms = 50) {
  return new Promise((r) => setTimeout(r, ms))
}

describe('ConfirmDialog', () => {
  it('renders nothing when isOpen is false', () => {
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider>
        <ConfirmDialog
          isOpen={false}
          message="Are you sure?"
          onConfirm={() => {}}
          onClose={() => {}}
        />
      </KeyboardScopeProvider>,
    )
    expect(lastFrame()).toBe('')
  })

  it('renders message when isOpen is true', () => {
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider>
        <ConfirmDialog
          isOpen={true}
          message="Are you sure?"
          onConfirm={() => {}}
          onClose={() => {}}
        />
      </KeyboardScopeProvider>,
    )
    expect(lastFrame()).toContain('Are you sure?')
  })

  it('renders title and labels', () => {
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider>
        <ConfirmDialog
          isOpen={true}
          title="Delete?"
          message="This cannot be undone"
          confirmLabel="Yes"
          cancelLabel="No"
          onConfirm={() => {}}
          onClose={() => {}}
        />
      </KeyboardScopeProvider>,
    )
    const frame = lastFrame()
    expect(frame).toContain('Delete?')
    expect(frame).toContain('Yes')
    expect(frame).toContain('No')
    expect(frame).toContain('This cannot be undone')
  })

  it('renders danger mode', () => {
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider>
        <ConfirmDialog
          isOpen={true}
          title="Delete?"
          message="This is dangerous"
          onConfirm={() => {}}
          onClose={() => {}}
          danger
        />
      </KeyboardScopeProvider>,
    )
    const frame = lastFrame()
    expect(frame).toContain('Delete?')
    expect(frame).toContain('This is dangerous')
  })

  it('renders custom confirm and cancel labels', () => {
    const { lastFrame } = renderInTheme(
      <KeyboardScopeProvider>
        <ConfirmDialog
          isOpen={true}
          message="Proceed?"
          confirmLabel="OK"
          cancelLabel="Cancel"
          onConfirm={() => {}}
          onClose={() => {}}
        />
      </KeyboardScopeProvider>,
    )
    const frame = lastFrame()
    expect(frame).toContain('[OK]')
    expect(frame).toContain('[Cancel]')
  })

  it('triggers onConfirm and onClose when Enter is pressed', async () => {
    const onConfirm = vi.fn()
    const onClose = vi.fn()

    const { stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="modal">
        <ConfirmDialog
          isOpen={true}
          message="Are you sure?"
          onConfirm={onConfirm}
          onClose={onClose}
        />
      </KeyboardScopeProvider>,
    )

    stdin.write('\r')
    await delay()

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('triggers onClose when Escape is pressed', async () => {
    const onClose = vi.fn()
    const onConfirm = vi.fn()

    const { stdin } = renderInTheme(
      <KeyboardScopeProvider defaultScope="modal">
        <ConfirmDialog
          isOpen={true}
          message="Are you sure?"
          onConfirm={onConfirm}
          onClose={onClose}
        />
      </KeyboardScopeProvider>,
    )

    stdin.write('\u001b')
    await delay()

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})

describe('useConfirmDialog', () => {
  it('starts closed', () => {
    let result: ReturnType<typeof useConfirmDialog> | null = null
    function Harness() {
      result = useConfirmDialog({ message: 'Test', onConfirm: () => {} })
      return <Text>harness</Text>
    }
    renderInTheme(<Harness />)
    expect(result!.isOpen).toBe(false)
  })

  it('opens when open() is called', async () => {
    let result: ReturnType<typeof useConfirmDialog> | null = null
    function Harness() {
      result = useConfirmDialog({ message: 'Test', onConfirm: () => {} })
      return <Text>harness</Text>
    }
    renderInTheme(<Harness />)
    result!.open()
    await delay()
    expect(result!.isOpen).toBe(true)
  })

  it('closes when close() is called', async () => {
    let result: ReturnType<typeof useConfirmDialog> | null = null
    function Harness() {
      result = useConfirmDialog({ message: 'Test', onConfirm: () => {} })
      return <Text>harness</Text>
    }
    renderInTheme(<Harness />)
    result!.open()
    await delay()
    expect(result!.isOpen).toBe(true)
    result!.close()
    await delay()
    expect(result!.isOpen).toBe(false)
  })

  it('calls onConfirm and closes when confirm() is called', async () => {
    const onConfirm = vi.fn()
    let result: ReturnType<typeof useConfirmDialog> | null = null
    function Harness() {
      result = useConfirmDialog({ message: 'Test', onConfirm })
      return <Text>harness</Text>
    }
    renderInTheme(<Harness />)
    result!.open()
    await delay()
    result!.confirm()
    await delay()
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(result!.isOpen).toBe(false)
  })

  it('updates message via setMessage', async () => {
    let result: ReturnType<typeof useConfirmDialog> | null = null
    function Harness() {
      result = useConfirmDialog({ message: 'Original', onConfirm: () => {} })
      return <Text>harness</Text>
    }
    renderInTheme(<Harness />)
    expect(result!.message).toBe('Original')
    result!.setMessage('Updated')
    await delay()
    expect(result!.message).toBe('Updated')
  })
})
