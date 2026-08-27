import { describe, it, expect } from "vitest";
import { setSnapshotKey } from "@/db/workout-set-diff";
import { amendedSetKeys, type AmendedSetEvent } from "./amended-sets";

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    source: "wger",
    wgerExerciseId: 73,
    exerciseName: "Squat",
    setNumber: 3,
    reps: 5,
    weight: 100,
    completed: true,
    rir: null,
    rpe: null,
    metricMode: "weight_reps",
    durationSec: null,
    distanceM: null,
    ...overrides,
  };
}

function event(overrides: Partial<AmendedSetEvent> = {}): AmendedSetEvent {
  return { kind: "amendment", before: snapshot(), after: snapshot({ weight: 102.5 }), ...overrides };
}

describe("amendedSetKeys", () => {
  it("keys an amended set by the same identity the log writes", () => {
    // Act
    const keys = amendedSetKeys([event()]);

    // Assert
    expect(keys).toEqual(new Set([setSnapshotKey("wger", 73, 3)]));
  });

  it("ignores every kind that is not an amendment", () => {
    // The original persist, a late entry and the app's own writes do not
    // CONTRADICT anything — marking their rows would mark the whole workout.
    const keys = amendedSetKeys([
      event({ kind: "original" }),
      event({ kind: "late_entry" }),
      event({ kind: "system" }),
    ]);

    expect(keys.size).toBe(0);
  });

  it("falls back to the before-image when a set was removed", () => {
    const keys = amendedSetKeys([event({ after: null })]);
    expect(keys).toEqual(new Set([setSnapshotKey("wger", 73, 3)]));
  });

  it("skips events whose subject is not a set", () => {
    // jsonb is untyped in the database, so a workout-level or future subject
    // reaches this reader as an object that simply does not key.
    const keys = amendedSetKeys([
      event({ before: null, after: null }),
      event({ before: null, after: { note: "felt heavy" } }),
      event({ before: null, after: snapshot({ setNumber: "3" }) }),
      event({ before: null, after: snapshot({ source: 7 }) }),
      event({ before: null, after: "wger:73:3" }),
    ]);

    expect(keys.size).toBe(0);
  });

  it("collapses repeated corrections of the same set to one mark", () => {
    const keys = amendedSetKeys([event(), event({ after: snapshot({ reps: 6 }) })]);
    expect(keys.size).toBe(1);
  });
});
