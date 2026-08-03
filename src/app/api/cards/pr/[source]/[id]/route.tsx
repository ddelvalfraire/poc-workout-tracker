import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { getExerciseStats } from '@/db/exercise-stats'
import { getWeightUnit } from '@/db/preferences'
import { parseExerciseRef } from '@/app/exercises/exercise-ref'
import { prCardData } from '@/lib/cards/card-data'
import { CardFrame, cardImage, CARD_COLORS, HEADLINE_STYLE } from '@/lib/cards/chrome'

/**
 * GET /api/cards/pr/[source]/[id] — 1200×630 PNG of the CURRENT user's best
 * e1RM for one exercise. AUTHED by design (see the trophy route): the image
 * itself is shared via the OS sheet; this URL never leaves the session. A bad
 * ref, no history, and no e1RM record all collapse into the constant 404.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ source: string; id: string }> },
): Promise<Response> {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { source, id } = await params
  const ref = parseExerciseRef(source, id)
  if (ref === null) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  try {
    const [stats, unit] = await Promise.all([
      getExerciseStats(userId, ref.source, ref.wgerExerciseId),
      getWeightUnit(userId),
    ])
    const data = prCardData(stats, unit)
    if (data === null) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    return cardImage(
      <CardFrame eyebrow="Personal Record">
        <div style={{ display: 'flex', fontSize: 64, ...HEADLINE_STYLE }}>{data.exerciseName}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', marginTop: 20 }}>
          <div
            style={{
              display: 'flex',
              fontSize: 150,
              fontWeight: 800,
              lineHeight: 1,
              letterSpacing: -3,
              color: CARD_COLORS.volt,
            }}
          >
            {data.value}
          </div>
          <div
            style={{
              display: 'flex',
              marginLeft: 20,
              fontSize: 52,
              fontWeight: 700,
              color: CARD_COLORS.muted,
            }}
          >
            {data.unit}
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            marginTop: 20,
            fontSize: 36,
            fontWeight: 600,
            color: CARD_COLORS.muted,
          }}
        >
          {`Est. 1RM · ${data.dateText}`}
        </div>
      </CardFrame>,
    )
  } catch (error: unknown) {
    console.error('GET /api/cards/pr failed', error)
    return NextResponse.json({ error: 'Failed to render card' }, { status: 500 })
  }
}
