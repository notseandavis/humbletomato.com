# Humble Tomato — Design & Content Principles

## Visual Design: Humble Tomato Brand

- **Keep the current visual language.** Tomato red (#E84430), cream (#FFF8F0), DM Sans + DM Serif Display.
- **The brand identity is warm and distinctive.** Don't flatten it into generic white.
- **Cards, nav, color accents are fine.** The visual design works.
- **Fast.** No JavaScript unless absolutely necessary. No frameworks. Plain HTML + CSS.
- **Mobile-first.** Readable on a phone without pinching.
- **Code blocks should be excellent.** Good monospace font, proper syntax context, copy-friendly.

## Content Style: The Dotnetperls Standard

**Why this matters:** Stack Overflow's 2025 Developer Survey (90,000+ developers) found 66% cite "almost right, but not quite" AI-generated code as their biggest frustration. Quick reference format with concrete examples addresses this — readers learn patterns, not just copy code. By 2026, cost and token efficiency became primary concerns for 85% of AI tool users.

- **Quick reference format.** Someone finds this via Google — they get what they need in 60 seconds.
- **Code examples front and center.** Show, don't tell. The example IS the explanation.
- **Lead with code, explain after.** Don't start with abstract concepts. Show code first, then explain what it demonstrates. Never start with "The Core Insight" or "Why This Matters" — start with a code block.
- **Code progression over explanation.** When explaining a concept, show it through a series of code examples that build on each other. The reader should SEE the pattern, not just read about it. See solution-space.html for the gold standard.
- **Code progression pattern.** For constraint-based concepts: (1) vague spec → multiple valid solutions, (2) add constraint → show eliminated solutions, (3) add constraint → show final solution. The reader learns by watching the solution space collapse. Example: "Sort a list" → 3 solutions, + "in-place O(n log n)" → heapsort, + "stable" → in-place mergesort.
- **3-screen rule (strictly enforced).** Max ~120 lines of content per page. If longer, split into multiple pages or cut ruthlessly. Long pages violate the quick reference format. Continuous Evolution violates this (~200 lines) — needs aggressive cutting.
- **Link out to quality resources.** Don't try to be exhaustive. Be the best summary, then point to the deep dives.
- **Scannable.** Headers, short paragraphs, code blocks. Gist in 30 seconds, detail in 5 minutes.
- **Concrete over abstract.** Show the PRD. Show the loop. Show the diff. Real examples, not theory.
- **Examples ground philosophy.** Philosophical/conceptual pages need at least 2-3 concrete code examples to anchor abstract ideas. Specs-as-DNA needs more concrete "how to write a spec" examples.
- **Code-first test.** Before publishing/refining a page, ask: "Could I understand this from the code examples alone, without reading the text?" If no, add better examples.
- **Tables supplement, don't replace.** Comparison tables are good but don't replace concrete examples. Use both.
- **No placeholder pages in navigation.** If content is mostly "coming soon," hide the page from nav until it's ready. Ship complete pages or don't ship at all. BMAD is currently hidden for this reason.
- **Honest about tradeoffs.** Every technique has limitations. Say what they are.
- **No buzzwords.** No "revolutionize," no "game-changing," no "unlock the power of." Just describe the thing.
- **No AI writing tells.** Avoid: em dashes (—), "The Core Insight," "Let's dive in," "Here's the thing," "It's worth noting," "Crucially," "Importantly," "Why X are..." (subtitle pattern). Use periods and commas. Write like a person, not a language model. If a heading sounds like a ChatGPT section title, rewrite it. Check subtitles especially — "Why specifications are genetic code" sounds like AI, "Specs encode intent like DNA encodes organisms" sounds human.
- **Credit sources.** If a technique came from somewhere, link it.
- **Verify every link.** Every URL on the site must be tested and confirmed accessible. If you can't verify a link works, don't include it. No broken references, no dead footnotes, no 404s. Audit all links before publishing.
- **Living content.** Pages get updated as techniques evolve. Date the last update.

## Content Scope

Spec-driven development and AI-assisted engineering techniques:
- Matrix Methodology (our core framework)
- Ralph Wiggum Loop (autonomous execution pattern)
- BMAD and other structured agent methods
- Agent team patterns (multi-agent orchestration)
- Continuous Evolution (spec-driven for live products)
- Comparative analysis of tools and approaches
- Practical guides and walkthroughs

## What This Site Is NOT

- Not a blog (no "thoughts on AI" posts)
- Not a product page (nothing to buy... yet)
- Not a portfolio (not about us)
- It's a reference. Like Dotnetperls, but for spec-driven AI development.

## Daily Improvement Loop

Every day:
1. Research — find new techniques, tools, approaches, papers, discussions
2. Evaluate — does this belong on the site? Does it add value?
3. Write or refine — new page, or improve existing content
4. Ship — commit and push. Don't hoard drafts.
5. Log — update the build log with what changed and why.

## Emerging Patterns (2026)

**Cost awareness is now primary.** 85% of developers use AI tools, but token efficiency and predictable pricing are now first-order concerns. Pages covering tooling should acknowledge cost tradeoffs.

**Context engineering is a discipline.** Not just "big context windows" — it's about what to include/exclude, how to structure, when to refresh. Pages about agent orchestration should reflect this.

**The productivity paradox.** Some developers stopped using AI tools and saw no productivity decrease. The issue: tools that add friction. Good pages show what removes friction, not just what's possible.

---

*Last updated: 2026-03-18 — Added cost/token efficiency guidance, context engineering as discipline, AI writing tells in subtitles, clarified 3-screen violations, updated based on 2026 research (30+ SDD frameworks, Zencoder/Kiro/Kilo emergence)*
