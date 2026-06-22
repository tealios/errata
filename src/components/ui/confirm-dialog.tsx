import { createContext, useCallback, useContext, useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

export interface ConfirmOptions {
  title: string
  description?: string
  confirmText?: string
  cancelText?: string
  /** Style the confirm button as a destructive action. */
  destructive?: boolean
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

/**
 * Async confirm() resolving true/false — use instead of native window.confirm(), which
 * on Electron can leave the window unfocused (blocking input) after it closes.
 */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used within a ConfirmProvider')
  return ctx
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  const resolverRef = useRef<((value: boolean) => void) | null>(null)

  const confirm = useCallback<ConfirmFn>((opts) => {
    setOptions(opts)
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve
    })
  }, [])

  const settle = useCallback((result: boolean) => {
    resolverRef.current?.(result)
    resolverRef.current = null
    setOptions(null)
  }, [])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog open={options !== null} onOpenChange={(open) => { if (!open) settle(false) }}>
        {options && (
          <DialogContent showCloseButton={false} className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>{options.title}</DialogTitle>
              {options.description && (
                <DialogDescription>{options.description}</DialogDescription>
              )}
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => settle(false)}>
                {options.cancelText ?? 'Cancel'}
              </Button>
              <Button
                variant={options.destructive ? 'destructive' : 'default'}
                onClick={() => settle(true)}
              >
                {options.confirmText ?? 'Confirm'}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </ConfirmContext.Provider>
  )
}
