'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { updateCustomExerciseAction } from './actions'
import { EXERCISE_CATEGORIES } from '@/lib/custom-exercise-input'
import { CATALOG_MUSCLE_NAMES } from '@/lib/muscle-groups'
import { cn } from '@/lib/utils'

/**
 * Edit island for a CUSTOM exercise's definition, collapsed behind one
 * outline button on its stats page. Name/category/primary-muscle chips —
 * the same vocabulary as the picker's create form. `musclesSecondary` is
 * round-tripped VERBATIM: the update action is full-field, and an editor
 * that doesn't show a field must not silently erase it.
 */

interface CustomExerciseEditorProps {
  id: number
  name: string
  category: string
  muscles: string[]
  musclesSecondary: string[]
}

export function CustomExerciseEditor({
  id,
  name: initialName,
  category: initialCategory,
  muscles: initialMuscles,
  musclesSecondary,
}: CustomExerciseEditorProps) {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [name, setName] = useState(initialName)
  const [category, setCategory] = useState(initialCategory)
  const [muscles, setMuscles] = useState<string[]>(initialMuscles)
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  function toggleMuscle(muscle: string) {
    setMuscles((prev) =>
      prev.includes(muscle) ? prev.filter((m) => m !== muscle) : [...prev, muscle],
    )
  }

  async function handleSave() {
    if (name.trim().length === 0) {
      setError('Give it a name.')
      return
    }
    setError(null)
    setIsSaving(true)
    try {
      await updateCustomExerciseAction(id, {
        name: name.trim(),
        category,
        ...(muscles.length > 0 ? { muscles } : {}),
        // Verbatim round-trip — see the component doc comment.
        ...(musclesSecondary.length > 0 ? { musclesSecondary } : {}),
      })
      router.refresh() // header/name/records re-render from the server
      setIsOpen(false)
      setIsSaving(false)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not save changes.')
      setIsSaving(false)
    }
  }

  if (!isOpen) {
    return (
      <Button size="sm" variant="outline" className="w-full" onClick={() => setIsOpen(true)}>
        Edit custom exercise
      </Button>
    )
  }

  return (
    <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <p className="text-xs font-semibold uppercase tracking-widest text-primary">
        Edit custom exercise
      </p>
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label="Custom exercise name"
      />
      <select
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        aria-label="Category"
        className="h-9 w-full rounded-lg border border-border bg-transparent px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {EXERCISE_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <div>
        <p className="text-xs text-muted-foreground">Primary muscles</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {CATALOG_MUSCLE_NAMES.map((muscle) => (
            <button
              key={muscle}
              type="button"
              onClick={() => toggleMuscle(muscle)}
              aria-pressed={muscles.includes(muscle)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                muscles.includes(muscle)
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-muted text-muted-foreground',
              )}
            >
              {muscle}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          className="flex-1"
          onClick={() => {
            // Cancel discards edits back to the server truth.
            setName(initialName)
            setCategory(initialCategory)
            setMuscles(initialMuscles)
            setError(null)
            setIsOpen(false)
          }}
        >
          Cancel
        </Button>
        <Button size="sm" className="flex-1" onClick={handleSave} disabled={isSaving}>
          {isSaving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  )
}
