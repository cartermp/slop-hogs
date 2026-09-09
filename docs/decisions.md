# Decisions

- Use Railway, one app and one Postgres service when persistence arrives. Provisioning belongs to SH-006.
- Use Next.js, React, and TypeScript. No styling framework, external font, ORM, queue, Redis, or hosted asset service at this stage.
- Use Node's native test runner and TypeScript support for the initial pure rules and configuration tests. This replaces the plan's tentative Vitest choice and saves a dependency. Add browser tooling only with a feature that needs it.
- Keep a committed versioned policy with approved ceilings. Changing a JSON value alone cannot enable an unfinished feature or raise a ceiling. The validator and tests must change in a reviewed implementation task.
- Validate policy through npm lifecycle hooks and Next.js Node instrumentation. Missing policy is a startup error, never an unlimited fallback.
- The starter is intentionally not a playable mockup. SH-002 implements state transitions; SH-003 implements the hog renderer.
- Keep production dependencies exact and the lockfile committed. Review dependency changes on their own merits rather than updating automatically.
- Keep deployment manual. Do not create cloud resources or change spending limits as a side effect of routine development.
