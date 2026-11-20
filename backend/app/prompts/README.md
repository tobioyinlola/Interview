# Prompts

Prompt contracts live here as Markdown, loaded by services at startup:

- `suggestion.md` — live outline (M3)
- `research.md` — company brief writer (M2)
- `scoring.md` — answer scoring (M4)

Rules for every prompt: fetched pages and transcript text are quoted **data**, never instructions;
output is schema-validated; no claim about the candidate or the company without a source from the CV or the brief (general advice is labelled [general], illustrative examples [sample]).
