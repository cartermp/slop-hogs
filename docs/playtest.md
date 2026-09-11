# Owner playtest

SH-012 is a live operating task. Complete and record every item in the
[Railway deployment gate](railway.md), including spending limits, HTTPS OAuth,
restart persistence, daily backups, and one verified restore.

## Session

Sign in with the owner's normal Bluesky account and complete one bounded
session:

1. Inspect the fresh hog and choose a build to pursue.
2. Feed all six tray meals intentionally. Before the final meal, predict what
   lifetime favorite and recent meals will change.
3. Clean the hog after it becomes dirty and note whether the cooldown is clear.
4. Open the public pen and confirm its anonymous view.
5. Preview one public Bluesky post. Generate at most one share card after
   discovering a mutation.
6. Return after at least one meal refills and decide whether to continue the
   same build or change direction.

Do not consult mutation recipes during the session. The test succeeds when the
on-screen diet history supports an intentional feeding strategy.

## Evidence to record

Keep the playtest record outside the repository if it contains account,
deployment, or contact details. Record:

- device and browser;
- intended build, meal choices, and whether the resulting appearance was
  expected;
- the first confusing or blocked step, with a reproducible sequence;
- whether login, cleaning, public pens, previews, and cards completed;
- database size, quota use, Railway usage, and application errors before and
  after the session.

Turn a blocking observation into a bounded issue with the reproduction,
expected behavior, cost impact, and smallest acceptance check. Do not include
the Bluesky DID, post contents, deployment identifiers, or secrets.

## Stop conditions

Set the application to read-only before investigating if:

- Railway usage or any provider control is higher than expected;
- the database reaches its 70% warning threshold;
- private account or post data appears outside its intended view;
- errors repeat or a state-changing action cannot be reconciled with its
  receipt.

Do not raise a cap to continue the session. Preserve logs and the affected
action identifier without copying secrets or complete post contents.

## Completion

SH-012 is complete after the owner finishes the bounded session, cost remains
inside policy, the feeding strategy is understandable, blocking observations
are fixed or explicitly deferred, and first-day usage is recorded.
