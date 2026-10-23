# Dependency Atlas

The Dependency Atlas (`/atlas`) draws a repository's real folder structure and the import relationships between
its JavaScript/TypeScript files. Everything shown comes from the analysis; nothing is guessed.

## How the data is produced

1. Every analysis (Home → analyze a GitHub URL or ZIP) runs the existing `CodeAnalyzer` with `keepSources: true`.
   The file texts it already reads are kept in memory (capped at **200 MB**, counted in UTF-8 bytes). Above the cap
   the analyzer stops keeping texts, logs `keepSources cap … reached`, and the Atlas re-reads the remaining files from disk.
2. `buildAndStoreAtlas` (server/src/services/atlas) builds the `AtlasData` from the same extracted folder and stores it
   as **gzip-compressed JSON in MongoDB GridFS** (bucket `atlas`, file name = analysis id). The analysis document keeps
   only a small `atlas` summary (sizes, counts, where texts came from, build time). Source code is never stored.
3. If the map cannot be built or saved, the analysis still succeeds with the warning
   *"The dependency map could not be generated for this analysis. Re-analyze to try again."* and the Atlas page shows
   "Map not available for this analysis" with a **Re-analyze** button, never an empty map.

Old analyses that are pruned (only the newest 5 per repository are kept) lose their Atlas files at the same time.
On every server start, `cleanupOrphanAtlasFiles()` removes Atlas files whose analysis no longer exists.
There is no "delete repository" endpoint yet; when one is added it must call `deleteAtlasForRepository(repositoryId)`.

## API

`GET /api/repositories/:id/atlas` (sign-in required)

| Result | Meaning |
|---|---|
| `200` | `AtlasData` of the newest **completed** analysis, streamed as stored (`Content-Encoding: gzip`, `Cache-Control: private, no-cache`, `ETag`); plain JSON for clients that do not accept gzip |
| `304` | `If-None-Match` matches the ETag |
| `400` | invalid repository id |
| `404` | repository not found **or not yours**; `code: NO_ANALYSIS` (no completed analysis) or `code: NO_ATLAS` (that analysis has no map) |
| `413` | `code: ATLAS_TOO_LARGE`, the map is over 50 MB uncompressed |

Client aborts destroy the GridFS stream.

## Analyses made before this release

* **Resolver fix (analyzer 2.1.0):** imports that end in a slash, such as `import './utils/'`, now resolve to the
  folder's index file, exactly as Node does. Before, they were counted as *unresolved*. **Analyses saved before this
  fix keep their old counts (Home page numbers included) until the repository is re-analyzed.**
* Those older analyses also have **no Atlas map**. Because `ANALYZER_VERSION` changed to `2.1.0`, analyzing the same
  commit again runs a fresh analysis instead of reusing the old result, so a normal re-analysis creates the map.

## Limits

* Scope: `.js .jsx .mjs .cjs .ts .tsx` get dependency information; other files appear in the structure only.
* Skipped: `node_modules`, `.git`, `dist`, `build`, `coverage`, `*.min.js`, `*.d.ts`, files over 1 MB (listed in `stats.skipped`).
* The analysis pipeline caps a repository at 5,000 files; the browser view refuses maps of more than 20,000 files.

## Development

* `client/`: `npm run dev`, then `/atlas` (your repositories). Dev-only switches:
  `?sample=1` (this project, real analyzer output), `?synthetic=2000` (generated data for performance tests),
  `?perf=1` (overlay with draw time, frames per second while moving, drawn nodes/edges/labels, layout time).
* Server tests: `cd server && npm test`. Client logic tests (no extra dependency, uses the server's tsx):
  `cd client && ../server/node_modules/.bin/tsc -p tests/tsconfig.json && ../server/node_modules/.bin/tsx --test tests/*.test.ts`.
* Benchmarks: `cd server && npx tsx src/scripts/atlas-bench.ts` (analyzer) and
  `cd client && ../server/node_modules/.bin/tsx tests/layout.bench.ts` (layout).
* Sample data: `npx tsx src/scripts/atlas-sample.ts <folder> <out.json> [--owner o --name n --sha <commit>]`.
