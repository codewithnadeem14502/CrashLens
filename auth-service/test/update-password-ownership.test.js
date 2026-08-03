const { test } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const authValidation = require("../src/validators/auth-validator");

// Regression test for the account-takeover P0 found in the demo-login
// review: PATCH /api/auth/update-password used to accept
// { email, newPassword } with no proof of ownership at all, so anyone who
// knew an account's email address could set its password and sign in as
// that user. The route is still gateway-public (a signed-out user must be
// able to reach it), so `currentPassword` is the only thing standing
// between the internet and every account - it must stay required.
//
// Validator-level + route-level, no Mongo needed: the request must be
// rejected before it ever reaches a User lookup.
const app = require("../src/app");

test("the Joi schema requires currentPassword", () => {
  const { error } = authValidation.updatePassword.body.validate({
    email: "victim@example.com",
    newPassword: "NewPassw0rd",
  });

  assert.ok(error, "expected validation to fail without currentPassword");
  assert.match(error.message, /currentPassword/);
});

test("the Joi schema rejects an unknown field instead of ignoring it", () => {
  const { error } = authValidation.updatePassword.body.validate({
    email: "victim@example.com",
    currentPassword: "whatever",
    newPassword: "NewPassw0rd",
    role: "admin",
  });

  assert.ok(error, "expected unknown keys to be rejected");
});

test("PATCH /api/auth/update-password without currentPassword is a 400, not a password write", async () => {
  const res = await request(app)
    .patch("/api/auth/update-password")
    .send({ email: "victim@example.com", newPassword: "NewPassw0rd" });

  assert.equal(res.status, 400);
  assert.match(JSON.stringify(res.body), /currentPassword/);
});

test("a well-formed body still passes validation (the guard isn't over-tight)", () => {
  const { error } = authValidation.updatePassword.body.validate({
    email: "user@example.com",
    currentPassword: "OldPassw0rd",
    newPassword: "NewPassw0rd",
  });

  assert.equal(error, undefined);
});
