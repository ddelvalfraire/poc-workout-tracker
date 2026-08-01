import { permanentRedirect } from 'next/navigation'

/**
 * /bodyweight folded into /body (one check-in destination: weight + tape).
 * Permanent redirect so old deep links — home-screen shortcuts, push
 * notifications, browser history — keep landing somewhere real.
 */
export default function BodyweightRedirect(): never {
  permanentRedirect('/body')
}
