import { NextResponse } from 'next/server'
import { getUserId } from '@/lib/auth/auth'
import { getExerciseStats } from '@/db/exercise-stats'
import { getWeightUnit } from '@/db/preferences'
import { parseExerciseRef } from '@/app/exercises/exercise-ref'
import { sparklinePath, trendCardData } from '@/lib/cards/card-data'
import { CardFrame, cardImage, CARD_COLORS, HEADLINE_STYLE } from '@/lib/cards/chrome'
import { getMessages } from '@/i18n/translate'

/** Sparkline canvas inside the 1200-wide card (72px side padding each side). */
const SPARK_WIDTH = 1056
const SPARK_HEIGHT = 150

/**
 * GET /api/cards/trend/[source]/[id] — 1200×630 PNG of the CURRENT user's
 * e1RM trend for one exercise ("315 → 340 lb in 8 weeks" + sparkline).
 * AUTHED by design (see the trophy route). A bad ref, no history, and a
 * single-session trend all collapse into the constant 404.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ source: string; id: string }> },
): Promise<Response> {
  const userId = await getUserId()
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
    const tCard = await getMessages('ShareCard')
    const data = trendCardData(stats, unit)
    if (data === null) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    return cardImage(
      <CardFrame eyebrow={tCard('progress')}>
        <div style={{ display: 'flex', fontSize: 56, ...HEADLINE_STYLE }}>{data.exerciseName}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', marginTop: 16 }}>
          <div
            style={{
              display: 'flex',
              fontSize: 96,
              fontWeight: 800,
              lineHeight: 1,
              letterSpacing: -2,
              color: CARD_COLORS.volt,
            }}
          >
            {data.headline}
          </div>
          <div
            style={{
              display: 'flex',
              marginLeft: 24,
              fontSize: 44,
              fontWeight: 600,
              color: CARD_COLORS.muted,
            }}
          >
            {data.subline}
          </div>
        </div>
        <svg
          width={SPARK_WIDTH}
          height={SPARK_HEIGHT}
          viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
          style={{ marginTop: 36 }}
        >
          <path
            d={sparklinePath(data.values, SPARK_WIDTH, SPARK_HEIGHT)}
            stroke={CARD_COLORS.volt}
            strokeWidth={8}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </CardFrame>,
    )
  } catch (error: unknown) {
    console.error('GET /api/cards/trend failed', error)
    return NextResponse.json({ error: 'Failed to render card' }, { status: 500 })
  }
}
