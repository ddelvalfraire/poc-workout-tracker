import { useEffect, useState } from 'react'

/**
 * Returns `value` delayed by `delay` ms — the debounced value only updates once
 * `value` has stopped changing for `delay`. Used to throttle the exercise-picker
 * search so we don't fire a request on every keystroke.
 */
export function useDebounce<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])

  return debounced
}
