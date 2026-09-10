# Invited playtest

SH-012 is a live operating task. Do not invite players until every item in the
[Railway deployment gate](railway.md) has been completed and recorded outside
the repository, including spending limits, HTTPS OAuth, restart persistence,
daily backups, and one verified restore.

## Cohort and session

Invite three to five known players. Keep `BLUESKY_INVITED_DIDS` limited to that
cohort and do not open registration publicly. Ask each player to use their
normal phone or computer and complete one bounded session:

1. Sign in, inspect the fresh hog, and choose a build to pursue.
2. Feed all six tray meals intentionally. Ask the player to explain what they
   think lifetime favorite and recent meals will change before the final meal.
3. Clean the hog after it becomes dirty and note whether the cooldown is clear.
4. Open the public pen and exchange one treat with another invited player.
5. Preview one public Bluesky post. Generate at most one share card if the
   player discovers a mutation and wants to share it.
6. Return after at least one meal refills and decide whether to continue the
   same build or change direction.

Do not explain mutation recipes. The test succeeds when players use the
on-screen diet history to form and revise an intentional feeding strategy.

## Evidence to record

Keep the playtest record outside the repository if it contains account,
deployment, or contact details. Assign anonymous tester labels and record:

- device and browser;
- intended build, meal choices, and whether the resulting appearance was
  expected;
- the first confusing or blocked step, with a reproducible sequence;
- whether login, cleaning, public pens, treats, previews, and cards completed;
- database size, quota use, Railway usage, and application errors before and
  after the session.

After each session, ask only:

1. What build were you trying to make?
2. What did you think your next meal would change?
3. Where did you hesitate or lose trust?
4. Would you return after the tray refills? Why?

Turn a repeated or blocking observation into a bounded issue. Include the
anonymous reproduction, expected behavior, cost impact, and the smallest
acceptance check. Do not include Bluesky DIDs, post contents, deployment
identifiers, or secrets.

## Stop conditions

Stop invitations and set the application to read-only before investigating if:

- Railway usage or any provider control is higher than expected;
- the database reaches its 70% warning threshold;
- authentication grants access to a non-invited account;
- private account or post data appears outside its intended view;
- errors repeat across two players or a state-changing action cannot be
  reconciled with its receipt.

Do not raise a cap to continue a session. Preserve logs and the affected action
identifier without copying secrets or complete post contents.

## Completion

SH-012 is complete only after at least three invited players finish the bounded
session, cost remains inside policy, each player can describe and pursue a
build, blocking observations are fixed or explicitly deferred, and first-day
usage is recorded. Re-run `npm run check`, `npm run build`, and
`npm run smoke` for every code fix.
