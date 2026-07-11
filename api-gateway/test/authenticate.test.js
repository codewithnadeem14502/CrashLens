const { test } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-only-secret-do-not-use-in-real-deployments";
process.env.ACCESS_TOKEN_ISSUER =
  process.env.ACCESS_TOKEN_ISSUER || "crash-lens-auth-service";

const authenticate = require("../src/middleware/authenticate");

// Unit-level tests for the Module 1 P1 fix: the gateway previously had zero
// perimeter security (no JWT check at all). These exercise the middleware
// directly with mock req/res objects, no live HTTP/Redis/upstream needed.

const makeRes = () => {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
};

const validToken = () =>
  jwt.sign(
    {
      sub: "507f1f77bcf86cd799439099",
      organizationId: "507f1f77bcf86cd799439011",
      membershipId: "507f1f77bcf86cd799439022",
      role: "admin",
    },
    process.env.JWT_SECRET,
    { issuer: process.env.ACCESS_TOKEN_ISSUER },
  );

test("ingestion routes (/v1/events*) bypass JWT entirely, by design", () => {
  const req = { method: "POST", path: "/v1/events/transactions", headers: {} };
  const res = makeRes();
  let nextCalled = false;

  authenticate(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
});

test("public auth routes (login, register, refresh, logout) bypass JWT", () => {
  const publicRoutes = [
    { method: "POST", path: "/v1/auth/login" },
    { method: "POST", path: "/v1/auth/organizations" },
    { method: "POST", path: "/v1/auth/refresh-token" },
    { method: "POST", path: "/v1/auth/logout" },
  ];

  for (const route of publicRoutes) {
    const req = { ...route, headers: {} };
    const res = makeRes();
    let nextCalled = false;

    authenticate(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true, `expected ${route.method} ${route.path} to bypass JWT`);
  }
});

test("non-public /v1/auth routes still require a JWT", () => {
  const req = {
    method: "GET",
    path: "/v1/auth/organizations/507f1f77bcf86cd799439011",
    headers: {},
  };
  const res = makeRes();
  let nextCalled = false;

  authenticate(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test("monitor check-in ping routes (POST/PATCH) bypass JWT, by design", () => {
  const pingRoutes = [
    { method: "POST", path: "/v1/monitors/507f1f77bcf86cd799439011/checkins" },
    {
      method: "PATCH",
      path: "/v1/monitors/507f1f77bcf86cd799439011/checkins/507f1f77bcf86cd799439022",
    },
  ];

  for (const route of pingRoutes) {
    const req = { ...route, headers: {} };
    const res = makeRes();
    let nextCalled = false;

    authenticate(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true, `expected ${route.method} ${route.path} to bypass JWT`);
  }
});

test("GET on the check-in history path (dashboard view) still requires a JWT", () => {
  const req = {
    method: "GET",
    path: "/v1/monitors/507f1f77bcf86cd799439011/checkins",
    headers: {},
  };
  const res = makeRes();
  let nextCalled = false;

  authenticate(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test("/v1/monitors and /v1/uptime-monitors (non-checkin paths) require a JWT", () => {
  for (const path of ["/v1/monitors", "/v1/monitors/507f1f77bcf86cd799439011", "/v1/uptime-monitors"]) {
    const req = { method: "GET", path, headers: {} };
    const res = makeRes();
    let nextCalled = false;

    authenticate(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false, `expected ${path} to require a JWT`);
    assert.equal(res.statusCode, 401);
  }
});

test("/v1/projects and /v1/issues require a JWT", () => {
  for (const path of ["/v1/projects", "/v1/issues/507f1f77bcf86cd799439011"]) {
    const req = { method: "GET", path, headers: {} };
    const res = makeRes();
    let nextCalled = false;

    authenticate(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false, `expected ${path} to require a JWT`);
    assert.equal(res.statusCode, 401);
  }
});

test("rejects a missing Authorization header with 401", () => {
  const req = { method: "GET", path: "/v1/projects", headers: {} };
  const res = makeRes();

  authenticate(req, res, () => {
    throw new Error("next() should not be called");
  });

  assert.equal(res.statusCode, 401);
  assert.match(res.body.message, /token is required/);
});

test("rejects a malformed/invalid token with 401", () => {
  const req = {
    method: "GET",
    path: "/v1/projects",
    headers: { authorization: "Bearer not-a-real-token" },
  };
  const res = makeRes();

  authenticate(req, res, () => {
    throw new Error("next() should not be called");
  });

  assert.equal(res.statusCode, 401);
});

test("accepts a valid token, attaches req.user, and calls next()", () => {
  const req = {
    method: "GET",
    path: "/v1/projects",
    headers: { authorization: `Bearer ${validToken()}` },
  };
  const res = makeRes();
  let nextCalled = false;

  authenticate(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
  assert.equal(req.user.organizationId, "507f1f77bcf86cd799439011");
});

test("rejects a token missing required claims", () => {
  const incompleteToken = jwt.sign(
    { sub: "507f1f77bcf86cd799439099" }, // missing organizationId/membershipId/role
    process.env.JWT_SECRET,
    { issuer: process.env.ACCESS_TOKEN_ISSUER },
  );
  const req = {
    method: "GET",
    path: "/v1/projects",
    headers: { authorization: `Bearer ${incompleteToken}` },
  };
  const res = makeRes();

  authenticate(req, res, () => {
    throw new Error("next() should not be called");
  });

  assert.equal(res.statusCode, 401);
  assert.match(res.body.message, /claims/);
});
