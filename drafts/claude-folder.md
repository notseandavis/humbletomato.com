# The .claude/ Folder — Draft

## Title: Specs in the Wild
## Subtitle: The .claude/ folder is spec-driven development hiding in plain sight.
## Nav section: Ideas (alongside Specs as DNA, Telephone Game)

---

## Opening

```
# .claude/CLAUDE.md
Build: npm run build
Test: npm test -- --watch
Lint: npm run lint -- --fix

## Architecture
Monorepo (Turborepo). Packages: api/, web/, shared/.
API is Express + Prisma. Web is Next.js App Router.

## Rules
- TypeScript strict mode. No `any`.
- Errors use shared/errors.ts, never raw throw.
- All API routes need integration tests.
- No console.log. Use shared/logger.ts.
```

This file ships with your repo. Every developer gets it. Every AI agent reads it first.

It's a spec.

## The pattern nobody named

Claude Code's `.claude/` folder is a miniature spec-driven architecture:

| File / Folder | What it does | Spec equivalent |
|---|---|---|
| `CLAUDE.md` | Project-wide rules and context | Architecture spec |
| `rules/*.md` | Scoped rules (path-filtered) | Domain specs |
| `commands/*.md` | Reusable workflows | Runbooks |
| `~/.claude/CLAUDE.md` | Personal preferences | Developer context |

The same pattern Cursor uses (`.cursorrules`), Windsurf uses (`.windsurfrules`), Copilot uses (`.github/copilot-instructions.md`). Every AI coding tool independently converged on the same idea: **put a spec file in the repo root and the AI follows it.**

Nobody planned this. The tools evolved toward it because it works.

## Why path-scoped rules matter

```yaml
# .claude/rules/api-conventions.md
---
paths:
  - src/api/**
  - src/handlers/**
---
- All handlers return { data, error } shape
- Validate input with Zod schemas
- No direct DB calls — use repository layer
```

This rule only loads when Claude works on API files. It's a **domain-specific spec** that activates in context. Same idea as Matrix Methodology's context composition — load relevant specs, skip irrelevant ones.

The constraint isn't new. What's new is that the tooling enforces it automatically.

## What this means

The industry is converging on a principle Humble Tomato has been documenting:

**Specs drive code. Not sometimes. Structurally.**

The `.claude/` folder isn't a feature. It's evidence. When you give an AI agent explicit constraints, it produces predictable output. When you don't, you get the Solution Space problem — infinite valid interpretations, and the AI picks one you didn't want.

CLAUDE.md works because it narrows the solution space before the first line of code is written. That's not a Claude Code trick. That's spec-driven development.

## The convergence

| Tool | Spec file | Year |
|---|---|---|
| Cursor | `.cursorrules` | 2024 |
| Claude Code | `.claude/CLAUDE.md` | 2025 |
| Copilot | `.github/copilot-instructions.md` | 2025 |
| Windsurf | `.windsurfrules` | 2025 |
| Aider | `.aider.conf.yml` | 2024 |

Five tools. Five teams. Same conclusion: **the spec file is the interface.**

## Related

- [The Solution Space](solution-space.html) — Why unspecified decisions compound
- [Specs as DNA](specs-as-dna.html) — Same spec, different environments, different output
- [Matrix Methodology](matrix-methodology.html) — Context composition at scale
