import { describe, it, expect } from 'vitest'
import { detectImportSource } from './detect'

const STRONG_HEADER =
  'Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE'
const HEVY_HEADER =
  'title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe'

describe('detectImportSource', () => {
  it('detects a Strong export from its header', () => {
    expect(detectImportSource(`${STRONG_HEADER}\n...`)).toBe('strong')
  })

  it('detects a Hevy export from its header (weight_kg variant)', () => {
    expect(detectImportSource(`${HEVY_HEADER}\n...`)).toBe('hevy')
  })

  it('detects the Hevy weight_lbs variant', () => {
    expect(detectImportSource(HEVY_HEADER.replace('weight_kg', 'weight_lbs'))).toBe('hevy')
  })

  it('is case-insensitive and BOM-tolerant', () => {
    expect(detectImportSource(`﻿${STRONG_HEADER.toUpperCase()}\n`)).toBe('strong')
  })

  it('returns null for an unrelated CSV', () => {
    expect(detectImportSource('name,email\nalice,alice@example.com')).toBeNull()
  })

  it('returns null for empty input', () => {
    expect(detectImportSource('')).toBeNull()
  })

  it('returns null for a Hevy-ish header missing the weight column', () => {
    expect(detectImportSource('title,start_time,exercise_title,set_index')).toBeNull()
  })
})
