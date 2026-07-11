# crasLens-backend — Claude Code conventions

Note the directory name: matches the real (typo'd, missing "h") name on disk and in
this repo's own git history — do not rename it. See the root
`/Users/mohdnadeem/Desktop/crashLens/CLAUDE.md` for the full service/port/RabbitMQ
topology and `../../.claude/rules/real-architecture-reference.md` for the ground-truthed
current state.

## Per-service structure

Each of the 8 services (`api-gateway`, `auth-service`, `project-service`,
`event-service`, `worker-service`, `issue-service`, `monitor-service`, `alert-service`)
is independent: own `package.json`, own `node_modules`, own Mongo database/connection
(`src/config/database.js`). No shared package exists across them yet — duplicated files
(e.g. `assertJwtSecret.js`, `tokens.js`, `redactSensitiveFields`, `cors.js`) are
intentional until Module 4's `shared/` consolidation is approved and built. If you're
duplicating a fix across services in the meantime, keep the copies byte-identical — check
**every** existing copy when you touch one, not just the newest; Module 9's review found
`assertJwtSecret.js`'s header comment had silently drifted out of sync across 4 of the 5
pre-existing copies (function bodies stayed identical, only the doc comment rotted),
which a byte-for-byte `diff` across all copies would have caught immediately.

`alert-service` is the first service with no RabbitMQ involvement at all (no
`utils/rabbitmq.js`) — it only makes synchronous HTTP reads against issue-service and
monitor-service's existing APIs, the first inter-service synchronous call in this
codebase (see `../../.claude/rules/real-architecture-reference.md`'s "Inter-service
synchronous reads" section for the system-JWT auth pattern this established).

## `app.js` / `server.js` split

Every service that has HTTP routes exports its configured Express app from `src/app.js`
(pure — no DB/queue connect, no `app.listen`) separately from `src/server.js` (env
guards, DB/queue connect, `app.listen`, signal handlers). This is what lets
`supertest(app)` drive routes in tests without a real Mongo/RabbitMQ/Redis connection.
Established in Module 1 for the 4 services that module touched (`auth-service`,
`project-service`, `issue-service`, `api-gateway`); `event-service` didn't get it until
Module 7, when a new route (`/api/events/logs`) needed a real supertest-driven test —
`worker-service` still doesn't have it (no HTTP routes to test, purely RabbitMQ-driven).
If you add a new service or restructure an existing one, keep this split.

## Joi validation pattern

Every route that accepts body/query/params should validate with Joi via the
`validateRequest(schemas)` middleware (originated in `auth-service/src/middleware/
validateRequest.js`, copied into `issue-service` in Module 1 — copy this pattern into
any service that doesn't have it yet rather than inventing a new validation shape).
`schemas` is `{ body, params, query }`, each an optional Joi schema; the middleware
reassigns `req.body`/`req.params`/`req.query` to the validated+coerced value. Wire it as
the first route-specific middleware (after any router-wide `authenticate`, before
`requirePermission`/the controller).

**Type every client-supplied value that flows into a Mongoose filter, explicitly.**
Enum fields need `Joi.string().valid(...)`; free-text fields need `Joi.string().max(N)`
at minimum. An untyped field is a NoSQL operator-injection risk the moment it's used in
a filter — this was Module 1's P0 finding in `issue-service`.

## Winston structured-logging convention

Log structured fields (`method`, `url`, `statusCode`, correlation ID once it's added),
not pre-interpolated strings — most existing call sites do the latter
(`` `Received ${req.method} request...` ``). Correlation-ID propagation, converting the
highest-traffic log call sites to structured fields, RabbitMQ reconnect/backoff, and the
retry-counter-bypass fix were all cut from Module 2's scope under a sprint time
constraint and deferred to a fast-follow pass after Module 10 — don't assume they're
done. Prefer the structured logging form in new code now rather than adding to the pile.

## RabbitMQ reliability pattern

**Consumer-side** (a service consuming from a queue and retrying/DLQ'ing a failed
message): `worker-service` and `issue-service`'s `utils/rabbitmq.js` have the reference
pattern (`sendToRetryQueue`/`sendToDlq`, a queue with `x-message-ttl` +
`x-dead-letter-exchange`/`-routing-key` that redelivers the *consumed* message back into
the same consumer loop after a delay, `x-retry-count` tracked in message headers against
`MAX_RETRY_ATTEMPTS`). Copy this pattern verbatim for any new consumer.

**Publisher-side** (a service publishing an event and needing to handle the publish
itself failing — no consumed message, no consumer loop to redeliver into): the
consumer-side TTL+DLX mechanism doesn't translate directly, since redelivering "back into
a consumer loop" doesn't apply to an outbound publish. `project-service`'s
`events/project-events.js` (fixed in Module 2, P0) is the reference for this case: switch
to `connection.createConfirmChannel()` so publish failures are actually detected (a plain
channel's `publish()` return value only reflects local buffer state, not whether the
broker received the message), retry the publish itself a bounded number of times
in-process with linear backoff, and fall back to a durable DLQ (`sendToQueue` directly,
not routed through the exchange) if every attempt fails — matching the DLQ *shape* and
header conventions (`x-dlq-reason`, `x-original-routing-key`) of the consumer-side
pattern without literally reusing its TTL-requeue mechanism. Copy *this* pattern for any
new publisher, not the consumer-side one.

**Don't await a publish call inline on a request handler's response path** if the
response doesn't use its result — `publishProjectEvent` never throws (it already handles
its own retry+DLQ), so awaiting it only serializes its full worst-case latency (retry
backoff, plus no explicit timeout anywhere in the connect/publish/DLQ chain today) onto
the caller for no benefit. Fire it and attach a `.catch()` safety net instead (see
`project-controller.js`'s `createProject`/`updateProject`/`archiveProject`/
`regenerateProjectDsn` for the pattern).

**DLQ entries can carry sensitive data.** `project-service`'s DLQ holds the full failed
event envelope, including `dsnPublicKey` (a bearer credential for event ingestion, not
just an identifier) - a real, if lower-probability, plaintext resting place for it beyond
its normal transient time on the exchange. It has a bounded TTL (`DLQ_MESSAGE_TTL_MS`,
default 30 days) so it doesn't accumulate forever, but isn't redacted (redacting would
defeat the point of a DLQ meant for manual replay). Keep this in mind before putting
anything more sensitive through a DLQ in a future module.

## Test files that connect to Mongo: watch for cross-file interference

`node --test` (bare, no path) runs test files **concurrently** by default. Every test
file that does its own `mongoose.connect()`/`mongoose.connection.close()` (the
established pattern for integration tests against the real DB, e.g.
`issue-service/test/query-injection-integration.test.js`) is manipulating the *same*
global Mongoose connection singleton — with only one such file per service this never
mattered, but the moment a service has **two or more**, one file's `after()` can close
the connection out from under another file's still-in-flight request in a different
file, running concurrently in the same process. Symptom: a previously-passing test
starts intermittently failing with a 500/connection error, or the whole run hangs, with
no code change to the thing actually being tested (confirmed by this exact failure mode
in Module 6, when a second and third Mongo-connecting test file were added to
`issue-service`). Fix: `"test": "node --test --test-concurrency=1"` in that service's
`package.json` (already applied to `issue-service`, `event-service`, `monitor-service`)
— check whether a service you're adding a second Mongo-touching test file to needs the
same fix.

**Always invoke a service's tests via its own `npm test`, not a bare `node --test
<file>`.** The concurrency fix above lives in `package.json`'s script, not in any test
file itself — running `node --test` directly (e.g. while iterating on one file) silently
skips `--test-concurrency=1` and can reintroduce the exact cross-file interference the
fix above exists to prevent. Confirmed in Module 8: a `monitor-service` test hang was
initially misdiagnosed as a product bug because it was reproduced via a raw `node --test
<file>` invocation with no concurrency flag.

**A RabbitMQ consumer set up inside a test: do the one-time async setup (connect, assert
queue, bind, register the consumer) in a `before()` hook, not in a helper function
`await`ed from inside a `test()` body.** Module 8 hit a reproducible hang doing the
latter: an `async` helper (assertQueue → bindQueue → consume, invoked and awaited from
within a `test()` callback) ran its entire body to completion — confirmed via
step-by-step logging, every internal `await` resolved — but control never returned to
the `await theHelper()` call site; the test then hung forever with no error. A
standalone script with byte-identical logic but no `node:test` involved worked every
time, so this is a `node:test`/`node@22` interaction, not a bug in the publish/consume
code itself. Fix that generalizes: do the queue setup once in `before()`, and expose a
plain **synchronous** function to each test (e.g. a pull-based buffer: an array of
already-arrived messages plus an array of pending resolvers, filled by the one
persistent consumer callback) — see `monitor-service/test/cron-sweep.test.js`'s
`waitForNextOccurrence()` for the pattern. Don't reach for "extract an async
setup-and-wait helper, `await` it per-test" again until this is root-caused.

**That pull-based buffer has its own trap: never call `waitForNextOccurrence()` and then
abandon the returned promise** (e.g. racing it against a timer to assert "nothing
arrives" and only awaiting the race, not the occurrence promise itself). If nothing ever
arrives, the resolver you registered sits in `pendingResolvers` forever - and being
first-in-queue, it silently steals the *next* test's message out from under its own
`waitForNextOccurrence()` call, hanging that later test instead (confirmed in Module 8's
`uptime-prober.test.js`, one test file away from the fix above, right after fixing it).
To assert "nothing was published," check `bufferedMessages.length === 0` after a plain
`setTimeout` grace period instead - never call the pull helper for a negative assertion.

**For `node:test`'s `mock.method(obj, "fnName", fn)` to actually intercept a call, the
caller must invoke the function through the module object at call time
(`someModule.fnName(...)`), not via a destructured import
(`const { fnName } = require("./someModule")`) captured once at require-time.**
Destructuring binds a reference to the *original* function value before any test gets a
chance to call `mock.method`; the mock swaps the property on the module's exports object,
but the caller's already-bound local variable keeps pointing at the original. Established
in Module 9 (`alert-service/src/notifications/dispatcher.js` calling
`emailAction.sendEmail(...)`/`webhookAction.sendWebhook(...)` through the required module
object, and `jobs/alert-evaluator.js` calling `queryExecutor.executeQuery(...)` the same
way, specifically so their test suites could substitute mocked delivery/query results).
Write new cross-module calls this way from the start if the module is likely to need
mocking in a test - retrofitting a destructured import to a module-object call later is a
larger diff than just not destructuring in the first place.
