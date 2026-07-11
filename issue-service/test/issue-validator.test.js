const { test } = require("node:test");
const assert = require("node:assert/strict");
const { listIssues, listPerformanceEndpoints } = require("../src/validators/issue-validator");

// Regression tests for the Module 1 P0 fix: buildIssueFilter/
// buildPerformanceFilter in issue-controller.js used to copy
// query.errorName / query.release / query.search straight into a Mongoose
// filter with no type check, so `?errorName[$ne]=x` arrived as the object
// `{ $ne: "x" }` instead of a string. These schemas must reject that shape
// outright (Joi.string() fails type validation for a non-string value).

test("listIssues query schema rejects an operator-injection object for errorName", () => {
  const { error } = listIssues.query.validate({ errorName: { $ne: "x" } });
  assert.ok(error, "expected validation to fail for an object errorName");
});

test("listIssues query schema rejects an operator-injection object for release", () => {
  const { error } = listIssues.query.validate({ release: { $gt: "" } });
  assert.ok(error, "expected validation to fail for an object release");
});

test("listIssues query schema rejects an operator-injection object for search", () => {
  const { error } = listIssues.query.validate({ search: { $regex: ".*" } });
  assert.ok(error, "expected validation to fail for an object search");
});

test("listIssues query schema accepts well-formed plain-string values", () => {
  const { error, value } = listIssues.query.validate({
    errorName: "TypeError",
    release: "1.2.3",
    search: "cannot read property",
    status: "unresolved",
    severity: "high",
    environment: "production",
    page: "2",
    limit: "10",
  });

  assert.equal(error, undefined);
  assert.equal(value.errorName, "TypeError");
  // convert:true (applied by validateRequest) coerces page/limit to numbers
  assert.equal(value.page, 2);
});

test("listIssues query schema rejects unknown keys", () => {
  const { error } = listIssues.query.validate({ $where: "1==1" });
  assert.ok(error, "expected validation to fail for an unrecognized key");
});

test("performance query schema rejects an operator-injection object for release", () => {
  const { error } = listPerformanceEndpoints.query.validate({
    release: { $ne: null },
  });
  assert.ok(error, "expected validation to fail for an object release");
});
