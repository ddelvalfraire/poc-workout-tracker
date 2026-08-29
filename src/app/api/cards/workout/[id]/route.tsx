import { NextResponse } from 'next/server'
import { getUserId } from '@/lib/auth/auth'
import { getWorkoutDetail } from '@/db/workouts'
import { getWeightUnit } from '@/db/preferences'
import { workoutCardData } from '@/lib/cards/card-data'
import { CardFrame, cardImage, CARD_COLORS, HEADLINE_STYLE } from '@/lib/cards/chrome'
import { getMessages } from '@/i18n/translate'

/**
 * GET /api/cards/workout/[id] — 1200×630 PNG of one of the CURRENT user's
 * completed sessions. AUTHED by design (see the trophy route): the image is
 * shared via the OS sheet; this URL never leaves the session. A missing,
 * unowned, or still-in-progress workout all collapse into the constant 404
 * (completed-only is the summary page's own contract).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const userId = await getUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params

  try {
    const [workout, unit] = await Promise.all([
      getWorkoutDetail(userId, id),
      getWeightUnit(userId),
    ])
    const tCard = await getMessages('ShareCard')
    const data = workout ? workoutCardData(workout, unit) : null
    if (data === null) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    return cardImage(
      <CardFrame eyebrow={tCard('session')}>
        <div style={{ display: 'flex', fontSize: 64, ...HEADLINE_STYLE }}>{data.title}</div>
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
            {data.unitLabel}
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
          {data.context}
        </div>
      </CardFrame>,
    )
  } catch (error: unknown) {
    console.error('GET /api/cards/workout failed', error)
    return NextResponse.json({ error: 'Failed to render card' }, { status: 500 })
  }
}
