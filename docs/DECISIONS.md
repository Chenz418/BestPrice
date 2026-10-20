# Decision log

Short record of settled decisions, so we don't re-argue them. Newest first.

| Date       | Decision                                                                 | Why |
| ---------- | ------------------------------------------------------------------------ | --- |
| 2026-10-20 | Monorepo with `extension/`, `server/`, `shared/`, all TypeScript.        | Shared type definitions; server is the natural boundary between the two developers. |
| 2026-10-20 | A small server holds all API keys; the extension never ships keys.       | Keys in an extension are public. |

## Open questions (to agree before coding)

- SERP provider (must support one call per country, ≤100 results, sort by price low→high).
- LLM provider / model for Identify and Extract.
- Exact shape of the contract types in `shared/`.
- Package manager + workspace tool (npm / pnpm workspaces).
- Non-code agreements: ownership of code & idea, future split, what happens if someone stops.
