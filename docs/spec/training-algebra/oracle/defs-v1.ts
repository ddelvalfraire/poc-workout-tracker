/**
 * defs-v1.ts — the @1 bodies of the five definitions the configurability
 * round REDEFINED in place, restored byte-for-byte to their pre-round
 * (synthesis-patfix) content and republished beside the @2 versions that
 * carry the round's changes (Y3: a published version is immutable).
 *
 * GENERATED from arena2/synthesis-patfix by ../../gen-defs-v1.ts (the
 * scratchpad script); regenerate rather than edit. Stored as literal IR so
 * the restored bodies cannot drift with the embedding's binder numbering.
 */
import type { SchemeDef } from './structure'

export const GZCLP_T1_V1 = {
  "kind": "scheme",
  "ref": {
    "id": "lib/gzclp-t1",
    "version": 1
  },
  "says": "GZCLP T1 on {lift}: 5×3+, then 6×2+, then 10×1+ on failure, adding {inc} on success; after failing 10×1, test a 5RM and restart 5×3+ at {resetPct} of it; starts at {start} when a previous program hands one on",
  "params": {
    "lift": {
      "t": "ref",
      "kind": "exercise",
      "logging": [
        "weight_reps"
      ]
    },
    "inc": {
      "t": "q",
      "dim": {
        "mass": 1
      }
    },
    "resetPct": {
      "t": "q",
      "dim": {}
    },
    "start": {
      "t": "opt",
      "of": {
        "t": "q",
        "dim": {
          "mass": 1
        }
      }
    }
  },
  "facts": [
    "e1rm"
  ],
  "enums": {
    "gzT1": [
      "5x3",
      "6x2",
      "10x1",
      "retest"
    ]
  },
  "state": {
    "stage": {
      "ty": {
        "t": "enum",
        "name": "gzT1"
      },
      "init": {
        "k": "lit",
        "lit": {
          "k": "enum",
          "name": "gzT1",
          "tag": "5x3"
        }
      },
      "writableBy": [
        "session",
        "owner"
      ],
      "noun": "stage"
    },
    "load": {
      "ty": {
        "t": "opt",
        "of": {
          "t": "q",
          "dim": {
            "mass": 1
          }
        }
      },
      "init": {
        "k": "orElse",
        "a": {
          "k": "param",
          "name": "start"
        },
        "b": {
          "k": "known",
          "a": {
            "k": "fact",
            "fact": "e1rm",
            "key": {
              "k": "param",
              "name": "lift"
            }
          },
          "as": "v41",
          "body": {
            "k": "known",
            "a": {
              "k": "app",
              "def": {
                "id": "lib/load-for",
                "version": 1
              },
              "args": {
                "e1rm": {
                  "k": "var",
                  "name": "v41"
                },
                "reps": {
                  "k": "lit",
                  "lit": {
                    "k": "q",
                    "v": 5,
                    "unit": "rep"
                  }
                },
                "rir": {
                  "k": "lit",
                  "lit": {
                    "k": "q",
                    "v": 0,
                    "unit": "rir"
                  }
                }
              }
            },
            "as": "v42",
            "body": {
              "k": "arith",
              "op": "*",
              "a": {
                "k": "var",
                "name": "v42"
              },
              "b": {
                "k": "param",
                "name": "resetPct"
              }
            },
            "then": false
          },
          "then": true
        }
      },
      "writableBy": [
        "session",
        "owner"
      ],
      "noun": "working weight"
    }
  },
  "plan": {
    "k": "match",
    "on": {
      "k": "self",
      "field": "stage"
    },
    "cases": {
      "5x3": {
        "k": "session",
        "exercise": {
          "k": "param",
          "name": "lift"
        },
        "steps": [
          {
            "k": "step",
            "id": "work",
            "count": {
              "k": "n",
              "n": {
                "k": "lit",
                "lit": {
                  "k": "q",
                  "v": 4,
                  "unit": "set"
                }
              }
            },
            "target": {
              "k": "set",
              "role": "working",
              "target": {
                "reps": {
                  "b": "exact",
                  "v": {
                    "k": "lit",
                    "lit": {
                      "k": "q",
                      "v": 3,
                      "unit": "rep"
                    }
                  }
                },
                "load": {
                  "b": "exact",
                  "v": {
                    "k": "self",
                    "field": "load"
                  }
                }
              },
              "rest": null,
              "tempo": null,
              "cluster": null
            }
          },
          {
            "k": "step",
            "id": "last",
            "count": {
              "k": "n",
              "n": {
                "k": "lit",
                "lit": {
                  "k": "q",
                  "v": 1,
                  "unit": "set"
                }
              }
            },
            "target": {
              "k": "set",
              "role": "amrap",
              "target": {
                "reps": {
                  "b": "atLeast",
                  "v": {
                    "k": "lit",
                    "lit": {
                      "k": "q",
                      "v": 3,
                      "unit": "rep"
                    }
                  }
                },
                "load": {
                  "b": "exact",
                  "v": {
                    "k": "self",
                    "field": "load"
                  }
                }
              },
              "rest": null,
              "tempo": null,
              "cluster": null
            }
          }
        ],
        "intensifier": null
      },
      "6x2": {
        "k": "session",
        "exercise": {
          "k": "param",
          "name": "lift"
        },
        "steps": [
          {
            "k": "step",
            "id": "work",
            "count": {
              "k": "n",
              "n": {
                "k": "lit",
                "lit": {
                  "k": "q",
                  "v": 5,
                  "unit": "set"
                }
              }
            },
            "target": {
              "k": "set",
              "role": "working",
              "target": {
                "reps": {
                  "b": "exact",
                  "v": {
                    "k": "lit",
                    "lit": {
                      "k": "q",
                      "v": 2,
                      "unit": "rep"
                    }
                  }
                },
                "load": {
                  "b": "exact",
                  "v": {
                    "k": "self",
                    "field": "load"
                  }
                }
              },
              "rest": null,
              "tempo": null,
              "cluster": null
            }
          },
          {
            "k": "step",
            "id": "last",
            "count": {
              "k": "n",
              "n": {
                "k": "lit",
                "lit": {
                  "k": "q",
                  "v": 1,
                  "unit": "set"
                }
              }
            },
            "target": {
              "k": "set",
              "role": "amrap",
              "target": {
                "reps": {
                  "b": "atLeast",
                  "v": {
                    "k": "lit",
                    "lit": {
                      "k": "q",
                      "v": 2,
                      "unit": "rep"
                    }
                  }
                },
                "load": {
                  "b": "exact",
                  "v": {
                    "k": "self",
                    "field": "load"
                  }
                }
              },
              "rest": null,
              "tempo": null,
              "cluster": null
            }
          }
        ],
        "intensifier": null
      },
      "10x1": {
        "k": "session",
        "exercise": {
          "k": "param",
          "name": "lift"
        },
        "steps": [
          {
            "k": "step",
            "id": "work",
            "count": {
              "k": "n",
              "n": {
                "k": "lit",
                "lit": {
                  "k": "q",
                  "v": 9,
                  "unit": "set"
                }
              }
            },
            "target": {
              "k": "set",
              "role": "working",
              "target": {
                "reps": {
                  "b": "exact",
                  "v": {
                    "k": "lit",
                    "lit": {
                      "k": "q",
                      "v": 1,
                      "unit": "rep"
                    }
                  }
                },
                "load": {
                  "b": "exact",
                  "v": {
                    "k": "self",
                    "field": "load"
                  }
                }
              },
              "rest": null,
              "tempo": null,
              "cluster": null
            }
          },
          {
            "k": "step",
            "id": "last",
            "count": {
              "k": "n",
              "n": {
                "k": "lit",
                "lit": {
                  "k": "q",
                  "v": 1,
                  "unit": "set"
                }
              }
            },
            "target": {
              "k": "set",
              "role": "amrap",
              "target": {
                "reps": {
                  "b": "atLeast",
                  "v": {
                    "k": "lit",
                    "lit": {
                      "k": "q",
                      "v": 1,
                      "unit": "rep"
                    }
                  }
                },
                "load": {
                  "b": "exact",
                  "v": {
                    "k": "self",
                    "field": "load"
                  }
                }
              },
              "rest": null,
              "tempo": null,
              "cluster": null
            }
          }
        ],
        "intensifier": null
      },
      "retest": {
        "k": "session",
        "exercise": {
          "k": "param",
          "name": "lift"
        },
        "steps": [
          {
            "k": "step",
            "id": "test",
            "count": {
              "k": "n",
              "n": {
                "k": "lit",
                "lit": {
                  "k": "q",
                  "v": 1,
                  "unit": "set"
                }
              }
            },
            "target": {
              "k": "set",
              "role": "test",
              "target": {
                "reps": {
                  "b": "exact",
                  "v": {
                    "k": "lit",
                    "lit": {
                      "k": "q",
                      "v": 5,
                      "unit": "rep"
                    }
                  }
                },
                "effort": {
                  "b": "exact",
                  "v": {
                    "k": "lit",
                    "lit": {
                      "k": "q",
                      "v": 0,
                      "unit": "rir"
                    }
                  }
                }
              },
              "rest": null,
              "tempo": null,
              "cluster": null
            }
          }
        ],
        "intensifier": null
      }
    }
  },
  "on": {
    "session": {
      "k": "match",
      "on": {
        "k": "self",
        "field": "stage"
      },
      "cases": {
        "5x3": {
          "k": "match",
          "on": {
            "k": "event",
            "q": {
              "q": "verdict",
              "steps": "working",
              "bound": "floor"
            }
          },
          "cases": {
            "hit": {
              "k": "patch",
              "set": {
                "load": {
                  "to": {
                    "k": "known",
                    "a": {
                      "k": "self",
                      "field": "load"
                    },
                    "as": "v43",
                    "body": {
                      "k": "arith",
                      "op": "+",
                      "a": {
                        "k": "var",
                        "name": "v43"
                      },
                      "b": {
                        "k": "param",
                        "name": "inc"
                      }
                    },
                    "then": false
                  },
                  "mode": "commit"
                }
              }
            },
            "missed": {
              "k": "patch",
              "set": {
                "stage": {
                  "to": {
                    "k": "lit",
                    "lit": {
                      "k": "enum",
                      "name": "gzT1",
                      "tag": "6x2"
                    }
                  },
                  "mode": "commit"
                }
              }
            },
            "unknown": {
              "k": "patch",
              "set": {}
            }
          }
        },
        "6x2": {
          "k": "match",
          "on": {
            "k": "event",
            "q": {
              "q": "verdict",
              "steps": "working",
              "bound": "floor"
            }
          },
          "cases": {
            "hit": {
              "k": "patch",
              "set": {
                "load": {
                  "to": {
                    "k": "known",
                    "a": {
                      "k": "self",
                      "field": "load"
                    },
                    "as": "v44",
                    "body": {
                      "k": "arith",
                      "op": "+",
                      "a": {
                        "k": "var",
                        "name": "v44"
                      },
                      "b": {
                        "k": "param",
                        "name": "inc"
                      }
                    },
                    "then": false
                  },
                  "mode": "commit"
                }
              }
            },
            "missed": {
              "k": "patch",
              "set": {
                "stage": {
                  "to": {
                    "k": "lit",
                    "lit": {
                      "k": "enum",
                      "name": "gzT1",
                      "tag": "10x1"
                    }
                  },
                  "mode": "commit"
                }
              }
            },
            "unknown": {
              "k": "patch",
              "set": {}
            }
          }
        },
        "10x1": {
          "k": "match",
          "on": {
            "k": "event",
            "q": {
              "q": "verdict",
              "steps": "working",
              "bound": "floor"
            }
          },
          "cases": {
            "hit": {
              "k": "patch",
              "set": {
                "load": {
                  "to": {
                    "k": "known",
                    "a": {
                      "k": "self",
                      "field": "load"
                    },
                    "as": "v45",
                    "body": {
                      "k": "arith",
                      "op": "+",
                      "a": {
                        "k": "var",
                        "name": "v45"
                      },
                      "b": {
                        "k": "param",
                        "name": "inc"
                      }
                    },
                    "then": false
                  },
                  "mode": "commit"
                }
              }
            },
            "missed": {
              "k": "patch",
              "set": {
                "stage": {
                  "to": {
                    "k": "lit",
                    "lit": {
                      "k": "enum",
                      "name": "gzT1",
                      "tag": "retest"
                    }
                  },
                  "mode": "commit"
                }
              }
            },
            "unknown": {
              "k": "patch",
              "set": {}
            }
          }
        },
        "retest": {
          "k": "orElse",
          "a": {
            "k": "known",
            "a": {
              "k": "event",
              "q": {
                "q": "metric",
                "step": "test",
                "metric": "load",
                "pick": "best"
              }
            },
            "as": "v46",
            "body": {
              "k": "patch",
              "set": {
                "stage": {
                  "to": {
                    "k": "lit",
                    "lit": {
                      "k": "enum",
                      "name": "gzT1",
                      "tag": "5x3"
                    }
                  },
                  "mode": "commit"
                },
                "load": {
                  "to": {
                    "k": "some",
                    "a": {
                      "k": "arith",
                      "op": "*",
                      "a": {
                        "k": "var",
                        "name": "v46"
                      },
                      "b": {
                        "k": "param",
                        "name": "resetPct"
                      }
                    }
                  },
                  "mode": "commit"
                }
              }
            },
            "then": false
          },
          "b": {
            "k": "patch",
            "set": {}
          }
        }
      }
    }
  },
  "examples": []
} as unknown as SchemeDef

export const DOUBLE_PROGRESSION_V1 = {
  "kind": "scheme",
  "ref": {
    "id": "lib/double-progression",
    "version": 1
  },
  "says": "{sets} of {lift} in the phase rep range, starting at {start}; add {inc} once every set reaches the top of the range",
  "params": {
    "lift": {
      "t": "ref",
      "kind": "exercise",
      "logging": [
        "weight_reps"
      ]
    },
    "sets": {
      "t": "q",
      "dim": {
        "set": 1
      }
    },
    "inc": {
      "t": "q",
      "dim": {
        "mass": 1
      }
    },
    "start": {
      "t": "opt",
      "of": {
        "t": "q",
        "dim": {
          "mass": 1
        }
      }
    }
  },
  "facts": [
    "e1rm"
  ],
  "enums": {},
  "state": {
    "load": {
      "ty": {
        "t": "opt",
        "of": {
          "t": "q",
          "dim": {
            "mass": 1
          }
        }
      },
      "init": {
        "k": "orElse",
        "a": {
          "k": "param",
          "name": "start"
        },
        "b": {
          "k": "known",
          "a": {
            "k": "fact",
            "fact": "e1rm",
            "key": {
              "k": "param",
              "name": "lift"
            }
          },
          "as": "v64",
          "body": {
            "k": "app",
            "def": {
              "id": "lib/load-for",
              "version": 1
            },
            "args": {
              "e1rm": {
                "k": "var",
                "name": "v64"
              },
              "reps": {
                "k": "lit",
                "lit": {
                  "k": "q",
                  "v": 12,
                  "unit": "rep"
                }
              },
              "rir": {
                "k": "lit",
                "lit": {
                  "k": "q",
                  "v": 2,
                  "unit": "rir"
                }
              }
            }
          },
          "then": true
        }
      },
      "writableBy": [
        "session",
        "owner"
      ],
      "noun": "working weight"
    }
  },
  "plan": {
    "k": "session",
    "exercise": {
      "k": "param",
      "name": "lift"
    },
    "steps": [
      {
        "k": "step",
        "id": "work",
        "count": {
          "k": "n",
          "n": {
            "k": "param",
            "name": "sets"
          }
        },
        "target": {
          "k": "set",
          "role": "working",
          "target": {
            "reps": {
              "b": "range",
              "min": {
                "k": "lit",
                "lit": {
                  "k": "q",
                  "v": 8,
                  "unit": "rep"
                }
              },
              "max": {
                "k": "lit",
                "lit": {
                  "k": "q",
                  "v": 12,
                  "unit": "rep"
                }
              }
            },
            "load": {
              "b": "exact",
              "v": {
                "k": "self",
                "field": "load"
              }
            }
          },
          "rest": null,
          "tempo": null,
          "cluster": null
        }
      }
    ],
    "intensifier": null
  },
  "on": {
    "session": {
      "k": "patch",
      "set": {
        "load": {
          "to": {
            "k": "orElse",
            "a": {
              "k": "known",
              "a": {
                "k": "self",
                "field": "load"
              },
              "as": "v65",
              "body": {
                "k": "match",
                "on": {
                  "k": "event",
                  "q": {
                    "q": "verdict",
                    "steps": "working",
                    "bound": "top"
                  }
                },
                "cases": {
                  "hit": {
                    "k": "arith",
                    "op": "+",
                    "a": {
                      "k": "var",
                      "name": "v65"
                    },
                    "b": {
                      "k": "param",
                      "name": "inc"
                    }
                  },
                  "missed": {
                    "k": "var",
                    "name": "v65"
                  },
                  "unknown": {
                    "k": "var",
                    "name": "v65"
                  }
                }
              },
              "then": false
            },
            "b": {
              "k": "event",
              "q": {
                "q": "metric",
                "step": "work",
                "metric": "load",
                "pick": "best"
              }
            }
          },
          "mode": "commit"
        }
      }
    }
  },
  "examples": []
} as unknown as SchemeDef

export const W531_JOKERS_V1 = {
  "kind": "scheme",
  "ref": {
    "id": "lib/531-jokers",
    "version": 1
  },
  "says": "5/3/1 on {lift} off {tm}, with up to three jokers when the top set makes its reps, then 3–5 sets of 5 at the first-set weight",
  "params": {
    "lift": {
      "t": "ref",
      "kind": "exercise",
      "logging": [
        "weight_reps"
      ]
    },
    "tm": {
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
  "state": {},
  "plan": {
    "k": "session",
    "exercise": {
      "k": "param",
      "name": "lift"
    },
    "steps": [
      {
        "k": "step",
        "id": "s1",
        "count": {
          "k": "n",
          "n": {
            "k": "lit",
            "lit": {
              "k": "q",
              "v": 1,
              "unit": "set"
            }
          }
        },
        "target": {
          "k": "set",
          "role": "working",
          "target": {
            "reps": {
              "b": "exact",
              "v": {
                "k": "table",
                "key": {
                  "k": "pos",
                  "field": "trainWeek"
                },
                "rows": [
                  {
                    "when": null,
                    "then": {
                      "k": "lit",
                      "lit": {
                        "k": "q",
                        "v": 5,
                        "unit": "rep"
                      }
                    }
                  },
                  {
                    "when": null,
                    "then": {
                      "k": "lit",
                      "lit": {
                        "k": "q",
                        "v": 3,
                        "unit": "rep"
                      }
                    }
                  },
                  {
                    "when": null,
                    "then": {
                      "k": "lit",
                      "lit": {
                        "k": "q",
                        "v": 5,
                        "unit": "rep"
                      }
                    }
                  }
                ],
                "otherwise": null,
                "overflow": "cycle"
              }
            },
            "load": {
              "b": "exact",
              "v": {
                "k": "known",
                "a": {
                  "k": "param",
                  "name": "tm"
                },
                "as": "v33",
                "body": {
                  "k": "arith",
                  "op": "*",
                  "a": {
                    "k": "var",
                    "name": "v33"
                  },
                  "b": {
                    "k": "table",
                    "key": {
                      "k": "pos",
                      "field": "trainWeek"
                    },
                    "rows": [
                      {
                        "when": null,
                        "then": {
                          "k": "lit",
                          "lit": {
                            "k": "q",
                            "v": 0.65,
                            "unit": "pct"
                          }
                        }
                      },
                      {
                        "when": null,
                        "then": {
                          "k": "lit",
                          "lit": {
                            "k": "q",
                            "v": 0.7000000000000001,
                            "unit": "pct"
                          }
                        }
                      },
                      {
                        "when": null,
                        "then": {
                          "k": "lit",
                          "lit": {
                            "k": "q",
                            "v": 0.75,
                            "unit": "pct"
                          }
                        }
                      }
                    ],
                    "otherwise": null,
                    "overflow": "cycle"
                  }
                },
                "then": false
              }
            }
          },
          "rest": null,
          "tempo": null,
          "cluster": null
        }
      },
      {
        "k": "step",
        "id": "s2",
        "count": {
          "k": "n",
          "n": {
            "k": "lit",
            "lit": {
              "k": "q",
              "v": 1,
              "unit": "set"
            }
          }
        },
        "target": {
          "k": "set",
          "role": "working",
          "target": {
            "reps": {
              "b": "exact",
              "v": {
                "k": "table",
                "key": {
                  "k": "pos",
                  "field": "trainWeek"
                },
                "rows": [
                  {
                    "when": null,
                    "then": {
                      "k": "lit",
                      "lit": {
                        "k": "q",
                        "v": 5,
                        "unit": "rep"
                      }
                    }
                  },
                  {
                    "when": null,
                    "then": {
                      "k": "lit",
                      "lit": {
                        "k": "q",
                        "v": 3,
                        "unit": "rep"
                      }
                    }
                  },
                  {
                    "when": null,
                    "then": {
                      "k": "lit",
                      "lit": {
                        "k": "q",
                        "v": 3,
                        "unit": "rep"
                      }
                    }
                  }
                ],
                "otherwise": null,
                "overflow": "cycle"
              }
            },
            "load": {
              "b": "exact",
              "v": {
                "k": "known",
                "a": {
                  "k": "param",
                  "name": "tm"
                },
                "as": "v34",
                "body": {
                  "k": "arith",
                  "op": "*",
                  "a": {
                    "k": "var",
                    "name": "v34"
                  },
                  "b": {
                    "k": "table",
                    "key": {
                      "k": "pos",
                      "field": "trainWeek"
                    },
                    "rows": [
                      {
                        "when": null,
                        "then": {
                          "k": "lit",
                          "lit": {
                            "k": "q",
                            "v": 0.75,
                            "unit": "pct"
                          }
                        }
                      },
                      {
                        "when": null,
                        "then": {
                          "k": "lit",
                          "lit": {
                            "k": "q",
                            "v": 0.8,
                            "unit": "pct"
                          }
                        }
                      },
                      {
                        "when": null,
                        "then": {
                          "k": "lit",
                          "lit": {
                            "k": "q",
                            "v": 0.85,
                            "unit": "pct"
                          }
                        }
                      }
                    ],
                    "otherwise": null,
                    "overflow": "cycle"
                  }
                },
                "then": false
              }
            }
          },
          "rest": null,
          "tempo": null,
          "cluster": null
        }
      },
      {
        "k": "step",
        "id": "s3",
        "count": {
          "k": "n",
          "n": {
            "k": "lit",
            "lit": {
              "k": "q",
              "v": 1,
              "unit": "set"
            }
          }
        },
        "target": {
          "k": "set",
          "role": "amrap",
          "target": {
            "reps": {
              "b": "atLeast",
              "v": {
                "k": "table",
                "key": {
                  "k": "pos",
                  "field": "trainWeek"
                },
                "rows": [
                  {
                    "when": null,
                    "then": {
                      "k": "lit",
                      "lit": {
                        "k": "q",
                        "v": 5,
                        "unit": "rep"
                      }
                    }
                  },
                  {
                    "when": null,
                    "then": {
                      "k": "lit",
                      "lit": {
                        "k": "q",
                        "v": 3,
                        "unit": "rep"
                      }
                    }
                  },
                  {
                    "when": null,
                    "then": {
                      "k": "lit",
                      "lit": {
                        "k": "q",
                        "v": 1,
                        "unit": "rep"
                      }
                    }
                  }
                ],
                "otherwise": null,
                "overflow": "cycle"
              }
            },
            "load": {
              "b": "exact",
              "v": {
                "k": "known",
                "a": {
                  "k": "param",
                  "name": "tm"
                },
                "as": "v35",
                "body": {
                  "k": "arith",
                  "op": "*",
                  "a": {
                    "k": "var",
                    "name": "v35"
                  },
                  "b": {
                    "k": "table",
                    "key": {
                      "k": "pos",
                      "field": "trainWeek"
                    },
                    "rows": [
                      {
                        "when": null,
                        "then": {
                          "k": "lit",
                          "lit": {
                            "k": "q",
                            "v": 0.85,
                            "unit": "pct"
                          }
                        }
                      },
                      {
                        "when": null,
                        "then": {
                          "k": "lit",
                          "lit": {
                            "k": "q",
                            "v": 0.9,
                            "unit": "pct"
                          }
                        }
                      },
                      {
                        "when": null,
                        "then": {
                          "k": "lit",
                          "lit": {
                            "k": "q",
                            "v": 0.9500000000000001,
                            "unit": "pct"
                          }
                        }
                      }
                    ],
                    "otherwise": null,
                    "overflow": "cycle"
                  }
                },
                "then": false
              }
            }
          },
          "rest": null,
          "tempo": null,
          "cluster": null
        }
      },
      {
        "k": "step",
        "id": "joker",
        "count": {
          "k": "while",
          "go": {
            "k": "orElse",
            "a": {
              "k": "known",
              "a": {
                "k": "performed",
                "step": "s3",
                "metric": "reps",
                "pick": "last"
              },
              "as": "v36",
              "body": {
                "k": "known",
                "a": {
                  "k": "prescribed",
                  "step": "s3",
                  "metric": "reps",
                  "edge": "floor"
                },
                "as": "v37",
                "body": {
                  "k": "cmp",
                  "op": ">=",
                  "a": {
                    "k": "var",
                    "name": "v36"
                  },
                  "b": {
                    "k": "var",
                    "name": "v37"
                  }
                },
                "then": false
              },
              "then": true
            },
            "b": {
              "k": "lit",
              "lit": {
                "k": "bool",
                "v": false
              }
            }
          },
          "max": 3
        },
        "target": {
          "k": "set",
          "role": "working",
          "target": {
            "reps": {
              "b": "exact",
              "v": {
                "k": "lit",
                "lit": {
                  "k": "q",
                  "v": 1,
                  "unit": "rep"
                }
              }
            },
            "load": {
              "b": "exact",
              "v": {
                "k": "orElse",
                "a": {
                  "k": "known",
                  "a": {
                    "k": "performed",
                    "step": "joker",
                    "metric": "load",
                    "pick": "last"
                  },
                  "as": "v38",
                  "body": {
                    "k": "arith",
                    "op": "*",
                    "a": {
                      "k": "var",
                      "name": "v38"
                    },
                    "b": {
                      "k": "lit",
                      "lit": {
                        "k": "q",
                        "v": 1.05,
                        "unit": "pct"
                      }
                    }
                  },
                  "then": false
                },
                "b": {
                  "k": "known",
                  "a": {
                    "k": "performed",
                    "step": "s3",
                    "metric": "load",
                    "pick": "last"
                  },
                  "as": "v39",
                  "body": {
                    "k": "arith",
                    "op": "*",
                    "a": {
                      "k": "var",
                      "name": "v39"
                    },
                    "b": {
                      "k": "lit",
                      "lit": {
                        "k": "q",
                        "v": 1.05,
                        "unit": "pct"
                      }
                    }
                  },
                  "then": false
                }
              }
            }
          },
          "rest": null,
          "tempo": null,
          "cluster": null
        }
      },
      {
        "k": "step",
        "id": "fsl",
        "count": {
          "k": "range",
          "min": {
            "k": "lit",
            "lit": {
              "k": "q",
              "v": 3,
              "unit": "set"
            }
          },
          "max": {
            "k": "lit",
            "lit": {
              "k": "q",
              "v": 5,
              "unit": "set"
            }
          }
        },
        "target": {
          "k": "set",
          "role": "backoff",
          "target": {
            "reps": {
              "b": "exact",
              "v": {
                "k": "lit",
                "lit": {
                  "k": "q",
                  "v": 5,
                  "unit": "rep"
                }
              }
            },
            "load": {
              "b": "exact",
              "v": {
                "k": "prescribed",
                "step": "s1",
                "metric": "load",
                "edge": "floor"
              }
            }
          },
          "rest": null,
          "tempo": null,
          "cluster": null
        }
      }
    ],
    "intensifier": null
  },
  "on": {},
  "examples": []
} as unknown as SchemeDef

export const HR_TEMPO_V1 = {
  "kind": "scheme",
  "ref": {
    "id": "lib/hr-tempo",
    "version": 1
  },
  "says": "A tempo run on {run}: easy warm-up, then a tempo block at no slower than {pace} with heart rate held at 85–89% of threshold, growing by {grow} each time you hold it without a very hard Borg rating, up to {cap}",
  "params": {
    "run": {
      "t": "ref",
      "kind": "exercise",
      "logging": [
        "cardio"
      ]
    },
    "pace": {
      "t": "q",
      "dim": {
        "time": 1,
        "length": -1
      }
    },
    "grow": {
      "t": "q",
      "dim": {
        "time": 1
      }
    },
    "cap": {
      "t": "q",
      "dim": {
        "time": 1
      }
    }
  },
  "facts": [
    "lthr",
    "avgHr",
    "borg"
  ],
  "enums": {},
  "state": {
    "block": {
      "ty": {
        "t": "q",
        "dim": {
          "time": 1
        }
      },
      "init": {
        "k": "lit",
        "lit": {
          "k": "q",
          "v": 1200,
          "unit": "min"
        }
      },
      "writableBy": [
        "session",
        "owner"
      ],
      "noun": "tempo block"
    }
  },
  "plan": {
    "k": "session",
    "exercise": {
      "k": "param",
      "name": "run"
    },
    "steps": [
      {
        "k": "step",
        "id": "warmup",
        "count": {
          "k": "n",
          "n": {
            "k": "lit",
            "lit": {
              "k": "q",
              "v": 1,
              "unit": "set"
            }
          }
        },
        "target": {
          "k": "set",
          "role": "warmup",
          "target": {
            "duration": {
              "b": "exact",
              "v": {
                "k": "lit",
                "lit": {
                  "k": "q",
                  "v": 900,
                  "unit": "min"
                }
              }
            },
            "hr": {
              "b": "atMost",
              "v": {
                "k": "known",
                "a": {
                  "k": "fact",
                  "fact": "lthr",
                  "key": null
                },
                "as": "v0",
                "body": {
                  "k": "arith",
                  "op": "*",
                  "a": {
                    "k": "var",
                    "name": "v0"
                  },
                  "b": {
                    "k": "lit",
                    "lit": {
                      "k": "q",
                      "v": 0.8,
                      "unit": "pct"
                    }
                  }
                },
                "then": false
              }
            }
          },
          "rest": null,
          "tempo": null,
          "cluster": null
        }
      },
      {
        "k": "step",
        "id": "tempo",
        "count": {
          "k": "n",
          "n": {
            "k": "lit",
            "lit": {
              "k": "q",
              "v": 1,
              "unit": "set"
            }
          }
        },
        "target": {
          "k": "set",
          "role": "working",
          "target": {
            "duration": {
              "b": "exact",
              "v": {
                "k": "self",
                "field": "block"
              }
            },
            "pace": {
              "b": "atMost",
              "v": {
                "k": "param",
                "name": "pace"
              }
            },
            "hr": {
              "b": "range",
              "min": {
                "k": "known",
                "a": {
                  "k": "fact",
                  "fact": "lthr",
                  "key": null
                },
                "as": "v1",
                "body": {
                  "k": "arith",
                  "op": "*",
                  "a": {
                    "k": "var",
                    "name": "v1"
                  },
                  "b": {
                    "k": "lit",
                    "lit": {
                      "k": "q",
                      "v": 0.85,
                      "unit": "pct"
                    }
                  }
                },
                "then": false
              },
              "max": {
                "k": "known",
                "a": {
                  "k": "fact",
                  "fact": "lthr",
                  "key": null
                },
                "as": "v2",
                "body": {
                  "k": "arith",
                  "op": "*",
                  "a": {
                    "k": "var",
                    "name": "v2"
                  },
                  "b": {
                    "k": "lit",
                    "lit": {
                      "k": "q",
                      "v": 0.89,
                      "unit": "pct"
                    }
                  }
                },
                "then": false
              }
            }
          },
          "rest": null,
          "tempo": null,
          "cluster": null
        }
      },
      {
        "k": "step",
        "id": "cooldown",
        "count": {
          "k": "n",
          "n": {
            "k": "lit",
            "lit": {
              "k": "q",
              "v": 1,
              "unit": "set"
            }
          }
        },
        "target": {
          "k": "set",
          "role": "recovery",
          "target": {
            "duration": {
              "b": "exact",
              "v": {
                "k": "lit",
                "lit": {
                  "k": "q",
                  "v": 600,
                  "unit": "min"
                }
              }
            }
          },
          "rest": null,
          "tempo": null,
          "cluster": null
        }
      }
    ],
    "intensifier": null
  },
  "on": {
    "session": {
      "k": "match",
      "on": {
        "k": "event",
        "q": {
          "q": "verdict",
          "steps": [
            "tempo"
          ],
          "bound": "floor"
        }
      },
      "cases": {
        "hit": {
          "k": "if",
          "c": {
            "k": "orElse",
            "a": {
              "k": "known",
              "a": {
                "k": "fact",
                "fact": "borg",
                "key": null
              },
              "as": "v3",
              "body": {
                "k": "cmp",
                "op": "<",
                "a": {
                  "k": "var",
                  "name": "v3"
                },
                "b": {
                  "k": "lit",
                  "lit": {
                    "k": "ord",
                    "scale": "borg",
                    "level": 17
                  }
                }
              },
              "then": false
            },
            "b": {
              "k": "lit",
              "lit": {
                "k": "bool",
                "v": true
              }
            }
          },
          "a": {
            "k": "patch",
            "set": {
              "block": {
                "to": {
                  "k": "arith",
                  "op": "min",
                  "a": {
                    "k": "arith",
                    "op": "+",
                    "a": {
                      "k": "self",
                      "field": "block"
                    },
                    "b": {
                      "k": "param",
                      "name": "grow"
                    }
                  },
                  "b": {
                    "k": "param",
                    "name": "cap"
                  }
                },
                "mode": "commit"
              }
            }
          },
          "b": {
            "k": "patch",
            "set": {}
          }
        },
        "missed": {
          "k": "patch",
          "set": {}
        },
        "unknown": {
          "k": "patch",
          "set": {}
        }
      }
    }
  },
  "examples": []
} as unknown as SchemeDef

export const PAIN_GATED_V1 = {
  "kind": "scheme",
  "ref": {
    "id": "lib/pain-gated-loading",
    "version": 1
  },
  "says": "3×15 straight-knee and 3×15 bent-knee {lift}s; add {inc} after a session done in full with pain at 2/10 or less; above 5/10, propose taking {inc} off; a bad morning cuts each exercise to two sets",
  "params": {
    "lift": {
      "t": "ref",
      "kind": "exercise",
      "logging": [
        "weighted_bodyweight"
      ]
    },
    "inc": {
      "t": "q",
      "dim": {
        "mass": 1
      }
    }
  },
  "facts": [
    "pain",
    "morningPain"
  ],
  "enums": {},
  "state": {
    "added": {
      "ty": {
        "t": "q",
        "dim": {
          "mass": 1
        }
      },
      "init": {
        "k": "lit",
        "lit": {
          "k": "q",
          "v": 0,
          "unit": "kg"
        }
      },
      "writableBy": [
        "session",
        "owner"
      ],
      "noun": "added load"
    },
    "flares": {
      "ty": {
        "t": "q",
        "dim": {}
      },
      "init": {
        "k": "lit",
        "lit": {
          "k": "q",
          "v": 0,
          "unit": "x"
        }
      },
      "writableBy": [
        "session"
      ],
      "noun": "flare-ups in a row"
    }
  },
  "plan": {
    "k": "if",
    "c": {
      "k": "orElse",
      "a": {
        "k": "known",
        "a": {
          "k": "fact",
          "fact": "morningPain",
          "key": null
        },
        "as": "v5",
        "body": {
          "k": "cmp",
          "op": ">",
          "a": {
            "k": "var",
            "name": "v5"
          },
          "b": {
            "k": "lit",
            "lit": {
              "k": "ord",
              "scale": "pain",
              "level": 4
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
    "a": {
      "k": "xform",
      "op": "scaleSets",
      "s": {
        "k": "session",
        "exercise": {
          "k": "param",
          "name": "lift"
        },
        "steps": [
          {
            "k": "step",
            "id": "straight",
            "count": {
              "k": "n",
              "n": {
                "k": "lit",
                "lit": {
                  "k": "q",
                  "v": 3,
                  "unit": "set"
                }
              }
            },
            "target": {
              "k": "set",
              "role": "working",
              "target": {
                "reps": {
                  "b": "exact",
                  "v": {
                    "k": "lit",
                    "lit": {
                      "k": "q",
                      "v": 15,
                      "unit": "rep"
                    }
                  }
                },
                "load": {
                  "b": "exact",
                  "v": {
                    "k": "self",
                    "field": "added"
                  }
                }
              },
              "rest": null,
              "tempo": {
                "k": "tempo",
                "ecc": 3,
                "pause": 0,
                "con": 1,
                "top": 0
              },
              "cluster": null
            }
          },
          {
            "k": "step",
            "id": "bent",
            "count": {
              "k": "n",
              "n": {
                "k": "lit",
                "lit": {
                  "k": "q",
                  "v": 3,
                  "unit": "set"
                }
              }
            },
            "target": {
              "k": "set",
              "role": "working",
              "target": {
                "reps": {
                  "b": "exact",
                  "v": {
                    "k": "lit",
                    "lit": {
                      "k": "q",
                      "v": 15,
                      "unit": "rep"
                    }
                  }
                },
                "load": {
                  "b": "exact",
                  "v": {
                    "k": "self",
                    "field": "added"
                  }
                }
              },
              "rest": null,
              "tempo": {
                "k": "tempo",
                "ecc": 3,
                "pause": 0,
                "con": 1,
                "top": 0
              },
              "cluster": null
            }
          }
        ],
        "intensifier": null
      },
      "arg": {
        "k": "lit",
        "lit": {
          "k": "q",
          "v": 0.67,
          "unit": "pct"
        }
      },
      "metric": null
    },
    "b": {
      "k": "session",
      "exercise": {
        "k": "param",
        "name": "lift"
      },
      "steps": [
        {
          "k": "step",
          "id": "straight",
          "count": {
            "k": "n",
            "n": {
              "k": "lit",
              "lit": {
                "k": "q",
                "v": 3,
                "unit": "set"
              }
            }
          },
          "target": {
            "k": "set",
            "role": "working",
            "target": {
              "reps": {
                "b": "exact",
                "v": {
                  "k": "lit",
                  "lit": {
                    "k": "q",
                    "v": 15,
                    "unit": "rep"
                  }
                }
              },
              "load": {
                "b": "exact",
                "v": {
                  "k": "self",
                  "field": "added"
                }
              }
            },
            "rest": null,
            "tempo": {
              "k": "tempo",
              "ecc": 3,
              "pause": 0,
              "con": 1,
              "top": 0
            },
            "cluster": null
          }
        },
        {
          "k": "step",
          "id": "bent",
          "count": {
            "k": "n",
            "n": {
              "k": "lit",
              "lit": {
                "k": "q",
                "v": 3,
                "unit": "set"
              }
            }
          },
          "target": {
            "k": "set",
            "role": "working",
            "target": {
              "reps": {
                "b": "exact",
                "v": {
                  "k": "lit",
                  "lit": {
                    "k": "q",
                    "v": 15,
                    "unit": "rep"
                  }
                }
              },
              "load": {
                "b": "exact",
                "v": {
                  "k": "self",
                  "field": "added"
                }
              }
            },
            "rest": null,
            "tempo": {
              "k": "tempo",
              "ecc": 3,
              "pause": 0,
              "con": 1,
              "top": 0
            },
            "cluster": null
          }
        }
      ],
      "intensifier": null
    }
  },
  "on": {
    "session": {
      "k": "orElse",
      "a": {
        "k": "known",
        "a": {
          "k": "fact",
          "fact": "pain",
          "key": null
        },
        "as": "v6",
        "body": {
          "k": "if",
          "c": {
            "k": "cmp",
            "op": ">",
            "a": {
              "k": "var",
              "name": "v6"
            },
            "b": {
              "k": "lit",
              "lit": {
                "k": "ord",
                "scale": "pain",
                "level": 5
              }
            }
          },
          "a": {
            "k": "patch",
            "set": {
              "added": {
                "to": {
                  "k": "arith",
                  "op": "max",
                  "a": {
                    "k": "lit",
                    "lit": {
                      "k": "q",
                      "v": 0,
                      "unit": "kg"
                    }
                  },
                  "b": {
                    "k": "arith",
                    "op": "-",
                    "a": {
                      "k": "self",
                      "field": "added"
                    },
                    "b": {
                      "k": "param",
                      "name": "inc"
                    }
                  }
                },
                "mode": "propose"
              },
              "flares": {
                "to": {
                  "k": "arith",
                  "op": "+",
                  "a": {
                    "k": "self",
                    "field": "flares"
                  },
                  "b": {
                    "k": "lit",
                    "lit": {
                      "k": "q",
                      "v": 1,
                      "unit": "x"
                    }
                  }
                },
                "mode": "propose"
              }
            }
          },
          "b": {
            "k": "match",
            "on": {
              "k": "event",
              "q": {
                "q": "verdict",
                "steps": "working",
                "bound": "floor"
              }
            },
            "cases": {
              "hit": {
                "k": "if",
                "c": {
                  "k": "cmp",
                  "op": "<=",
                  "a": {
                    "k": "var",
                    "name": "v6"
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
                "a": {
                  "k": "patch",
                  "set": {
                    "added": {
                      "to": {
                        "k": "arith",
                        "op": "+",
                        "a": {
                          "k": "self",
                          "field": "added"
                        },
                        "b": {
                          "k": "param",
                          "name": "inc"
                        }
                      },
                      "mode": "commit"
                    },
                    "flares": {
                      "to": {
                        "k": "lit",
                        "lit": {
                          "k": "q",
                          "v": 0,
                          "unit": "x"
                        }
                      },
                      "mode": "commit"
                    }
                  }
                },
                "b": {
                  "k": "patch",
                  "set": {
                    "flares": {
                      "to": {
                        "k": "lit",
                        "lit": {
                          "k": "q",
                          "v": 0,
                          "unit": "x"
                        }
                      },
                      "mode": "commit"
                    }
                  }
                }
              },
              "missed": {
                "k": "patch",
                "set": {
                  "flares": {
                    "to": {
                      "k": "lit",
                      "lit": {
                        "k": "q",
                        "v": 0,
                        "unit": "x"
                      }
                    },
                    "mode": "commit"
                  }
                }
              },
              "unknown": {
                "k": "patch",
                "set": {}
              }
            }
          }
        },
        "then": false
      },
      "b": {
        "k": "patch",
        "set": {}
      }
    }
  },
  "examples": []
} as unknown as SchemeDef
