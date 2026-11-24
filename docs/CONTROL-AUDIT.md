# Terminnia control-to-handler audit

Audit baseline: `main` at `a93e55860474baac98d16429861a2a4df7a10921` (2026-11-24).
Scope: current `index.html`, `app.js`, `sql-worker.js`, `styles.css`, smoke tests, and quality workflow.
This is a source audit, not a claim that every interaction has passed browser testing.

## Executive findings

- The current production UI is a single local SQLite workspace. There is no MySQL/MariaDB connector or server-side database API.
- Core SQLite execution, browser persistence, import/export, CSV export, query history, editor tabs, and schema inspection are implemented.
- Two controls are decorative/nonfunctional: the brand home button and avatar.
- The project switcher is a toast-only placeholder.
- The New table action only inserts a SQL template; it is not a visual table builder.
- Views are displayed as a text list, not a browsable object tree.
- SQL FILES is an empty heading with a new-query action; it is not a file manager.
- Search selects only the first match in the current editor document.
- Selecting a table overwrites the editor and runs SQL automatically. This is a surprising side effect.
- Settings are reachable from both the header and activity bar.
- Existing tests cover first launch, SQL execution, local persistence, error recovery, export, and tab persistence, but do not cover all visible controls or import safety, worker failure, storage failure, or mobile behavior.
- The current workflow runs browser smoke tests against a raw static server. It does not create a bundled production build or prove that Vercel production deployment waits for the quality workflow.

## Header

| Control / element | Handler | Current behavior | Audit decision |
|---|---|---|---|
| `#brand-logo` | None | Looks like a home button but does nothing | Remove button semantics or give it a real safe home/workspace action |
| `#project-switcher` | `onclick` near end of app.js | Shows toast saying there is one project | Remove placeholder until multiple projects exist; use a noninteractive workspace label |
| `#import-db` | Click -> hidden file input | Opens SQLite file picker | Keep; improve validation and replacement safety |
| `#export-db` | `exportDb()` | Exports current SQLite database | Keep; improve error and transaction handling |
| `#settings-toggle` | Toggles settings popover | Opens editor settings | Keep as the single settings entry point |
| `.avatar` | None | Decorative letter avatar | Remove; it implies an account/profile feature that does not exist |
| `#connection` | Updated during initialization | Displays local connection state | Keep as status, not a control |

## Activity bar and sidebar

| Control / element | Handler | Current behavior | Audit decision |
|---|---|---|---|
| `[data-activity=explorer]` | Shared activity click listener -> `setActivity` | Shows explorer | Keep |
| `[data-activity=search]` | Shared listener -> `setActivity` | Dynamically creates current-document search | Keep only after implementing next/previous match and empty-state behavior |
| `[data-activity=database]` | Shared listener -> `setActivity` | Shows same explorer section as Explorer | Consolidate or repurpose as Connections when remote adapter is proven |
| `[data-activity=history]` | Shared listener -> `setActivity` | Shows query history | Keep |
| `[data-activity=settings]` | Shared listener -> `setActivity` | Opens settings popover | Remove duplicate entry point; header settings is sufficient |
| `#refresh-tables` | Calls `refreshTables()` | Refreshes local table/view metadata | Keep; show busy/error state |
| `#new-table` | Inserts fixed CREATE TABLE template | Does not create a table or open a builder | Replace with a real table-creation workflow; until then label as template insertion or disable |
| `#sidebar-collapse` | Toggles collapsed class | Collapses sidebar | Keep |
| `#project-tree-toggle` | Toggles project metadata and tree class | Hides metadata and all tree groups | Keep only if disclosure state and chevron are synchronized |
| `#tables-tree-toggle` | Toggles table list visibility | Expands/collapses table list | Keep |
| `#views-tree-toggle` | Toggles `#views-empty` visibility | Hides/shows a text string containing view names | Replace with a real view list and shared tree behavior |
| `#new-query` | `createTab()` | Creates a browser-persisted SQL buffer | Keep; make document naming and persistence explicit |
| `#table-list` generated items | `browse(name)` | Inspects schema, then replaces editor text and executes SELECT | Remove editor mutation and automatic execution; selection should inspect only |
| `#history-list` generated items | Dispatches query into editor | Restores selected historical SQL to current tab | Keep; consider opening as a new document instead of silently replacing content |
| Sidebar footer | None | Static local-privacy statement | Keep, but ensure wording accurately describes browser-local storage |

## SQL editor and tabs

| Control / element | Handler | Current behavior | Audit decision |
|---|---|---|---|
| `#add-tab` | `createTab()` | Creates a new SQL tab | Keep; add dirty-state and close protection |
| Generated tab body | `switchTab(id)` | Switches editor buffers | Keep |
| Generated tab close button | `closeTab(id)` | Closes tab; last tab is emptied | Add unsaved-change confirmation |
| `#copy-sql` | Clipboard API | Copies current SQL | Keep; graceful fallback if clipboard permission is denied |
| `#download-sql` | Downloads current SQL | Downloads current buffer | Keep |
| `#format` | `formatSql()` | Formats as SQLite SQL | Keep; validate formatter compatibility and preserve selection where possible |
| `#clear` | Replaces document with empty text | Clears current buffer | Keep; protect against accidental loss |
| `#run` | `run()` | Executes selected SQL or full document | Keep as primary action; improve cancellation, transaction feedback, and result consistency |
| `#example` | Loads sample query and executes | Replaces editor content and runs it | Make loading an example non-destructive or clearly separate load from run |
| Ctrl/Cmd + Enter | Document keydown listener | Executes SQL | Keep |
| `#cursor`, `#status-selection` | Editor update listener | Shows cursor and selection metadata | Keep |
| Editor footer dialect label | Static markup | Says SQLite | Keep accurate; make dialect dynamic only after adapters exist |

## Results, messages, structure, and resizing

| Control / element | Handler | Current behavior | Audit decision |
|---|---|---|---|
| Results panel tab | `switchPanel('results')` | Shows result content | Keep |
| Messages panel tab | `switchPanel('messages')` | Shows execution messages | Keep |
| Structure panel tab | `switchPanel('schema')` | Shows schema content | Keep |
| Generated result-set tabs | Inline generated click handler | Switches between result sets | Keep |
| `#csv` | `exportCsv()` | Exports current displayed result set | Keep; ensure result selection and row limits are explicit |
| `#panel-toggle` | Toggles output panel and resize handle | Hides/shows output | Keep; synchronize icon, accessible label, and state |
| `#panel-resize` | Pointer listeners | Resizes output panel vertically | Keep; add touch/keyboard accessibility |
| `#row-count`, `#duration`, `#result-content`, `#message-content`, `#schema-content` | Render functions | Present output and metadata | Keep |
| Empty result state | Static markup | Offers Load example query | Keep only if example action is non-destructive and accurate |

## Settings and file input

| Control / element | Handler | Current behavior | Audit decision |
|---|---|---|---|
| `#font-size` | Changes CodeMirror font size | Applies selected font size | Keep; persist preference |
| `#line-wrap` | Toggles editor no-wrap class | Controls wrapping | Keep; persist preference |
| `#zen-mode` | Toggles body class | Hides surrounding chrome | Keep; persist preference and provide reliable exit |
| Settings popover outside click | Document click listener | Closes popover | Keep |
| `#database-file` | Change listener -> `importDb(file)` | Imports selected SQLite file | Keep; validate file before replacing active database |
| `#startup-error` | Initialization catch | Displays startup failure | Keep; provide recovery and diagnostics without exposing secrets |
| `#toast` | `toast()` | Transient status feedback | Keep; do not use as the only evidence that a complex operation succeeded |

## Worker operations

| Worker action | Current implementation | Main risk / next work |
|---|---|---|
| `init` | Loads SQL.js from fallback CDNs; opens or creates DB; returns snapshot | Bundle runtime locally; validate restored snapshot; expose actionable startup failure |
| `exec` | Runs SQL, computes metadata, exports snapshot after every execution | Avoid unnecessary full exports where safe; preserve transaction durability; clarify multi-statement failure semantics |
| `export` | Calls SQL.js database export | Preserve active DB; report open-transaction limitation |
| `import` | Constructs new DB, closes old DB, replaces it, exports snapshot | Stage and validate candidate DB before swapping; preserve old DB on failure |
| `tables` | Reads sqlite_master | Separate tables and views in structured output |
| `schema` | Reads PRAGMA table_info | Add indexes, foreign keys, constraints, and object-type awareness |

## Persistence and concurrency

- IndexedDB stores a single active SQLite snapshot under one fixed key.
- SQL tab buffers and query history use localStorage.
- The save promise chain currently remains rejected after a failed write, which can prevent later queued writes from running.
- A worker timeout currently rejects only the pending request; the worker is not terminated or recovered.
- Multiple browser tabs are not coordinated for writes.
- Database snapshots are copied after every SQL execution, including read-only statements.
- Browser storage eviction, private-mode cleanup, and device loss can remove the only copy. Users need a clear backup reminder.

## Existing test coverage

| Test | Existing coverage |
|---|---|
| First launch and sample database | Yes |
| SELECT execution | Yes |
| Writes and reload persistence | Yes |
| SQL error followed by successful query | Yes |
| SQLite export download | Yes |
| Multiple SQL tabs and reload persistence | Yes |
| Invalid import preserves active DB | No |
| IndexedDB failure and recovery | No |
| Worker crash/timeout recovery | No |
| Transaction commit/rollback persistence | No |
| Multi-statement partial failure behavior | No |
| Table selection does not execute SQL | No |
| New-table workflow | No |
| Views and indexes browsing | No |
| Search next/previous | No |
| Unsaved tab close protection | No |
| Mobile interactions and responsive layout | No |
| Remote MySQL/MariaDB connection | Not implemented |

## Deployment and CI audit

- Current workflow: `.github/workflows/quality.yml`.
- Runs Node syntax checks and Playwright smoke tests against Python's static HTTP server.
- Installs Playwright without a committed package manifest or lockfile.
- Does not create a Vite/production bundle.
- The current Vercel integration reports a successful deployment status for the baseline commit, but the available commit status does not prove that Vercel waits for GitHub Actions quality checks before production promotion.
- Branch `main` is currently unprotected according to the branch metadata returned during this audit.
- Automatic deployment must be configured so that a failing quality gate cannot publish an unverified production build.

## Stage 0 exit assessment

Stage 0 source inspection is complete. Stage 1 must first address runtime dependency reliability, persistence queue recovery, worker lifecycle, and safe database import. The visible UI should remain unchanged during this work, except for narrowly necessary error/recovery feedback.
