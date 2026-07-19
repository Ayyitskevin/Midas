<!-- Thanks for contributing to Midas! Keep PRs small and single-concern. -->

## Summary

<!-- What does this change and why? -->

## Changes

<!-- Bullet the notable changes. Screenshots/GIFs help for UI. -->

-

## Testing

<!-- How did you verify it? The gates below are required. -->

- [ ] `pnpm -r typecheck` passes
- [ ] server tests pass (`pnpm --filter @midas/server test`)
- [ ] web tests pass (`cd apps/web && npx vitest run`)
- [ ] web build passes (`cd apps/web && npx vite build`)
- [ ] Added/updated tests for new pure logic
- [ ] Any surfaced data is honestly labeled (live vs synthetic/unavailable)
- [ ] Reviewer demo remains deterministic and credential-free (`pnpm test:reviewer`)
- [ ] No live exchange, hosted-state, or model call was used by tests or fixtures
