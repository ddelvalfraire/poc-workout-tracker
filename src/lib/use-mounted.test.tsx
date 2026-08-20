// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { act } from 'react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { useMounted } from './use-mounted'

/**
 * The hook's whole contract is its two snapshots and the flip between them.
 *
 * The server snapshot matters because if it ever returned true, every
 * local-calendar surface would bake the SERVER's day into the HTML. The FLIP
 * matters because it is the only reason anything gated on this hook ever
 * shows real content — and a plain client render (createRoot) cannot observe
 * it, since React calls getSnapshot directly and mounted is true from the
 * first render. So this hydrates, which is what the browser actually does.
 */
function Probe() {
  return <span>{useMounted() ? 'mounted' : 'pre-mount'}</span>
}

describe('useMounted', () => {
  it('is false while rendering on the server', () => {
    expect(renderToString(<Probe />)).toBe('<span>pre-mount</span>')
  })

  it('hydrates with the server snapshot, then flips to mounted', async () => {
    const container = document.createElement('div')
    container.innerHTML = renderToString(<Probe />)
    document.body.appendChild(container)
    // Pre-hydration the DOM still carries the server's answer — this is the
    // frame a mismatch would blow up in.
    expect(container.textContent).toBe('pre-mount')

    await act(async () => {
      hydrateRoot(container, <Probe />)
    })

    expect(container.textContent).toBe('mounted')
    container.remove()
  })
})
