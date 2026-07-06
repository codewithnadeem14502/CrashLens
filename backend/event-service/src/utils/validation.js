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

module.exports = {
  validateEventPayload,
};
