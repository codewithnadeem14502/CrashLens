const { ApiError } = require("../utils/constants");

const validatePart = ({ schema, source, label }) => {
  if (!schema) {
    return null;
  }

  const { error, value } = schema.validate(source, {
    abortEarly: false,
    convert: true,
  });

  if (!error) {
    return { value };
  }

  return {
    error: new ApiError(
      400,
      `Invalid ${label}`,
      error.details.map((detail) => detail.message),
    ),
  };
};

const validateRequest = (schemas) => (req, res, next) => {
  const bodyResult = validatePart({
    schema: schemas.body,
    source: req.body,
    label: "request body",
  });

  if (bodyResult?.error) {
    return next(bodyResult.error);
  }

  const paramsResult = validatePart({
    schema: schemas.params,
    source: req.params,
    label: "request params",
  });

  if (paramsResult?.error) {
    return next(paramsResult.error);
  }

  const queryResult = validatePart({
    schema: schemas.query,
    source: req.query,
    label: "request query",
  });

  if (queryResult?.error) {
    return next(queryResult.error);
  }

  if (bodyResult) {
    req.body = bodyResult.value;
  }

  if (paramsResult) {
    req.params = paramsResult.value;
  }

  if (queryResult) {
    req.query = queryResult.value;
  }

  return next();
};

module.exports = validateRequest;
