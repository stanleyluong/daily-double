# daily-double-pregenerate

Standalone Lambda that pre-generates each day's board on a schedule, outside
Amplify Hosting's SSR request timeout.

## Why this exists

`getBoardForDate()` in `src/lib/jeopardy.ts` generates a board on demand the
first time it's requested for a new date — two rounds plus Final Jeopardy,
roughly a dozen sequential/parallel Claude calls. That's slow enough that it
can exceed Amplify Hosting's platform-enforced SSR response timeout (its
Next.js compute doesn't honor route-level `maxDuration`), which produces a
504 with no board ever saved — a real outage hit on 2026-07-19/20 the night
Final Jeopardy shipped, since it pushed generation time past whatever
visitor's request happened to trigger it first.

This Lambda calls the exact same `getBoardForDate(todayKey())` function (via
a direct import of `src/lib/jeopardy.ts`, not a copy), but runs with a 5-minute
Lambda timeout instead of Amplify's cap, and on its own schedule — so the
board for the new day is already generated and persisted in Firestore before
any real visitor's request could hit the cold-generation path.

`getBoardForDate()` is idempotent and race-safe (`ref.create()` on the board
doc backs off to whichever writer won), so it's safe if a visitor's request
still beats the schedule, or if the schedule fires more than once.

## Infrastructure (us-west-2, account 350633016727)

- **Lambda**: `daily-double-pregenerate` — Node 20, 512MB, 300s timeout.
  Env vars: `ANTHROPIC_API_KEY`, `FIREBASE_SERVICE_ACCOUNT_BASE64` (same
  values as the Amplify app's env vars — rotate both places together).
- **Execution role**: `daily-double-pregenerate-lambda-role` — just
  `AWSLambdaBasicExecutionRole` (CloudWatch Logs only; Firestore/Anthropic
  auth is via the env-var credentials, not IAM).
- **EventBridge Scheduler**: `daily-double-pregenerate-daily` — fires
  `cron(5 0 * * ? *)` in the `America/Los_Angeles` timezone (5 minutes after
  the same midnight-Pacific rollover `todayKey()` uses), 2 retries on
  failure.
- **Scheduler role**: `daily-double-pregenerate-scheduler-role` — grants
  `scheduler.amazonaws.com` `lambda:InvokeFunction` on this function only.

## Redeploying after a code change

If `handler.ts`, or the generation logic in `src/lib/jeopardy.ts` /
`src/lib/firebaseAdmin.ts`, changes:

```
./deploy.sh
```

This rebundles (esbuild, `firebase-admin` + `@anthropic-ai/sdk` kept external
and shipped via this directory's own `node_modules`, resolved separately from
the Next.js app's) and pushes new code to the existing Lambda. It does not
touch the schedule, IAM roles, or env vars.

## Manual test invoke

```
aws lambda invoke --function-name daily-double-pregenerate \
  --region us-west-2 --log-type Tail /tmp/out.json \
  --query '{StatusCode:StatusCode,FunctionError:FunctionError}'
cat /tmp/out.json
```

Safe to run any time — it's a no-op read if today's board already exists.
