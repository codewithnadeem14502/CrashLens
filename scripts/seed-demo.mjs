#!/usr/bin/env node
// Provision the shared demo workspace that POST /v1/auth/demo-login opens.
//
// Idempotent: safe to re-run against a gateway that's already seeded. It
// creates (or reuses) the demo organization + admin, a "TripWire" project,
// a cron monitor + uptime monitor, a starter dashboard, and one alert
// rule, then verifies that demo-login works end to end. Event/log/
// transaction data itself is NOT synthesized here - that comes from
// pointing a real instrumented app (TripWire) at the printed DSN, so the
// demo shows genuine SDK traffic rather than fabricated rows.
//
// Usage:
//   node scripts/seed-demo.mjs [gatewayBaseUrl]
//
//   gatewayBaseUrl defaults to http://localhost:3000
//
// Env:
//   SEED_ADMIN_EMAIL     (default demo-admin@crashlens.online)
//   SEED_ADMIN_PASSWORD  (required on re-runs; on first run one is
//                         generated and printed - store it)
//   SEED_ORG_NAME        (default "CrashLens Demo" -> slug crashlens-demo,
//                         must match auth-service's DEMO_ORG_SLUG)

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

let generatedPasswordWasUsed = false;

const GATEWAY = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
const ORG_NAME = process.env.SEED_ORG_NAME || "CrashLens Demo";
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || "demo-admin@crashlens.online";
const GENERATED_PASSWORD = `Demo-${crypto.randomBytes(9).toString("base64url")}1a`;
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || GENERATED_PASSWORD;
const PROJECT_NAME = "TripWire";
const UPTIME_URL =
  process.env.SEED_UPTIME_URL || "https://tripwise-test-crashlens.vercel.app";

const log = (msg) => console.log(`[seed-demo] ${msg}`);

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${GATEWAY}/v1${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    // non-JSON body (proxy error page etc.) - leave payload null
  }

  return { status: res.status, payload };
}

function expectOk({ status, payload }, what) {
  if (status < 200 || status >= 300) {
    throw new Error(
      `${what} failed: HTTP ${status} ${JSON.stringify(payload)}`,
    );
  }
  return payload;
}

async function waitForGateway() {
  for (let attempt = 1; attempt <= 30; attempt++) {
    try {
      // Any JSON answer (even 401) proves the gateway + downstream auth
      // route are alive.
      const { status } = await api("POST", "/auth/login", {
        body: { email: "probe@crashlens.local", password: "probe" },
      });
      if (status > 0) return;
    } catch {
      // connection refused - keep waiting
    }
    await new Promise((r) => setTimeout(r, 2000));
    if (attempt % 5 === 0) log(`still waiting for gateway (${attempt}/30)...`);
  }
  throw new Error(`gateway at ${GATEWAY} never became reachable`);
}

async function registerOrLogin() {
  const registration = await api("POST", "/auth/organizations", {
    body: {
      organizationName: ORG_NAME,
      admin: { name: "Demo Admin", email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    },
  });

  if (registration.status === 201) {
    log(`created organization "${ORG_NAME}" with admin ${ADMIN_EMAIL}`);
    if (!process.env.SEED_ADMIN_PASSWORD) {
      generatedPasswordWasUsed = true;
    }
    return registration.payload.data;
  }

  if (registration.status === 409) {
    log(`organization already exists - logging in as ${ADMIN_EMAIL}`);
    const login = await api("POST", "/auth/login", {
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    return expectOk(login, "admin login (is SEED_ADMIN_PASSWORD set correctly?)")
      .data;
  }

  throw new Error(
    `organization registration failed: HTTP ${registration.status} ${JSON.stringify(registration.payload)}`,
  );
}

async function ensureProject(token) {
  const list = expectOk(
    await api("GET", "/projects", { token }),
    "list projects",
  );
  const projects = list?.data?.projects ?? list?.data ?? [];
  const existing = Array.isArray(projects)
    ? projects.find((p) => p.name === PROJECT_NAME)
    : null;

  if (existing) {
    log(`project "${PROJECT_NAME}" already exists (${existing.id ?? existing._id})`);
    return existing.id ?? existing._id;
  }

  const created = expectOk(
    await api("POST", "/projects", {
      token,
      body: { name: PROJECT_NAME },
    }),
    "create project",
  );
  const project = created?.data?.project ?? created?.data;
  log(`created project "${PROJECT_NAME}" (${project.id ?? project._id})`);
  return project.id ?? project._id;
}

async function fetchDsn(token, projectId) {
  const res = expectOk(
    await api("GET", `/projects/${projectId}/dsn`, { token }),
    "fetch DSN",
  );
  const dsn = res?.data?.dsn ?? res?.dsn;
  if (!dsn) throw new Error(`DSN missing from response: ${JSON.stringify(res)}`);
  return dsn;
}

async function ensureCronMonitor(token, projectId) {
  const list = expectOk(
    await api("GET", `/monitors?projectId=${projectId}`, { token }),
    "list monitors",
  );
  const monitors = list?.data?.monitors ?? [];
  const existing = monitors.find((m) => m.name === "Nightly price check");
  if (existing) {
    log("cron monitor already exists (checkToken NOT re-printed - regenerate if lost)");
    return { id: existing.id ?? existing._id, checkToken: null };
  }

  const created = expectOk(
    await api("POST", "/monitors", {
      token,
      body: {
        projectId,
        name: "Nightly price check",
        scheduleType: "interval",
        intervalSeconds: 60,
        checkinMarginSeconds: 30,
      },
    }),
    "create cron monitor",
  );
  const monitor = created?.data?.monitor ?? created?.data;
  const checkToken = created?.data?.checkToken ?? monitor?.checkToken ?? null;
  log(`created cron monitor ${monitor.id ?? monitor._id}`);
  return { id: monitor.id ?? monitor._id, checkToken };
}

async function ensureUptimeMonitor(token, projectId) {
  const list = expectOk(
    await api("GET", `/uptime-monitors?projectId=${projectId}`, { token }),
    "list uptime monitors",
  );
  const monitors = list?.data?.uptimeMonitors ?? list?.data?.monitors ?? [];
  if (monitors.some((m) => m.name === "TripWire web")) {
    log("uptime monitor already exists");
    return;
  }

  expectOk(
    await api("POST", "/uptime-monitors", {
      token,
      body: {
        projectId,
        name: "TripWire web",
        url: UPTIME_URL,
        intervalSeconds: 60,
        consecutiveFailureThreshold: 3,
      },
    }),
    "create uptime monitor",
  );
  log(`created uptime monitor probing ${UPTIME_URL}`);
}

async function ensureDashboard(token, projectId) {
  const list = expectOk(
    await api("GET", "/dashboards", { token }),
    "list dashboards",
  );
  const dashboards = list?.data?.dashboards ?? [];
  if (dashboards.some((d) => d.name === "TripWire overview")) {
    log("dashboard already exists");
    return;
  }

  const day = 24 * 60;
  expectOk(
    await api("POST", "/dashboards", {
      token,
      body: {
        name: "TripWire overview",
        projectId,
        widgets: [
          {
            title: "Open issues (7d)",
            chartType: "stat",
            query: {
              dataset: "issues",
              aggregate: "count",
              filters: { projectId },
              timeWindowMinutes: 7 * day,
            },
            layout: { x: 0, y: 0, w: 4, h: 3 },
          },
          {
            title: "Requests (24h)",
            chartType: "stat",
            query: {
              dataset: "transactions",
              aggregate: "count",
              filters: { projectId },
              timeWindowMinutes: day,
            },
            layout: { x: 4, y: 0, w: 4, h: 3 },
          },
          {
            title: "p95 latency ms (24h)",
            chartType: "stat",
            query: {
              dataset: "transactions",
              aggregate: "p95_duration_ms",
              filters: { projectId },
              timeWindowMinutes: day,
            },
            layout: { x: 8, y: 0, w: 4, h: 3 },
          },
          {
            title: "Error logs (24h)",
            chartType: "stat",
            query: {
              dataset: "logs",
              aggregate: "count",
              filters: { projectId, level: "error" },
              timeWindowMinutes: day,
            },
            layout: { x: 0, y: 3, w: 4, h: 3 },
          },
        ],
      },
    }),
    "create dashboard",
  );
  log("created dashboard 'TripWire overview'");
}

async function ensureAlertRule(token, projectId) {
  const list = expectOk(
    await api("GET", "/alerts/rules", { token }),
    "list alert rules",
  );
  const rules = list?.data?.rules ?? [];
  if (rules.some((r) => r.name === "Booking error rate high")) {
    log("alert rule already exists");
    return;
  }

  const created = await api("POST", "/alerts/rules", {
    token,
    body: {
      name: "Booking error rate high",
      projectId,
      query: {
        dataset: "transactions",
        aggregate: "error_rate",
        filters: { projectId },
        timeWindowMinutes: 60,
      },
      thresholdType: "static",
      direction: "above",
      warningThreshold: 0.1,
      criticalThreshold: 0.25,
      resolveThreshold: 0.05,
      evaluationIntervalSeconds: 60,
      notificationActions: [],
    },
  });

  if (created.status >= 200 && created.status < 300) {
    log("created alert rule 'Booking error rate high'");
  } else {
    // Alert-rule schema is the most likely to drift - warn rather than
    // abort so the core demo (org/project/DSN) still completes.
    log(
      `WARNING: alert rule not created (HTTP ${created.status}): ${JSON.stringify(created.payload)} - create it from the UI if wanted`,
    );
  }
}

async function verifyDemoLogin() {
  const res = await api("POST", "/auth/demo-login");
  if (res.status === 200 && res.payload?.data?.accessToken) {
    const role = res.payload.data.membership?.role;
    log(`demo-login verified (role: ${role})`);
    if (role !== "viewer" && role !== "VIEWER") {
      log(`WARNING: expected a viewer role, got "${role}"`);
    }
    return;
  }
  if (res.status === 404) {
    log(
      "WARNING: demo-login answered 404 - set DEMO_LOGIN_ENABLED=true on auth-service and restart it",
    );
    return;
  }
  if (res.status === 429) {
    // The gateway's per-IP demo-login limit, not a provisioning problem -
    // easy to hit by re-running the seed. Nothing here is unverified
    // except the final round-trip.
    log(
      "demo-login is rate-limited from this IP right now - workspace is provisioned, skipping the round-trip check",
    );
    return;
  }
  log(
    `WARNING: demo-login verification failed: HTTP ${res.status} ${JSON.stringify(res.payload)}`,
  );
}

log(`gateway: ${GATEWAY}`);
await waitForGateway();

const auth = await registerOrLogin();
const token = auth.accessToken;

const projectId = await ensureProject(token);
const dsn = await fetchDsn(token, projectId);

const cron = await ensureCronMonitor(token, projectId);
await ensureUptimeMonitor(token, projectId);
await ensureDashboard(token, projectId);
await ensureAlertRule(token, projectId);
await verifyDemoLogin();

// Credentials go to a 0600 file, never stdout: the DSN is a bearer
// credential for event ingestion, the monitor checkToken lets the holder
// forge check-ins, and the admin password owns the demo org. Printing them
// would bake all three into CI job logs / container logs.
const lines = [
  `# CrashLens demo workspace - generated by scripts/seed-demo.mjs`,
  `# Contains live credentials. Not for version control.`,
  `CRASHLENS_DSN=${dsn}`,
  `CRASHLENS_GATEWAY_URL=${GATEWAY}`,
];

if (generatedPasswordWasUsed) {
  lines.push(
    `SEED_ADMIN_EMAIL=${ADMIN_EMAIL}`,
    `SEED_ADMIN_PASSWORD=${ADMIN_PASSWORD}`,
  );
}

if (cron.checkToken) {
  lines.push(
    `CRASHLENS_PRICECHECK_MONITOR_ID=${cron.id}`,
    `CRASHLENS_PRICECHECK_TOKEN=${cron.checkToken}`,
  );
}

const credentialsPath = path.resolve(
  process.env.SEED_CREDENTIALS_PATH || ".demo-credentials",
);
fs.writeFileSync(credentialsPath, `${lines.join("\n")}\n`, { mode: 0o600 });
fs.chmodSync(credentialsPath, 0o600); // in case the file already existed

console.log("\n----------------------------------------------------------");
console.log(`Demo workspace ready. Credentials written to:`);
console.log(`  ${credentialsPath}`);
if (generatedPasswordWasUsed) {
  console.log(
    "  (includes a generated admin password - store it, re-runs need it",
  );
  console.log("   as SEED_ADMIN_PASSWORD)");
}
console.log("Point the instrumented app at the CRASHLENS_* values in it.");
console.log("----------------------------------------------------------\n");
