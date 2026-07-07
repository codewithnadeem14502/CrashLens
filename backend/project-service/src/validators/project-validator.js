const Joi = require("joi");

const { ApiError } = require("../utils/constants");

const MAX_SETTINGS_KEYS = 50;
const PROJECT_NAME_MIN_LENGTH = 2;
const PROJECT_NAME_MAX_LENGTH = 120;

const settingsSchema = Joi.object()
  .max(MAX_SETTINGS_KEYS)
  .messages({
    "object.base": "settings must be an object",
    "object.max": `settings cannot exceed ${MAX_SETTINGS_KEYS} keys`,
  });

const projectNameSchema = Joi.string()
  .trim()
  .min(PROJECT_NAME_MIN_LENGTH)
  .max(PROJECT_NAME_MAX_LENGTH)
  .messages({
    "any.required": "name must be at least 2 characters",
    "string.base": "name must be at least 2 characters",
    "string.empty": "name must be at least 2 characters",
    "string.min": "name must be at least 2 characters",
    "string.max": "name cannot exceed 120 characters",
  });

const createProjectSchema = Joi.object({
  name: projectNameSchema.required(),
  settings: settingsSchema,
}).unknown(true);

const updateProjectSchema = Joi.object({
  name: projectNameSchema,
  environment: Joi.any(),
  settings: settingsSchema,
})
  .min(1)
  .messages({
    "object.min": "at least one supported field is required",
  });

const getValidationErrors = (error) => {
  if (!error) {
    return [];
  }

  return error.details.map((detail) => {
    if (detail.type === "object.unknown") {
      return `${detail.context.key} cannot be updated`;
    }

    return detail.message;
  });
};

const validateSettings = (settings) => {
  if (settings === undefined) {
    return;
  }

  const { error } = settingsSchema.validate(settings, {
    abortEarly: false,
  });

  if (error) {
    throw new ApiError(400, getValidationErrors(error)[0]);
  }
};

const validateCreateProjectPayload = (payload) => {
  const { error } = createProjectSchema.validate(payload || {}, {
    abortEarly: false,
  });
  const errors = getValidationErrors(error);

  if (errors.length) {
    throw new ApiError(400, "Invalid project payload", errors);
  }
};

const validateUpdateProjectPayload = (payload) => {
  const { error } = updateProjectSchema.validate(payload || {}, {
    abortEarly: false,
    allowUnknown: false,
  });
  const errors = getValidationErrors(error);

  if (errors.length) {
    throw new ApiError(400, "Invalid project update payload", errors);
  }
};

module.exports = {
  validateCreateProjectPayload,
  validateSettings,
  validateUpdateProjectPayload,
};
