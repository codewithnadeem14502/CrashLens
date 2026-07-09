const Joi = require("joi");
const { ApiError } = require("./constants");

const eventPayloadSchema = Joi.object({
  dsn: Joi.string().required(),
  event: Joi.object({
    type: Joi.string().valid("exception", "message").required(),
    message: Joi.string().trim().min(1).max(2000).required(),
    timestamp: Joi.date().iso().required(),
    errorName: Joi.string().trim().max(200).optional(),
    stack: Joi.string().max(20000).optional(),
    environment: Joi.string()
      .trim()
      .valid("development", "staging", "production")
      .optional(),
    release: Joi.string().trim().max(200).optional(),
    runtime: Joi.object({
      name: Joi.string().trim().max(100).optional(),
      version: Joi.string().trim().max(100).optional(),
    }).optional(),
    server: Joi.object({
      name: Joi.string().trim().max(200).optional(),
      hostname: Joi.string().trim().max(255).optional(),
    }).optional(),
    request: Joi.object({
      method: Joi.string().trim().max(20).optional(),
      url: Joi.string().trim().max(2048).optional(),
      headers: Joi.object().unknown(true).optional(),
      ip: Joi.string().trim().max(100).optional(),
    }).optional(),
  })
    .unknown(true)
    .required(),
});

const spanSchema = Joi.object({
  spanId: Joi.string().trim().max(200).optional(),
  parentSpanId: Joi.string().trim().max(200).optional(),
  op: Joi.string().trim().max(200).optional(),
  description: Joi.string().trim().max(1000).optional(),
  startTimestamp: Joi.date().iso().optional(),
  endTimestamp: Joi.date().iso().optional(),
  durationMs: Joi.number().min(0).max(60 * 60 * 1000).optional(),
  status: Joi.string().trim().max(100).optional(),
  data: Joi.object().unknown(true).optional(),
}).unknown(true);

const transactionPayloadSchema = Joi.object({
  dsn: Joi.string().required(),
  transaction: Joi.object({
    name: Joi.string().trim().max(500).optional(),
    method: Joi.string().trim().uppercase().max(20).required(),
    route: Joi.string().trim().max(2048).required(),
    url: Joi.string().trim().max(2048).optional(),
    durationMs: Joi.number().min(0).max(60 * 60 * 1000).required(),
    statusCode: Joi.number().integer().min(100).max(599).required(),
    timestamp: Joi.date().iso().required(),
    traceId: Joi.string().trim().max(200).optional(),
    spanId: Joi.string().trim().max(200).optional(),
    spans: Joi.array().items(spanSchema).max(200).optional(),
    environment: Joi.string()
      .trim()
      .valid("development", "staging", "production")
      .optional(),
    release: Joi.string().trim().max(200).optional(),
    tags: Joi.object().unknown(true).optional(),
  })
    .unknown(true)
    .required(),
});

const validateEventPayload = (payload) => {
  const { error, value } = eventPayloadSchema.validate(payload, {
    abortEarly: false,
    stripUnknown: false,
  });

  if (error) {
    throw new ApiError(
      400,
      "Invalid event payload",
      error.details.map((detail) => detail.message),
    );
  }

  return value;
};

const validateTransactionPayload = (payload) => {
  const { error, value } = transactionPayloadSchema.validate(payload, {
    abortEarly: false,
    stripUnknown: false,
  });

  if (error) {
    throw new ApiError(
      400,
      "Invalid transaction payload",
      error.details.map((detail) => detail.message),
    );
  }

  return value;
};

module.exports = {
  validateEventPayload,
  validateTransactionPayload,
};
