# Release 5.12.0 verification — proposal quality and commercial integrity

## Implemented
- Deterministic five-item proposal completeness rubric with per-check output.
- Detection of instruction-like text in listing descriptions and instruction echoes in proposal drafts.
- Warning when structured proposed price exceeds the listing's stated maximum budget.
- Warning for monetary amounts in proposal text when no structured quote was provided.
- Additive `quality_review` metadata in proposal generation API and frontend display.
- No schema migration, environment variable or external side effect.

## Checks executed
- Focused regression tests: **24 passed** (v5.12 quality tests plus v5.11 claim-review, v5.10 proposal intelligence, v5.9 ranking and retrieval tests).
- Backend Python compilation: pending final package verification.
- Full backend suite, PostgreSQL integration, frontend typecheck/build and browser E2E: not run in this environment; run in CI/staging before production.

## Limitations
- The score is a basic deterministic checklist, not an LLM judge and not a measure of likely conversion.
- Budget comparison assumes proposed price and listing budget are in the same currency; no FX conversion is performed.
- A listing warning does not prove malicious intent. Text heuristics may miss or falsely flag instructions.
- A clean result does not prove factual accuracy, scope fit, fair pricing or client legitimacy.
- Human review and existing explicit approval gates remain mandatory.
