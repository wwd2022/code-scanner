# Review-driven improvement plan

Base: `test` at `313d584`. Work stays on a separate branch; no deployment or framework migration.

## Acceptance criteria and sequence

1. [x] Restore the Node regression suite and enforce the existing strict code/suffix contract without removing coverage. Keep pure parsing/geometry independent of DOM.
2. [x] Isolate generated-test optimization from operational history and update the comparison view from the actual optimized input/hits. Cover the boundary with regression tests.
3. [x] Bound generated image dimensions/pixels/code count before confirmation or allocation; replace quadratic uniqueness checks. Test rejection and valid limits.
4. [x] Preserve worker failure diagnostics, recover stalled correction work safely, and test primary/fallback paths.
5. [x] Make unfinished reviews explicit across scans and improve touch targets/status readability without a UI rewrite.
6. [x] Run all regressions, JavaScript syntax checks, diff checks and local mobile Chromium/MCP smoke checks. Add reproducible run/test instructions.
7. [x] Commit and push only the new branch; leave `test` unchanged and do not deploy.

## Cleanup boundaries

Small behavior-preserving extraction only for pure OCR helpers; regression tests first. No new dependencies. No blanket catch suppression, unrelated formatting, or generated browser artifacts in the repository.

## Follow-up scope

Persistent/searchable/exportable history, spreadsheet column mapping, offline asset packaging and CI are separate product changes. Decide retention/privacy and column-format policies before implementation.

## Verification evidence

Baseline: `node --test tests/ocr.test.cjs` fails at top-level `document` access in `ocr.js`. Working tree clean before branch creation. Add command results and remaining gaps after implementation.


Final local verification (2026-10-30):
- `node --test tests/*.test.cjs`: 27 checks passed (two legacy regression files each report as one test; they contain additional assertions).
- `node --check` for all application/test JavaScript: passed. `git diff --check`: passed. No dedicated lint/typecheck/build tooling is configured.
- Independent code-reviewer: APPROVE, no remaining findings. Independent architect: CLEAR. No custom code-review quality gates configured.
- Real chrome-devtools MCP against localhost: 390×844 mobile rendering, 44px mode buttons and no horizontal overflow; 844×390 landscape primary action reachable by scrolling.
- Real OCR and optimizer on a simple generated image: 3/3 codes, corrected input/view updated, test history remained 0. Uploaded-photo path recognized 3 codes and created 3 operational records.
- Discard confirmation dismissed: photo source retained. Accepted: historical pending label immediately changes to original-recapture-needed.
- Oversized image rejected before source allocation. Reloaded page console: no errors or warnings. OCR runs can produce Tesseract diagnostic warnings about resolution/diacritics.

Remaining validation/product gaps:
- Real camera, prolonged runs, all mobile GPU combinations and dense/low-contrast tables are not certified. A dense table generated during smoke testing had poor recognition; simple clean labels passed. No accuracy claim for arbitrary images.
- Historical images are not persisted; leaving a pending review explicitly warns and marks unavailable evidence. Refresh still loses session history, now stated in the UI.
- Persistent/exportable history, column mapping, offline packaging and CI remain follow-ups, not silently implemented.
- Termux Team could not launch from this outside-tmux surface; bounded native agents handled the parallel slices and independent reviews instead.
