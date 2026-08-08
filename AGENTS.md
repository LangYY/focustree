# AGENTS.md

## Engineering Principles

- Do not preserve backward compatibility. Remove obsolete paths instead of adding compatibility layers, fallbacks, or migrations.
- Choose the simplest implementation that fully meets the current requirements. Avoid speculative abstractions, configuration, and indirection.
- Grow the system in layers. Start from the smallest version that works end to end, and add each new capability on top of a product that already works. Never trade a working product for unfinished complexity.
- Keep components modular and concerns clearly separated.
- Prefer established, well-maintained libraries when they reduce overall complexity or improve reliability. Do not reimplement common functionality without a clear reason.
- Lean on the dependencies already in the project before writing your own implementation or adding packages. Do not assume a library lacks a capability without checking its documentation and types.
- Make architectural decisions for the long term. Do not accept a stopgap that only works for now and is meant to be replaced later.

## Project Context

- `HANDOFF.md` is the current source of truth for product plans, implementation status, active decisions, known issues, and next steps. Keep it concise and replace outdated information instead of accumulating history.
- `MEMORY.md` is an append-only log of meaningful implementation changes, decisions, experiments, and failed approaches worth remembering. Do not log routine actions or conversation transcripts.
- At the end of meaningful work, update `HANDOFF.md` if the current project state changed, and append to `MEMORY.md` if the work produced information worth preserving.
- Read `HANDOFF.md` when project context is needed. Do not read the entire `MEMORY.md` by default; consult relevant history only when necessary.