# Chat turn

`../chat.ts` runs one chat turn; this folder holds its parts, in layers. A layer may use the
layers above it in this list, never its peers or the ones below (`npm run arch:check` enforces it).

| Folder | What it does |
|---|---|
| `shared/` | Small helpers every part uses: request features and numbers, the action catalog, HTTP endpoint hints, read parameters. Knows nothing about a turn. |
| `shaping/` | Shapes a table with Jev: filters, sorts, totals, Korean column headers, the person's confirmed definitions as background. |
| `result/` | Turns command results into what the person sees: tables, lists, read recipes, multi-page HTTP reads. |
| `planning/` | Plans workflows from a request: selected tools and their inputs, step bindings, schedules, updates, table export. |
| `routing/` | Decides what a request is with Jev: answer, read (and from where), previous table, workflow, report. `eval/` measures it against real Jev. |
| `loop/` | Runs the turn: routes, executes the chosen command, confirmations, replies, request understanding. |
| `testing/` | Fixtures for tests only. |
