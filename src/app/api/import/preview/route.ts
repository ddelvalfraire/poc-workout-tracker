import { NextResponse } from 'next/server'
import { getUserId } from '@/lib/auth'
import { getWeightUnit } from '@/db/preferences'
import { ImportPlanError, planImport, type ImportPlan } from '@/db/import'
import { detectImportSource } from '@/lib/import/detect'
import { parseStrong } from '@/lib/import/strong'
import { parseHevy } from '@/lib/import/hevy'
import { storePreview } from '@/lib/import/preview-cache'
import { isWeightUnit } from '@/lib/units'
import type { ParsedImport } from '@/lib/import/types'

/** Upload ceiling — a decade of set rows fits comfortably under this. */
const MAX_IMPORT_BYTES = 20 * 1024 * 1024

// Long preview lists are capped for the response; totals are always exact.
const MAX_LISTED = 50

/**
 * POST /api/import/preview — the dry-run half of the forced-confirm flow.
 * Multipart: `file` (the CSV) + optional `unit` ('kg' | 'lb', used only for
 * Strong files, which carry no unit column; defaults to the user's display
 * unit). Parses, plans (nothing written), stashes the parsed payload
 * server-side, and returns the plan summary + a single-use confirm token —
 * confirm never re-uploads. Guards: auth → multipart → size → format.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const userId = await getUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Expected multipart form data' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: 'Missing file' }, { status: 400 })
  }
  if (file.size > MAX_IMPORT_BYTES) {
    return NextResponse.json({ error: 'File too large (20MB max)' }, { status: 413 })
  }

  const unitRaw = form.get('unit')
  if (unitRaw !== null && (typeof unitRaw !== 'string' || !isWeightUnit(unitRaw))) {
    return NextResponse.json({ error: 'Invalid unit' }, { status: 400 })
  }

  const text = await file.text()
  const source = detectImportSource(text)
  if (source === null) {
    return NextResponse.json(
      { error: 'Unrecognized file — expected a Strong or Hevy CSV export.' },
      { status: 422 },
    )
  }

  let plan: ImportPlan
  let parsed: ParsedImport
  try {
    const unit = unitRaw !== null && isWeightUnit(unitRaw) ? unitRaw : await getWeightUnit(userId)
    parsed = source === 'strong' ? parseStrong(text, unit) : parseHevy(text)
    plan = await planImport(userId, parsed)
  } catch (error: unknown) {
    if (error instanceof ImportPlanError) {
      return NextResponse.json({ error: error.message }, { status: 422 })
    }
    console.error('POST /api/import/preview failed', error)
    return NextResponse.json({ error: 'Failed to read the file' }, { status: 500 })
  }

  const fileName = file instanceof File && file.name !== '' ? file.name : null
  let token: string | null
  try {
    token = await storePreview(userId, { parsed, fileName })
  } catch (error: unknown) {
    console.error('POST /api/import/preview cache write failed', error)
    token = null
  }
  if (token === null) {
    return NextResponse.json(
      { error: 'Import is unavailable right now — try again later.' },
      { status: 503 },
    )
  }

  return NextResponse.json({
    token,
    source: plan.source,
    // The unit weights were read in; only meaningful to pick for Strong.
    sourceUnit: plan.sourceUnit,
    unitFromFile: plan.source === 'hevy',
    fileName,
    workoutCount: plan.workoutCount,
    setCount: plan.setCount,
    duplicateCount: plan.duplicates.length,
    skippedCount: plan.skipped.length,
    dateRange: plan.dateRange
      ? { from: plan.dateRange.from.toISOString(), to: plan.dateRange.to.toISOString() }
      : null,
    matched: plan.matched.map((m) => ({
      importName: m.importName,
      name: m.name,
      source: m.source,
    })),
    toCreate: plan.toCreate,
    skipped: plan.skipped.slice(0, MAX_LISTED),
    duplicates: plan.duplicates
      .slice(0, MAX_LISTED)
      .map((d) => ({ name: d.name, startedAt: d.startedAt.toISOString() })),
    warnings: plan.warnings,
  })
}
