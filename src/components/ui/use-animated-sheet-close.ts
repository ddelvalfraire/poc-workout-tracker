import { useCallback, useRef, type RefObject } from 'react'

/**
 * Animated dismissal for the bottom-sheet <dialog>s: plays the .sheet-exit
 * slide-down, THEN fires onClose (which unmounts the sheet — an exit
 * animation can't outlive its node, so the unmount must wait for it).
 * Reduced motion closes immediately. A timeout backstop guarantees onClose
 * even if animationend never fires (throttled tab, interrupted animation),
 * and a done-flag keeps the two paths from double-firing. Re-entrant calls
 * during the exit are swallowed — the close is already on its way.
 *
 * Deliberately NOT used by the unmount cleanup's dialog.close(): that path
 * runs when React is already tearing the node down (e.g. the close-before-
 * push navigation), where deferring would strand the ::backdrop.
 */
const EXIT_MS = 160
const EXIT_BACKSTOP_MS = EXIT_MS + 90

export function useAnimatedSheetClose(
  dialogRef: RefObject<HTMLDialogElement | null>,
  onClose: () => void,
): () => void {
  const closingRef = useRef(false)
  return useCallback(() => {
    const dialog = dialogRef.current
    if (closingRef.current) return
    if (!dialog || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onClose()
      return
    }
    closingRef.current = true
    let done = false
    const finish = () => {
      if (done) return
      done = true
      closingRef.current = false
      onClose()
    }
    dialog.classList.add('sheet-exit')
    dialog.addEventListener('animationend', finish, { once: true })
    setTimeout(finish, EXIT_BACKSTOP_MS)
  }, [dialogRef, onClose])
}
