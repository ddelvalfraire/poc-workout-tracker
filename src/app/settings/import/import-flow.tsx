'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { WEIGHT_UNITS, type WeightUnit } from '@/lib/units'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'

/**
 * The upload → dry-run preview → forced-confirm flow. The file stays in
 * client state after upload, so changing the Strong unit re-runs the preview
 * without re-picking; confirm sends only the preview token (the server
 * cached the parse). Nothing is written until Confirm.
 */

export interface PreviewResponse {
  token: string
  source: 'strong' | 'hevy'
  sourceUnit: WeightUnit
  unitFromFile: boolean
  fileName: string | null
  workoutCount: number
  setCount: number
  duplicateCount: number
  skippedCount: number
  dateRange: { from: string; to: string } | null
  matched: { importName: string; name: string; source: 'wger' | 'custom' }[]
  toCreate: string[]
  skipped: { row: number; reason: string }[]
  duplicates: { name: string | null; startedAt: string }[]
  warnings: string[]
}

export interface CommitResponse {
  batchId: string
  workoutsImported: number
  setsImported: number
  duplicatesSkipped: number
  customsCreated: number
}

interface ImportFlowProps {
  /** The user's display unit — the Strong unit picker's starting value. */
  defaultUnit: WeightUnit
}

type Phase = 'idle' | 'previewing' | 'preview' | 'committing' | 'done'

const MAX_IMPORT_BYTES = 20 * 1024 * 1024

export function ImportFlow({ defaultUnit }: ImportFlowProps) {
  const t = useTranslations('ImportFlow')
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [unit, setUnit] = useState<WeightUnit>(defaultUnit)
  const [phase, setPhase] = useState<Phase>('idle')
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [result, setResult] = useState<CommitResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  async function runPreview(nextFile: File, previewUnit: WeightUnit) {
    if (nextFile.size > MAX_IMPORT_BYTES) {
      setError(t('errorTooLarge'))
      setPhase('idle')
      return
    }
    setPhase('previewing')
    setError(null)
    try {
      const form = new FormData()
      form.set('file', nextFile)
      form.set('unit', previewUnit)
      const response = await fetch('/api/import/preview', { method: 'POST', body: form })
      const body: unknown = await response.json()
      if (!response.ok) {
        throw new Error(errorMessage(body, t('errorRead')))
      }
      setPreview(body as PreviewResponse)
      setPhase('preview')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('errorRead'))
      setPhase('idle')
    }
  }

  function onFilePicked(picked: File | null) {
    if (!picked) return
    setFile(picked)
    setResult(null)
    void runPreview(picked, unit)
  }

  function onUnitChange(next: WeightUnit) {
    if (next === unit) return
    setUnit(next)
    // Strong weights were read in the old unit — the preview must re-run.
    if (file) void runPreview(file, next)
  }

  async function confirm() {
    if (!preview) return
    setPhase('committing')
    setError(null)
    try {
      const response = await fetch('/api/import/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: preview.token }),
      })
      const body: unknown = await response.json()
      if (!response.ok) {
        throw new Error(errorMessage(body, t('errorCommit')))
      }
      setResult(body as CommitResponse)
      setPhase('done')
      // The batches list on this page is server-rendered — refresh it.
      router.refresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('errorCommit'))
      setPhase('preview')
    }
  }

  function reset() {
    setFile(null)
    setPreview(null)
    setResult(null)
    setError(null)
    setPhase('idle')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // The three-step arc the indicator narrates: upload → review → done.
  const step = phase === 'done' ? 3 : phase === 'preview' || phase === 'committing' ? 2 : 1
  const stepLabel = step === 3 ? t('steps.done') : step === 2 ? t('steps.review') : t('steps.upload')
  const isBusy = phase === 'previewing' || phase === 'committing'
  const hasPreview = phase === 'preview' || phase === 'committing'

  return (
    <section aria-label={t('sectionLabel')} className="mt-6">
      <div>
        {/* Step indicator: where you are in the arc, in words + segments. */}
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {t('steps.indicator', { step, label: stepLabel })}
          </p>
          <div aria-hidden="true" className="flex shrink-0 gap-1">
            {[1, 2, 3].map((s) => (
              <span
                key={s}
                className={cn(
                  'h-1 w-5 rounded-full',
                  s <= step ? 'bg-primary' : 'bg-muted',
                )}
              />
            ))}
          </div>
        </div>

        {phase === 'done' && result ? (
          <div className="mt-3">
            <SuccessSummary result={result} onReset={reset} />
          </div>
        ) : (
          <>
            <p className="mt-3 font-medium">{t('title')}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {t('preview.reassurance')}
            </p>
            {/* Drop-zone label wrapping the hidden input: the whole dashed
                target opens the picker, and a dragged file lands the same
                onFilePicked path. Compact once a preview is up — the target
                becomes "swap the file", not the main event. */}
            <label
              onDragOver={(e) => {
                e.preventDefault()
                if (!isBusy) setIsDragging(true)
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault()
                setIsDragging(false)
                if (!isBusy) onFilePicked(e.dataTransfer.files?.[0] ?? null)
              }}
              className={cn(
                'mt-3 flex w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border text-center transition-colors',
                hasPreview ? 'px-4 py-3' : 'px-4 py-8',
                isDragging && 'border-primary bg-primary/5',
                isBusy && 'pointer-events-none opacity-50',
              )}
            >
              <span className="text-sm font-medium">
                {hasPreview ? t('dropzone.actionSwap') : t('dropzone.action')}
              </span>
              {!hasPreview && (
                <span className="text-xs text-muted-foreground">
                  {t('dropzone.hint')}
                </span>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                aria-label={t('fileInputLabel')}
                disabled={isBusy}
                onChange={(e) => onFilePicked(e.target.files?.[0] ?? null)}
                className="sr-only"
              />
            </label>
            {phase === 'previewing' && (
              <p className="mt-3 text-sm text-muted-foreground" role="status">
                {t('status.reading')}
              </p>
            )}
            {error && (
              <p role="alert" className="mt-3 text-sm text-destructive">
                {error}
              </p>
            )}
            {(phase === 'preview' || phase === 'committing') && preview && (
              <PreviewSummary
                preview={preview}
                unit={unit}
                isCommitting={phase === 'committing'}
                onUnitChange={onUnitChange}
                onConfirm={() => void confirm()}
                onCancel={reset}
              />
            )}
          </>
        )}
      </div>
    </section>
  )
}

export interface PreviewSummaryProps {
  preview: PreviewResponse
  unit: WeightUnit
  isCommitting: boolean
  onUnitChange: (unit: WeightUnit) => void
  onConfirm: () => void
  onCancel: () => void
}

// Exported for tests: the confirm CTA and the skip notices carry the flow
// plurals, and they are only reachable after a real upload round-trip.
export function PreviewSummary({
  preview,
  unit,
  isCommitting,
  onUnitChange,
  onConfirm,
  onCancel,
}: PreviewSummaryProps) {
  const t = useTranslations('ImportFlow')
  const tCommon = useTranslations('Common')
  const sourceLabel = preview.source === 'strong' ? t('source.strong') : t('source.hevy')
  return (
    <div className="mt-4 border-t border-t-border/60 pt-4">
      <p className="text-sm">
        <span className="font-medium">{t('preview.sourceExport', { source: sourceLabel })}</span>
        {preview.fileName && (
          <span className="text-muted-foreground">
            {t('preview.fileNameSuffix', { fileName: preview.fileName })}
          </span>
        )}
      </p>

      {/* Unit picker only when the file doesn't declare one (Strong). */}
      {!preview.unitFromFile && (
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {t('unit.hint')}
          </p>
          <div role="group" aria-label={t('unitGroupLabel')} className="flex shrink-0 gap-1">
            {WEIGHT_UNITS.map((u) => (
              <Button
                key={u}
                size="sm"
                variant={u === unit ? 'default' : 'ghost'}
                aria-pressed={u === unit}
                disabled={isCommitting}
                onClick={() => onUnitChange(u)}
              >
                {u}
              </Button>
            ))}
          </div>
        </div>
      )}

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">{t('preview.workoutsLabel')}</dt>
        <dd className="text-right tnum">{preview.workoutCount}</dd>
        <dt className="text-muted-foreground">{t('preview.setsLabel')}</dt>
        <dd className="text-right tnum">{preview.setCount}</dd>
        {preview.dateRange && (
          <>
            <dt className="text-muted-foreground">{t('preview.datesLabel')}</dt>
            <dd className="text-right">
              {formatDay(preview.dateRange.from)} – {formatDay(preview.dateRange.to)}
            </dd>
          </>
        )}
        <dt className="text-muted-foreground">{t('preview.matchedLabel')}</dt>
        <dd className="text-right tnum">{preview.matched.length}</dd>
      </dl>

      {preview.toCreate.length > 0 && (
        <div className="mt-3 border-t border-t-border/60 pt-3">
          <p className="text-sm font-medium tnum">
            {t('preview.newExercisesCount', { count: preview.toCreate.length })}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('preview.newExercisesDescription')}
          </p>
          <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
            {preview.toCreate.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </div>
      )}

      {preview.duplicateCount > 0 && (
        <p className="mt-3 text-sm text-muted-foreground">
          {t('preview.duplicatesNotice', { count: preview.duplicateCount })}
        </p>
      )}

      {preview.skippedCount > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-muted-foreground">
            {t('skipped.summary', { count: preview.skippedCount })}
          </summary>
          <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
            {preview.skipped.map((s) => (
              <li key={s.row}>{t('skipped.row', { row: s.row, reason: s.reason })}</li>
            ))}
            {preview.skippedCount > preview.skipped.length && (
              <li>
                {t('skipped.andMore', { count: preview.skippedCount - preview.skipped.length })}
              </li>
            )}
          </ul>
        </details>
      )}

      {preview.warnings.map((warning) => (
        <p key={warning} className="mt-3 text-xs text-muted-foreground">
          {warning}
        </p>
      ))}

      <div className="mt-4 flex gap-2">
        <Button variant="outline" className="flex-1" disabled={isCommitting} onClick={onCancel}>
          {tCommon('cancel')}
        </Button>
        <Button
          className="flex-1"
          disabled={isCommitting || preview.workoutCount === 0}
          onClick={onConfirm}
        >
          {isCommitting
            ? t('actions.confirmPending')
            : t('actions.confirm', { count: preview.workoutCount })}
        </Button>
      </div>
    </div>
  )
}

export function SuccessSummary({ result, onReset }: { result: CommitResponse; onReset: () => void }) {
  const t = useTranslations('ImportFlow')
  return (
    <div>
      <p className="font-medium">{t('success.title')}</p>
      <p className="mt-0.5 text-sm text-muted-foreground">
        {t('success.summary', {
          workouts: result.workoutsImported,
          sets: result.setsImported,
        })}
        {result.duplicatesSkipped > 0 &&
          t('success.duplicatesSuffix', { count: result.duplicatesSkipped })}
        {result.customsCreated > 0 &&
          t('success.customsSuffix', { count: result.customsCreated })}
      </p>
      <div className="mt-4 flex gap-2">
        <Button variant="outline" className="flex-1" onClick={onReset}>
          {t('actions.importAnother')}
        </Button>
        <Link
          href="/"
          className="flex flex-1 items-center justify-center rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
        >
          {t('actions.viewHistory')}
        </Link>
      </div>
    </div>
  )
}

function formatDay(iso: string): string {
  // The stored times are wall-clock digits serialized as UTC — format in UTC
  // so the day shown is the day the file said, not the viewer's offset.
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(iso),
  )
}

function errorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string') {
    return (body as { error: string }).error
  }
  return fallback
}
