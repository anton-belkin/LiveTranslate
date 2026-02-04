# DEL-20260204-1805-Agent_F-ui-merge-stt-into-paragraph (status: completed)

## Task
- **Agent**: Agent_F
- **Goal**: Improve readability of interim STT: avoid showing chopped micro-segments as separate lines.
- **Milestone**: M1 polish (UI readability)

## Scope / constraints
- **Allowed paths**: `apps/web/**`
- **Forbidden**:
  - do not edit `packages/shared/**`
  - do not implement translation

## Requirements
- Assume Agent_D may switch to emitting **one stitched segment per turn** (`segmentId = turnId`) but we want the UI robust either way.
- Update UI rendering so that, per turn and per language column:\n+  - display a **single combined paragraph**:
    - Prefer the latest segment if only one exists.\n+    - If multiple segments exist, join them with a space/newline but avoid ellipsis after every tiny segment.\n+  - Show partial vs final styling at the paragraph level.\n+  - Keep “stick-to-bottom” behavior stable during rapid updates.\n+
Optional: hide extremely short segments (<3 chars) unless final.

## Acceptance checklist
- A normal sentence no longer appears as 5–10 chopped lines with ellipses.\n+- Partial updates look like a single live-updating paragraph.\n+- No scroll-jank regressions.\n+- `pnpm -C apps/web typecheck` passes.

## Dependencies / context
- `apps/web/src/ui/liveTranslate/TurnBlock.tsx`
- `apps/web/src/ui/liveTranslate/store.ts`

## Completion report (agent appends)
<!-- Agent appends below. -->

## Completion report (Agent_F)
- **What I changed**
  - Updated per-turn, per-language rendering to show a **single combined paragraph** instead of one line per micro-segment.
  - Paragraph-level interim/final styling: if any segment is partial, paragraph is treated as partial; when all are final, paragraph becomes final.
  - Optional filter: hides extremely short (<3 chars) partial segments to reduce noise.
  - Added a subtle “live cursor” marker for partial paragraphs to make interim updates feel continuous without adding ellipsis per segment.
- **Files changed**
  - `apps/web/src/ui/liveTranslate/TurnBlock.tsx`
  - `apps/web/src/ui/styles.css`
- **How to test**
  - Commands:
    - `pnpm -C apps/web dev`
    - `pnpm -C apps/web typecheck`
  - Manual:
    - Click `Dev: start mock` (or connect to WS emitting multiple `segmentId`s per `turnId`).
    - Confirm the column shows a single live-updating paragraph (not 5–10 chopped lines), and scroll behavior remains stable.
- **Known issues / follow-ups**
  - If Agent_D switches to `segmentId = turnId`, this UI still works (single-segment paragraph).

