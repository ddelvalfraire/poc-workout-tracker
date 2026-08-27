# Design of record

`mocks/` holds the artboards the programs redesign was built against — the
same files the canvas publishes, extracted here so they survive.

They lived in a session scratchpad and were wiped three times, which cost two
build passes: an agent looked for the design, found an empty directory, and
built from a written brief instead. The written brief cannot carry what the
artboards' inline comments carry — the reasoning for why a surface is shaped
the way it is. Committing them makes the design as durable as the code it
describes.

Read the HTML comments, not just the pixels. They are the argument.

| File | Surface |
|---|---|
| `Main`, `Detail`, `List`, `Dashboard`, `Empty` | the programs list and detail surfaces |
| `EditorMobile`, `EditorDesktop`, `EditorSets`, `EditorPivot` | the program editor, both projections |
| `SubProgression`, `SubTechnique`, `SubInference` | editor sub-surfaces |
| `NewMobile`, `NewDesktop` | creating a program (the empty case) |
| `TrainedSplitWeek`, `TrainedEdgeCases` | trained history inside the editor |
| `WorkoutChangelog`, `CorrectionGuards` | the session change log, and its modal + disclosure |

`canvas.json` lays them out; open any `.dc.html` directly in a browser.
