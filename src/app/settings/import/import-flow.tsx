'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { WEIGHT_UNITS, type WeightUnit } from '@/lib/units'
import { cn } from '@/lib/utils'

/**
 * The upload → dry-run preview → forced-confirm flow. The file stays in
 * client state after upload, so changing the Strong unit re-runs the preview
 * without re-picking; confirm sends only the preview token (the server
 * cached the parse). Nothing is written until Confirm.
 */

interface PreviewResponse {
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

interface CommitResponse {
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
      setError('File too large (20MB max).')
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
        throw new Error(errorMessage(body, 'Failed to read the file.'))
      }
      setPreview(body as PreviewResponse)
      setPhase('preview')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to read the file.')
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
        throw new Error(errorMessage(body, 'Import failed.'))
      }
      setResult(body as CommitResponse)
      setPhase('done')
      // The batches list on this page is server-rendered — refresh it.
      router.refresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Import failed.')
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
  const stepLabel = step === 3 ? 'Done' : step === 2 ? 'Review' : 'Upload'
  const isBusy = phase === 'previewing' || phase === 'committing'
  const hasPreview = phase === 'preview' || phase === 'committing'

  return (
    <section aria-label="Import a history file" className="mt-6">
      <div className="rounded-2xl border border-border bg-card p-4">
        {/* Step indicator: where you are in the arc, in words + segments. */}
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Step {step} of 3 — {stepLabel}
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
            <p className="mt-3 font-medium">Import from Strong or Hevy</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Nothing is saved until you confirm the preview.
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
                {hasPreview ? 'Choose a different CSV' : 'Choose CSV — Strong or Hevy'}
              </span>
              {!hasPreview && (
                <span className="text-xs text-muted-foreground">
                  The export format is detected automatically — or drag the file here.
                </span>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                aria-label="History CSV file"
                disabled={isBusy}
                onChange={(e) => onFilePicked(e.target.files?.[0] ?? null)}
                className="sr-only"
              />
            </label>
            {phase === 'previewing' && (
              <p className="mt-3 text-sm text-muted-foreground" role="status">
                Reading file…
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

interface PreviewSummaryProps {
  preview: PreviewResponse
  unit: WeightUnit
  isCommitting: boolean
  onUnitChange: (unit: WeightUnit) => void
  onConfirm: () => void
  onCancel: () => void
}

function PreviewSummary({
  preview,
  unit,
  isCommitting,
  onUnitChange,
  onConfirm,
  onCancel,
}: PreviewSummaryProps) {
  const sourceLabel = preview.source === 'strong' ? 'Strong' : 'Hevy'
  return (
    <div className="mt-4 border-t border-border pt-4">
      <p className="text-sm">
        <span className="font-medium">{sourceLabel} export</span>
        {preview.fileName && <span className="text-muted-foreground"> — {preview.fileName}</span>}
      </p>

      {/* Unit picker only when the file doesn't declare one (Strong). */}
      {!preview.unitFromFile && (
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Strong files don&rsquo;t say kg or lb — pick the unit this account logged in.
          </p>
          <div role="group" aria-label="File weight unit" className="flex shrink-0 gap-1">
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
        <dt className="text-muted-foreground">Workouts</dt>
        <dd className="text-right tnum">{preview.workoutCount}</dd>
        <dt className="text-muted-foreground">Sets</dt>
        <dd className="text-right tnum">{preview.setCount}</dd>
        {preview.dateRange && (
          <>
            <dt className="text-muted-foreground">Dates</dt>
            <dd className="text-right">
              {formatDay(preview.dateRange.from)} – {formatDay(preview.dateRange.to)}
            </dd>
          </>
        )}
        <dt className="text-muted-foreground">Matched exercises</dt>
        <dd className="text-right tnum">{preview.matched.length}</dd>
      </dl>

      {preview.toCreate.length > 0 && (
        <div className="mt-3 rounded-xl bg-muted/50 p-3">
          <p className="text-sm font-medium">
            {preview.toCreate.length} new custom exercise{preview.toCreate.length === 1 ? '' : 's'}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            These names weren&rsquo;t in the catalog and will be created as your custom exercises:
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
          {preview.duplicateCount} workout{preview.duplicateCount === 1 ? '' : 's'} already in
          your history will be skipped.
        </p>
      )}

      {preview.skippedCount > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-muted-foreground">
            {preview.skippedCount} row{preview.skippedCount === 1 ? '' : 's'} can&rsquo;t be
            imported
          </summary>
          <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
            {preview.skipped.map((s) => (
              <li key={s.row}>
                Row {s.row}: {s.reason}
              </li>
            ))}
            {preview.skippedCount > preview.skipped.length && (
              <li>…and {preview.skippedCount - preview.skipped.length} more</li>
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
          Cancel
        </Button>
        <Button
          className="flex-1"
          disabled={isCommitting || preview.workoutCount === 0}
          onClick={onConfirm}
        >
          {isCommitting
            ? 'Importing…'
            : `Import ${preview.workoutCount} workout${preview.workoutCount === 1 ? '' : 's'}`}
        </Button>
      </div>
    </div>
  )
}

function SuccessSummary({ result, onReset }: { result: CommitResponse; onReset: () => void }) {
  return (
    <div>
      <p className="font-medium">Import complete</p>
      <p className="mt-0.5 text-sm text-muted-foreground">
        {result.workoutsImported} workout{result.workoutsImported === 1 ? '' : 's'} and{' '}
        {result.setsImported} set{result.setsImported === 1 ? '' : 's'} added to your history.
        {result.duplicatesSkipped > 0 && ` ${result.duplicatesSkipped} duplicates were skipped.`}
        {result.customsCreated > 0 &&
          ` ${result.customsCreated} custom exercise${result.customsCreated === 1 ? '' : 's'} created.`}
      </p>
      <div className="mt-4 flex gap-2">
        <Button variant="outline" className="flex-1" onClick={onReset}>
          Import another
        </Button>
        <Link
          href="/"
          className="flex flex-1 items-center justify-center rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
        >
          View history
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
