/**
 * progs-v1.ts — the @1 bodies of the seven programs the configurability fix
 * round REBOUND in place (their slots moved to the @2 schemes under a
 * constant program version), restored byte-for-byte to their pre-round
 * (synthesis-patfix) content and republished beside the @2 versions that
 * carry the rebinding (Z1: a published version is immutable, now enforced
 * by publish()).
 *
 * GENERATED from arena2/synthesis-patfix by ../../gen-progs-v1.ts (the
 * scratchpad script); regenerate rather than edit. Stored as literal IR so
 * the restored bodies cannot drift with the embedding's binder numbering.
 * Byte-checked independently by ../../cmp-progs-v1.ts against the recorded
 * pre-config and pre-cfgfix kits.
 */
import type { MacroDef, ProgramDef } from './structure'

export const GZCLP_T1_PROG_V1 = {
  "kind": "program",
  "ref": {
    "id": "prog/gzclp-t1",
    "version": 1
  },
  "says": "GZCLP T1 lifts on an A/B rotation, three days a week",
  "params": {
    "squatStart": {
      "t": "opt",
      "of": {
        "t": "q",
        "dim": {
          "mass": 1
        }
      }
    }
  },
  "facts": [],
  "enums": {},
  "calendar": {
    "weeks": [
      "train"
    ],
    "repeat": "cycle",
    "drift": "slide"
  },
  "grids": {
    "load": {
      "k": "lit",
      "lit": {
        "k": "q",
        "v": 2.5,
        "unit": "kg"
      }
    }
  },
  "muscles": [
    "quads",
    "chest",
    "back",
    "shoulders"
  ],
  "slots": {
    "squat": {
      "scheme": {
        "id": "lib/gzclp-t1",
        "version": 1
      },
      "args": {
        "lift": {
          "k": "lit",
          "lit": {
            "k": "ref",
            "kind": "exercise",
            "id": "wger:111"
          }
        },
        "inc": {
          "k": "lit",
          "lit": {
            "k": "q",
            "v": 5,
            "unit": "kg"
          }
        },
        "resetPct": {
          "k": "lit",
          "lit": {
            "k": "q",
            "v": 0.85,
            "unit": "pct"
          }
        },
        "start": {
          "k": "param",
          "name": "squatStart"
        }
      },
      "meta": {
        "muscles": {
          "quads": 1
        }
      }
    },
    "bench": {
      "scheme": {
        "id": "lib/gzclp-t1",
        "version": 1
      },
      "args": {
        "lift": {
          "k": "lit",
          "lit": {
            "k": "ref",
            "kind": "exercise",
            "id": "wger:192"
          }
        },
        "inc": {
          "k": "lit",
          "lit": {
            "k": "q",
            "v": 2.5,
            "unit": "kg"
          }
        },
        "resetPct": {
          "k": "lit",
          "lit": {
            "k": "q",
            "v": 0.85,
            "unit": "pct"
          }
        },
        "start": {
          "k": "none",
          "of": {
            "t": "q",
            "dim": {
              "mass": 1
            }
          }
        }
      },
      "meta": {
        "muscles": {
          "chest": 1
        }
      }
    },
    "dead": {
      "scheme": {
        "id": "lib/gzclp-t1",
        "version": 1
      },
      "args": {
        "lift": {
          "k": "lit",
          "lit": {
            "k": "ref",
            "kind": "exercise",
            "id": "wger:105"
          }
        },
        "inc": {
          "k": "lit",
          "lit": {
            "k": "q",
            "v": 5,
            "unit": "kg"
          }
        },
        "resetPct": {
          "k": "lit",
          "lit": {
            "k": "q",
            "v": 0.85,
            "unit": "pct"
          }
        },
        "start": {
          "k": "none",
          "of": {
            "t": "q",
            "dim": {
              "mass": 1
            }
          }
        }
      },
      "meta": {
        "muscles": {
          "back": 1
        }
      }
    },
    "press": {
      "scheme": {
        "id": "lib/gzclp-t1",
        "version": 1
      },
      "args": {
        "lift": {
          "k": "lit",
          "lit": {
            "k": "ref",
            "kind": "exercise",
            "id": "wger:119"
          }
        },
        "inc": {
          "k": "lit",
          "lit": {
            "k": "q",
            "v": 2.5,
            "unit": "kg"
          }
        },
        "resetPct": {
          "k": "lit",
          "lit": {
            "k": "q",
            "v": 0.85,
            "unit": "pct"
          }
        },
        "start": {
          "k": "none",
          "of": {
            "t": "q",
            "dim": {
              "mass": 1
            }
          }
        }
      },
      "meta": {
        "muscles": {
          "shoulders": 1
        }
      }
    }
  },
  "days": {
    "A1": [
      {
        "k": "single",
        "slot": "squat"
      }
    ],
    "B1": [
      {
        "k": "single",
        "slot": "press"
      }
    ],
    "A2": [
      {
        "k": "single",
        "slot": "bench"
      }
    ],
    "B2": [
      {
        "k": "single",
        "slot": "dead"
      }
    ]
  },
  "rotation": {
    "k": "alternate",
    "days": [
      "A1",
      "B1",
      "A2",
      "B2"
    ],
    "perWeek": 3
  },
  "frequency": [],
  "lapseAfterDays": 21,
  "hitPolicy": "allInOrder",
  "policies": [],
  "aggregate": null,
  "exports": {},
  "imports": {
    "squatStart": {
      "from": {
        "id": "prog/linear-3x5",
        "version": 1
      },
      "export": "squatLoad"
    }
  }
} as unknown as ProgramDef

export const OPT_STRENGTH_ENDURANCE_V1 = {
  "kind": "program",
  "ref": {
    "id": "prog/opt-strength-endurance",
    "version": 1
  },
  "says": "OPT Phase 2: a strength lift supersetted with its stabilization partner",
  "params": {
    "benchStart": {
      "t": "opt",
      "of": {
        "t": "q",
        "dim": {
          "mass": 1
        }
      }
    },
    "rung": {
      "t": "q",
      "dim": {}
    }
  },
  "facts": [],
  "enums": {},
  "calendar": {
    "weeks": [
      "train",
      "train",
      "train",
      "train"
    ],
    "repeat": "once",
    "drift": "slide"
  },
  "grids": {
    "load": {
      "k": "lit",
      "lit": {
        "k": "q",
        "v": 2.5,
        "unit": "kg"
      }
    }
  },
  "muscles": [
    "chest"
  ],
  "slots": {
    "bench": {
      "scheme": {
        "id": "lib/double-progression",
        "version": 1
      },
      "args": {
        "lift": {
          "k": "lit",
          "lit": {
            "k": "ref",
            "kind": "exercise",
            "id": "wger:192"
          }
        },
        "sets": {
          "k": "lit",
          "lit": {
            "k": "q",
            "v": 3,
            "unit": "set"
          }
        },
        "inc": {
          "k": "lit",
          "lit": {
            "k": "q",
            "v": 2.5,
            "unit": "kg"
          }
        },
        "start": {
          "k": "param",
          "name": "benchStart"
        }
      },
      "meta": {
        "muscles": {
          "chest": 1
        }
      }
    },
    "pushStab": {
      "scheme": {
        "id": "lib/stab-ladder",
        "version": 1
      },
      "args": {
        "ladder": {
          "k": "list",
          "of": {
            "t": "ref",
            "kind": "exercise",
            "logging": [
              "bodyweight_reps",
              "weight_reps"
            ]
          },
          "items": [
            {
              "k": "lit",
              "lit": {
                "k": "ref",
                "kind": "exercise",
                "id": "wger:ball-push-up"
              }
            },
            {
              "k": "lit",
              "lit": {
                "k": "ref",
                "kind": "exercise",
                "id": "wger:sa-ball-db-press"
              }
            },
            {
              "k": "lit",
              "lit": {
                "k": "ref",
                "kind": "exercise",
                "id": "wger:sl-cable-press"
              }
            }
          ]
        },
        "start": {
          "k": "param",
          "name": "rung"
        },
        "top": {
          "k": "lit",
          "lit": {
            "k": "q",
            "v": 2,
            "unit": "x"
          }
        },
        "need": {
          "k": "lit",
          "lit": {
            "k": "q",
            "v": 2,
            "unit": "x"
          }
        },
        "sets": {
          "k": "lit",
          "lit": {
            "k": "q",
            "v": 2,
            "unit": "set"
          }
        },
        "lo": {
          "k": "lit",
          "lit": {
            "k": "q",
            "v": 12,
            "unit": "rep"
          }
        },
        "hi": {
          "k": "lit",
          "lit": {
            "k": "q",
            "v": 20,
            "unit": "rep"
          }
        }
      },
      "meta": {
        "muscles": {
          "chest": 1
        }
      }
    }
  },
  "days": {
    "A": [
      {
        "k": "superset",
        "slots": [
          "bench",
          "pushStab"
        ],
        "between": {
          "k": "lit",
          "lit": {
            "k": "q",
            "v": 0,
            "unit": "s"
          }
        },
        "after": {
          "k": "lit",
          "lit": {
            "k": "q",
            "v": 60,
            "unit": "s"
          }
        }
      }
    ]
  },
  "rotation": {
    "k": "weekly",
    "days": [
      "A",
      "A",
      "A"
    ]
  },
  "frequency": [],
  "lapseAfterDays": 21,
  "hitPolicy": "allInOrder",
  "policies": [],
  "aggregate": null,
  "exports": {},
  "imports": {}
} as unknown as ProgramDef

export const OPT_LOADED_V1 = {
  "kind": "program",
  "ref": {
    "id": "prog/opt-loaded",
    "version": 1
  },
  "says": "OPT loaded phase: one main lift per session, character set by the phase",
  "params": {
    "benchStart": {
      "t": "opt",
      "of": {
        "t": "q",
        "dim": {
          "mass": 1
        }
      }
    }
  },
  "facts": [],
  "enums": {},
  "calendar": {
    "weeks": [
      "train",
      "train",
      "train",
      "train"
    ],
    "repeat": "once",
    "drift": "slide"
  },
  "grids": {
    "load": {
      "k": "lit",
      "lit": {
        "k": "q",
        "v": 2.5,
        "unit": "kg"
      }
    }
  },
  "muscles": [
    "chest"
  ],
  "slots": {
    "bench": {
      "scheme": {
        "id": "lib/double-progression",
        "version": 1
      },
      "args": {
        "lift": {
          "k": "lit",
          "lit": {
            "k": "ref",
            "kind": "exercise",
            "id": "wger:192"
          }
        },
        "sets": {
          "k": "lit",
          "lit": {
            "k": "q",
            "v": 4,
            "unit": "set"
          }
        },
        "inc": {
          "k": "lit",
          "lit": {
            "k": "q",
            "v": 2.5,
            "unit": "kg"
          }
        },
        "start": {
          "k": "param",
          "name": "benchStart"
        }
      },
      "meta": {
        "muscles": {
          "chest": 1
        }
      }
    }
  },
  "days": {
    "A": [
      {
        "k": "single",
        "slot": "bench"
      }
    ]
  },
  "rotation": {
    "k": "weekly",
    "days": [
      "A",
      "A",
      "A"
    ]
  },
  "frequency": [],
  "lapseAfterDays": 21,
  "hitPolicy": "allInOrder",
  "policies": [],
  "aggregate": null,
  "exports": {},
  "imports": {}
} as unknown as ProgramDef

export const OPT_POWER_V1 = {
  "kind": "program",
  "ref": {
    "id": "prog/opt-power",
    "version": 1
  },
  "says": "OPT Phase 5: heavy strength set supersetted with an explosive partner",
  "params": {
    "benchStart": {
      "t": "opt",
      "of": {
        "t": "q",
        "dim": {
          "mass": 1
        }
      }
    }
  },
  "facts": [],
  "enums": {},
  "calendar": {
    "weeks": [
      "train",
      "train",
      "train",
      "train"
    ],
    "repeat": "once",
    "drift": "slide"
  },
  "grids": {
    "load": {
      "k": "lit",
      "lit": {
        "k": "q",
        "v": 2.5,
        "unit": "kg"
      }
    }
  },
  "muscles": [
    "chest",
    "shoulders"
  ],
  "slots": {
    "bench": {
      "scheme": {
        "id": "lib/double-progression",
        "version": 1
      },
      "args": {
        "lift": {
          "k": "lit",
          "lit": {
            "k": "ref",
            "kind": "exercise",
            "id": "wger:192"
          }
        },
        "sets": {
          "k": "lit",
          "lit": {
            "k": "q",
            "v": 4,
            "unit": "set"
          }
        },
        "inc": {
          "k": "lit",
          "lit": {
            "k": "q",
            "v": 2.5,
            "unit": "kg"
          }
        },
        "start": {
          "k": "param",
          "name": "benchStart"
        }
      },
      "meta": {
        "muscles": {
          "chest": 1
        }
      }
    },
    "pass": {
      "scheme": {
        "id": "lib/fixed-work",
        "version": 1
      },
      "args": {
        "lift": {
          "k": "lit",
          "lit": {
            "k": "ref",
            "kind": "exercise",
            "id": "wger:mb-chest-pass"
          }
        },
        "sets": {
          "k": "lit",
          "lit": {
            "k": "q",
            "v": 4,
            "unit": "set"
          }
        },
        "reps": {
          "k": "lit",
          "lit": {
            "k": "q",
            "v": 10,
            "unit": "rep"
          }
        }
      },
      "meta": {
        "muscles": {
          "chest": 1,
          "shoulders": 0.5
        }
      }
    }
  },
  "days": {
    "A": [
      {
        "k": "superset",
        "slots": [
          "bench",
          "pass"
        ],
        "between": {
          "k": "lit",
          "lit": {
            "k": "q",
            "v": 0,
            "unit": "s"
          }
        },
        "after": {
          "k": "lit",
          "lit": {
            "k": "q",
            "v": 120,
            "unit": "s"
          }
        }
      }
    ]
  },
  "rotation": {
    "k": "weekly",
    "days": [
      "A",
      "A"
    ]
  },
  "frequency": [],
  "lapseAfterDays": 21,
  "hitPolicy": "allInOrder",
  "policies": [],
  "aggregate": null,
  "exports": {},
  "imports": {}
} as unknown as ProgramDef

export const LEGS_3X_V1 = {
  "kind": "program",
  "ref": {
    "id": "prog/legs-3x",
    "version": 1
  },
  "says": "A three-day split that trains a leg muscle every session, with attendance counted for legs and for workouts",
  "params": {},
  "facts": [],
  "enums": {},
  "calendar": {
    "weeks": [
      "train"
    ],
    "repeat": "cycle",
    "drift": "slide"
  },
  "grids": {
    "load": {
      "k": "lit",
      "lit": {
        "k": "q",
        "v": 2.5,
        "unit": "kg"
      }
    }
  },
  "muscles": [
    "quads",
    "hamstrings",
    "glutes",
    "chest",
    "back"
  ],
  "slots": {
    "squat": {
      "scheme": {
        "id": "lib/linear-gated",
        "version": 1
      },
      "args": {
        "lift": {
          "k": "lit",
          "lit": {
            "k": "ref",
            "kind": "exercise",
            "id": "wger:111"
          }
        },
        "sets": {
          "k": "lit",
          "lit": {
            "k": "q",
            "v": 3,
            "unit": "set"
          }
        },
        "reps": {
          "k": "lit",
          "lit": {
            "k": "q",
            "v": 5,
            "unit": "rep"
          }
        },
        "inc": {
          "k": "lit",
          "lit": {
            "k": "q",
            "v": 2.5,
            "unit": "kg"
          }
        },
        "backoff": {
          "k": "lit",
          "lit": {
            "k": "q",
            "v": 0.9,
            "unit": "pct"
          }
        },
        "stalls": {
          "k": "lit",
          "lit": {
            "k": "q",
            "v": 3,
            "unit": "x"
          }
        }
      },
      "meta": {
        "muscles": {
          "quads": 1
        }
      }
    },
    "rdl": {
      "scheme": {
        "id": "lib/double-progression",
        "version": 1
      },
      "args": {
        "lift": {
          "k": "lit",
          "lit": {
            "k": "ref",
            "kind": "exercise",
            "id": "wger:507"
          }
        },
        "sets": {
          "k": "lit",
          "lit": {
            "k": "q",
            "v": 3,
            "unit": "set"
          }
        },
        "inc": {
          "k": "lit",
          "lit": {
            "k": "q",
            "v": 2.5,
            "unit": "kg"
          }
        },
        "start": {
          "k": "none",
          "of": {
            "t": "q",
            "dim": {
              "mass": 1
            }
          }
        }
      },
      "meta": {
        "muscles": {
          "hamstrings": 1,
          "glutes": 0.5
        }
      }
    },
    "thrust": {
      "scheme": {
        "id": "lib/double-progression",
        "version": 1
      },
      "args": {
        "lift": {
          "k": "lit",
          "lit": {
            "k": "ref",
            "kind": "exercise",
            "id": "wger:hip-thrust"
          }
        },
        "sets": {
          "k": "lit",
          "lit": {
            "k": "q",
            "v": 3,
            "unit": "set"
          }
        },
        "inc": {
          "k": "lit",
          "lit": {
            "k": "q",
            "v": 5,
            "unit": "kg"
          }
        },
        "start": {
          "k": "none",
          "of": {
            "t": "q",
            "dim": {
              "mass": 1
            }
          }
        }
      },
      "meta": {
        "muscles": {
          "glutes": 1,
          "hamstrings": 0.5
        }
      }
    },
    "bench": {
      "scheme": {
        "id": "lib/linear-gated",
        "version": 1
      },
      "args": {
        "lift": {
          "k": "lit",
          "lit": {
            "k": "ref",
            "kind": "exercise",
            "id": "wger:192"
          }
        },
        "sets": {
          "k": "lit",
          "lit": {
            "k": "q",
            "v": 3,
            "unit": "set"
          }
        },
        "reps": {
          "k": "lit",
          "lit": {
            "k": "q",
            "v": 5,
            "unit": "rep"
          }
        },
        "inc": {
          "k": "lit",
          "lit": {
            "k": "q",
            "v": 1.25,
            "unit": "kg"
          }
        },
        "backoff": {
          "k": "lit",
          "lit": {
            "k": "q",
            "v": 0.9,
            "unit": "pct"
          }
        },
        "stalls": {
          "k": "lit",
          "lit": {
            "k": "q",
            "v": 3,
            "unit": "x"
          }
        }
      },
      "meta": {
        "muscles": {
          "chest": 1
        }
      }
    },
    "row": {
      "scheme": {
        "id": "lib/double-progression",
        "version": 1
      },
      "args": {
        "lift": {
          "k": "lit",
          "lit": {
            "k": "ref",
            "kind": "exercise",
            "id": "wger:212"
          }
        },
        "sets": {
          "k": "lit",
          "lit": {
            "k": "q",
            "v": 3,
            "unit": "set"
          }
        },
        "inc": {
          "k": "lit",
          "lit": {
            "k": "q",
            "v": 2.5,
            "unit": "kg"
          }
        },
        "start": {
          "k": "none",
          "of": {
            "t": "q",
            "dim": {
              "mass": 1
            }
          }
        }
      },
      "meta": {
        "muscles": {
          "back": 1
        }
      }
    }
  },
  "days": {
    "A": [
      {
        "k": "single",
        "slot": "squat"
      },
      {
        "k": "single",
        "slot": "bench"
      }
    ],
    "B": [
      {
        "k": "single",
        "slot": "rdl"
      },
      {
        "k": "single",
        "slot": "row"
      }
    ],
    "C": [
      {
        "k": "single",
        "slot": "thrust"
      },
      {
        "k": "single",
        "slot": "bench"
      }
    ]
  },
  "rotation": {
    "k": "weekly",
    "days": [
      "A",
      "B",
      "C"
    ]
  },
  "frequency": [
    {
      "k": "atLeast",
      "n": 3,
      "of": {
        "s": "muscle",
        "muscles": [
          "quads",
          "hamstrings",
          "glutes"
        ]
      },
      "per": {
        "k": "week"
      }
    },
    {
      "k": "atLeast",
      "n": 3,
      "of": {
        "s": "any"
      },
      "per": {
        "k": "week"
      }
    }
  ],
  "lapseAfterDays": 21,
  "hitPolicy": "allInOrder",
  "policies": [],
  "aggregate": null,
  "exports": {},
  "imports": {}
} as unknown as ProgramDef

export const HR_TEMPO_BLOCK_V1 = {
  "kind": "program",
  "ref": {
    "id": "prog/hr-tempo-block",
    "version": 1
  },
  "says": "A threshold block: one tempo run, two easy runs and a long run each week, hard runs at least two days apart",
  "params": {},
  "facts": [],
  "enums": {},
  "calendar": {
    "weeks": [
      "train",
      "train",
      "train",
      "deload"
    ],
    "repeat": "cycle",
    "drift": "slide"
  },
  "grids": {},
  "muscles": [
    "legs"
  ],
  "slots": {
    "tempo": {
      "scheme": {
        "id": "lib/hr-tempo",
        "version": 1
      },
      "args": {
        "run": {
          "k": "lit",
          "lit": {
            "k": "ref",
            "kind": "exercise",
            "id": "road-run"
          }
        },
        "pace": {
          "k": "lit",
          "lit": {
            "k": "q",
            "v": 0.285,
            "unit": "minPerKm"
          }
        },
        "grow": {
          "k": "lit",
          "lit": {
            "k": "q",
            "v": 300,
            "unit": "min"
          }
        },
        "cap": {
          "k": "lit",
          "lit": {
            "k": "q",
            "v": 2400,
            "unit": "min"
          }
        }
      },
      "meta": {
        "muscles": {
          "legs": 1
        },
        "tags": [
          "hard"
        ]
      }
    },
    "easy": {
      "scheme": {
        "id": "lib/easy-run",
        "version": 1
      },
      "args": {
        "run": {
          "k": "lit",
          "lit": {
            "k": "ref",
            "kind": "exercise",
            "id": "road-run"
          }
        },
        "minutes": {
          "k": "lit",
          "lit": {
            "k": "q",
            "v": 2700,
            "unit": "min"
          }
        }
      },
      "meta": {
        "muscles": {
          "legs": 1
        }
      }
    },
    "long": {
      "scheme": {
        "id": "lib/easy-run",
        "version": 1
      },
      "args": {
        "run": {
          "k": "lit",
          "lit": {
            "k": "ref",
            "kind": "exercise",
            "id": "road-run"
          }
        },
        "minutes": {
          "k": "lit",
          "lit": {
            "k": "q",
            "v": 4800,
            "unit": "min"
          }
        }
      },
      "meta": {
        "muscles": {
          "legs": 1
        },
        "tags": [
          "hard"
        ]
      }
    }
  },
  "days": {
    "T": [
      {
        "k": "single",
        "slot": "tempo"
      }
    ],
    "E": [
      {
        "k": "single",
        "slot": "easy"
      }
    ],
    "L": [
      {
        "k": "single",
        "slot": "long"
      }
    ]
  },
  "rotation": {
    "k": "weekly",
    "days": [
      "T",
      "E",
      "E",
      "L"
    ]
  },
  "frequency": [
    {
      "k": "atLeast",
      "n": 4,
      "of": {
        "s": "any"
      },
      "per": {
        "k": "week"
      }
    },
    {
      "k": "minGap",
      "of": {
        "s": "tag",
        "tag": "hard"
      },
      "gap": {
        "k": "lit",
        "lit": {
          "k": "q",
          "v": 2,
          "unit": "d"
        }
      },
      "ceiling": 2
    }
  ],
  "lapseAfterDays": 21,
  "hitPolicy": "allInOrder",
  "policies": [],
  "aggregate": null,
  "exports": {},
  "imports": {}
} as unknown as ProgramDef

export const ACHILLES_LOADING_V1 = {
  "kind": "program",
  "ref": {
    "id": "prog/achilles-loading",
    "version": 1
  },
  "says": "Achilles loading: pain-monitored eccentric heel drops, twice a day",
  "params": {},
  "facts": [],
  "enums": {},
  "calendar": {
    "weeks": [
      "train"
    ],
    "repeat": "cycle",
    "drift": "slide"
  },
  "grids": {
    "load": {
      "k": "lit",
      "lit": {
        "k": "q",
        "v": 1,
        "unit": "kg"
      }
    }
  },
  "muscles": [
    "calves"
  ],
  "slots": {
    "drops": {
      "scheme": {
        "id": "lib/pain-gated-loading",
        "version": 1
      },
      "args": {
        "lift": {
          "k": "lit",
          "lit": {
            "k": "ref",
            "kind": "exercise",
            "id": "heel-drop"
          }
        },
        "inc": {
          "k": "lit",
          "lit": {
            "k": "q",
            "v": 2.5,
            "unit": "kg"
          }
        }
      },
      "meta": {
        "muscles": {
          "calves": 1
        }
      }
    }
  },
  "days": {
    "D": [
      {
        "k": "single",
        "slot": "drops"
      }
    ]
  },
  "rotation": {
    "k": "daily",
    "days": [
      "D"
    ],
    "perDay": 2
  },
  "frequency": [],
  "lapseAfterDays": 21,
  "hitPolicy": "allInOrder",
  "policies": [],
  "aggregate": null,
  "exports": {},
  "imports": {}
} as unknown as ProgramDef

export const OPT_MACRO_V1 = {
  "kind": "macro",
  "ref": {
    "id": "macro/opt-16wk",
    "version": 1
  },
  "says": "NASM OPT: stabilization until the ladders are climbed (4–6 weeks), then strength endurance, hypertrophy, maximal strength and power, each phase seeded from the last",
  "anchor": {
    "k": "startOn",
    "date": "2026-11-02"
  },
  "drift": "slide",
  "phases": [
    {
      "label": "Stabilization endurance",
      "program": {
        "id": "prog/opt-stabilization",
        "version": 1
      },
      "length": {
        "k": "bounded",
        "min": 4,
        "max": 6,
        "advanceWhen": {
          "k": "logic",
          "op": "and",
          "a": {
            "k": "cmp",
            "op": ">=",
            "a": {
              "k": "peer",
              "slot": "pushStab",
              "field": "rung",
              "of": "current"
            },
            "b": {
              "k": "lit",
              "lit": {
                "k": "q",
                "v": 2,
                "unit": "x"
              }
            }
          },
          "b": {
            "k": "cmp",
            "op": ">=",
            "a": {
              "k": "peer",
              "slot": "squatStab",
              "field": "rung",
              "of": "current"
            },
            "b": {
              "k": "lit",
              "lit": {
                "k": "q",
                "v": 2,
                "unit": "x"
              }
            }
          }
        },
        "atMax": "propose"
      },
      "args": {},
      "transform": null
    },
    {
      "label": "Strength endurance",
      "program": {
        "id": "prog/opt-strength-endurance",
        "version": 1
      },
      "length": {
        "k": "fixed"
      },
      "args": {
        "benchStart": {
          "k": "none",
          "of": {
            "t": "q",
            "dim": {
              "mass": 1
            }
          }
        },
        "rung": {
          "k": "peer",
          "slot": "pushStab",
          "field": "rung",
          "of": "prevPhase"
        }
      },
      "transform": {
        "def": {
          "id": "lib/with-tempo",
          "version": 1
        },
        "hole": "s",
        "args": {
          "t": {
            "k": "tempo",
            "ecc": 2,
            "pause": 0,
            "con": 2,
            "top": 0
          }
        }
      }
    },
    {
      "label": "Hypertrophy",
      "program": {
        "id": "prog/opt-loaded",
        "version": 1
      },
      "length": {
        "k": "fixed"
      },
      "args": {
        "benchStart": {
          "k": "peer",
          "slot": "bench",
          "field": "load",
          "of": "prevPhase"
        }
      },
      "transform": {
        "def": {
          "id": "lib/rep-shape",
          "version": 1
        },
        "hole": "s",
        "args": {
          "lo": {
            "k": "lit",
            "lit": {
              "k": "q",
              "v": 6,
              "unit": "rep"
            }
          },
          "hi": {
            "k": "lit",
            "lit": {
              "k": "q",
              "v": 12,
              "unit": "rep"
            }
          },
          "t": {
            "k": "tempo",
            "ecc": 2,
            "pause": 0,
            "con": 2,
            "top": 0
          }
        }
      }
    },
    {
      "label": "Maximal strength",
      "program": {
        "id": "prog/opt-loaded",
        "version": 1
      },
      "length": {
        "k": "fixed"
      },
      "args": {
        "benchStart": {
          "k": "known",
          "a": {
            "k": "peer",
            "slot": "bench",
            "field": "load",
            "of": "prevPhase"
          },
          "as": "v66",
          "body": {
            "k": "round",
            "mode": "nearest",
            "a": {
              "k": "arith",
              "op": "*",
              "a": {
                "k": "var",
                "name": "v66"
              },
              "b": {
                "k": "lit",
                "lit": {
                  "k": "q",
                  "v": 1.1500000000000001,
                  "unit": "pct"
                }
              }
            },
            "step": {
              "k": "lit",
              "lit": {
                "k": "q",
                "v": 2.5,
                "unit": "kg"
              }
            }
          },
          "then": false
        }
      },
      "transform": {
        "def": {
          "id": "lib/rep-shape",
          "version": 1
        },
        "hole": "s",
        "args": {
          "lo": {
            "k": "lit",
            "lit": {
              "k": "q",
              "v": 1,
              "unit": "rep"
            }
          },
          "hi": {
            "k": "lit",
            "lit": {
              "k": "q",
              "v": 5,
              "unit": "rep"
            }
          },
          "t": {
            "k": "tempo",
            "ecc": 1,
            "pause": 0,
            "con": 1,
            "top": 0
          }
        }
      }
    },
    {
      "label": "Power",
      "program": {
        "id": "prog/opt-power",
        "version": 1
      },
      "length": {
        "k": "open"
      },
      "args": {
        "benchStart": {
          "k": "peer",
          "slot": "bench",
          "field": "load",
          "of": "prevPhase"
        }
      },
      "transform": {
        "def": {
          "id": "lib/rep-shape",
          "version": 1
        },
        "hole": "s",
        "args": {
          "lo": {
            "k": "lit",
            "lit": {
              "k": "q",
              "v": 1,
              "unit": "rep"
            }
          },
          "hi": {
            "k": "lit",
            "lit": {
              "k": "q",
              "v": 5,
              "unit": "rep"
            }
          },
          "t": {
            "k": "tempo",
            "ecc": 1,
            "pause": 0,
            "con": 1,
            "top": 0
          }
        }
      }
    }
  ]
} as unknown as MacroDef

export const ACHILLES_RETURN_V1 = {
  "kind": "macro",
  "ref": {
    "id": "macro/achilles-return",
    "version": 1
  },
  "says": "Achilles return: isometrics until morning pain settles (no earlier than two weeks after the start), then pain-monitored loading",
  "anchor": {
    "k": "startOn",
    "date": "2026-09-14"
  },
  "drift": "slide",
  "phases": [
    {
      "label": "Pain modulation",
      "program": {
        "id": "prog/achilles-isometric",
        "version": 1
      },
      "length": {
        "k": "bounded",
        "min": 2,
        "max": 6,
        "advanceWhen": {
          "k": "logic",
          "op": "and",
          "a": {
            "k": "orElse",
            "a": {
              "k": "known",
              "a": {
                "k": "fact",
                "fact": "morningPain",
                "key": null
              },
              "as": "v7",
              "body": {
                "k": "cmp",
                "op": "<=",
                "a": {
                  "k": "var",
                  "name": "v7"
                },
                "b": {
                  "k": "lit",
                  "lit": {
                    "k": "ord",
                    "scale": "pain",
                    "level": 2
                  }
                }
              },
              "then": false
            },
            "b": {
              "k": "lit",
              "lit": {
                "k": "bool",
                "v": false
              }
            }
          },
          "b": {
            "k": "cmp",
            "op": ">=",
            "a": {
              "k": "cal",
              "q": {
                "q": "day"
              }
            },
            "b": {
              "k": "lit",
              "lit": {
                "k": "q",
                "v": 14,
                "unit": "d"
              }
            }
          }
        },
        "atMax": "propose"
      },
      "args": {},
      "transform": null
    },
    {
      "label": "Progressive loading",
      "program": {
        "id": "prog/achilles-loading",
        "version": 1
      },
      "length": {
        "k": "open"
      },
      "args": {},
      "transform": null
    }
  ]
} as unknown as MacroDef
