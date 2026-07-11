const { test } = require("node:test");
const assert = require("node:assert/strict");
const errorHandler = require("../src/middleware/errorHandler");

// Regression test for the Module 1 P1 fix: errorHandler.js existed but was
// never required/wired into server.js - dead code. Now wired as the final
// middleware in app.js. This tests the handler itself in isolation.

test("errorHandler formats an error with a status into the expected JSON shape", () => {
  const err = Object.assign(new Error("nope"), { status: 418 });
  let statusCode;
  let body;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      body = payload;
      return this;
    },
  };

  errorHandler(err, {}, res, () => {});

  assert.equal(statusCode, 418);
  assert.equal(body.message, "nope");
});

test("errorHandler defaults to 500 when the error has no status", () => {
  const err = new Error("boom");
  let statusCode;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json() {
      return this;
    },
  };

  errorHandler(err, {}, res, () => {});

  assert.equal(statusCode, 500);
});
