import { NextResponse } from 'next/server'
import { getUserId } from '@/lib/auth'
import { getWeightUnit } from '@/db/preferences'
import { listTrophies } from '@/db/trophies'
import { trophyCardData } from '@/lib/cards/card-data'
import { CardFrame, cardImage, CARD_COLORS, HEADLINE_STYLE } from '@/lib/cards/chrome'
import { getMessages } from '@/i18n/translate'

/**
 * GET /api/cards/trophy/[kind] — 1200×630 PNG of the CURRENT user's earned
 * trophy. AUTHED by design: the share flow fetches this same-origin and hands
 * the FILE to the OS share sheet — there is no public image URL, nothing
 * tokenized, nothing crawlable. Unknown kinds and unearned kinds return the
 * same constant-shape 404.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ kind: string }> },
): Promise<Response> {
  const userId = await getUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { kind } = await params

  try {
    const [rows, unit, t] = await Promise.all([
      listTrophies(userId),
      getWeightUnit(userId),
      getMessages('Trophies'),
    ])
    const data = trophyCardData(rows, kind, unit, (message) => t(message.key, message.values))
    if (data === null) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    return cardImage(
      <CardFrame eyebrow="Trophy">
        <div style={{ display: 'flex', fontSize: 104, ...HEADLINE_STYLE }}>{data.title}</div>
        <div
          style={{
            display: 'flex',
            marginTop: 24,
            fontSize: 40,
            fontWeight: 600,
            color: CARD_COLORS.muted,
          }}
        >
          {data.context}
        </div>
      </CardFrame>,
    )
  } catch (error: unknown) {
    console.error('GET /api/cards/trophy failed', error)
    return NextResponse.json({ error: 'Failed to render card' }, { status: 500 })
  }
}
