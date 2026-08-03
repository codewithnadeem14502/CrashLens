const Joi = require("joi");

const { AssignableMemberRoles } = require("../utils/constants");

const objectId = Joi.string().hex().length(24);
const email = Joi.string().trim().lowercase().email().max(254);
const name = Joi.string().trim().min(2).max(80);
const password = Joi.string()
  .min(8)
  .max(128)
  .pattern(/[a-z]/, "lowercase letter")
  .pattern(/[A-Z]/, "uppercase letter")
  .pattern(/[0-9]/, "number")
  .messages({
    "any.required": "Password is required",
    "string.empty": "Password is required",
    "string.min": "Password must be at least 8 characters long",
    "string.max": "Password must be at most 128 characters long",
    "string.pattern.name": "Password must include at least one {#name}",
  });
const organizationName = Joi.string().trim().min(2).max(120);
const organizationSlug = Joi.string().trim().min(2).max(120);
const refreshToken = Joi.string().hex().length(128);

const organizationParams = Joi.object({
  organizationId: objectId.required(),
}).required();

const memberParams = Joi.object({
  organizationId: objectId.required(),
  memberId: objectId.required(),
}).required();

const createOrganizationWithAdmin = {
  body: Joi.object({
    organizationName: organizationName.required(),
    admin: Joi.object({
      name: name.required(),
      email: email.required(),
      password: password.required(),
    })
      .required()
      .unknown(false),
  })
    .required()
    .unknown(false),
};

const login = {
  body: Joi.object({
    email: email.required(),
    password: Joi.string().min(1).max(128).required(),
    organizationSlug: organizationSlug.optional(),
  })
    .required()
    .unknown(false),
};

// currentPassword is the ownership proof (see auth-controller.updatePassword)
// - typed loosely like login's password field, since it's verified against
// the stored hash rather than being newly created.
const updatePassword = {
  body: Joi.object({
    email: email.required(),
    currentPassword: Joi.string().min(1).max(128).required().messages({
      "any.required": "currentPassword is required",
      "string.empty": "currentPassword is required",
    }),
    newPassword: password.required().messages({
      "any.required": "newPassword is required",
      "string.empty": "newPassword is required",
    }),
  })
    .required()
    .unknown(false),
};

// demo-login reads nothing from the request - reject any body outright so
// that stays enforced rather than merely documented.
const demoLogin = {
  body: Joi.object({}).unknown(false),
};

const refreshTokenPayload = {
  body: Joi.object({
    refreshToken: refreshToken.required(),
  })
    .required()
    .unknown(false),
};

const createOrganizationMember = {
  params: organizationParams,
  body: Joi.object({
    name: name.required(),
    email: email.required(),
    password: password.required(),
    role: Joi.string()
      .valid(...AssignableMemberRoles)
      .required(),
  })
    .required()
    .unknown(false),
};

const updateOrganizationMemberRole = {
  params: memberParams,
  body: Joi.object({
    role: Joi.string()
      .valid(...AssignableMemberRoles)
      .required(),
  })
    .required()
    .unknown(false),
};

const deleteOrganizationMember = {
  params: memberParams,
};

const getOrganization = {
  params: organizationParams,
};

const getOrganizationMembers = {
  params: organizationParams,
};

module.exports = {
  createOrganizationWithAdmin,
  createOrganizationMember,
  deleteOrganizationMember,
  getOrganization,
  getOrganizationMembers,
  login,
  demoLogin,
  refreshTokenPayload,
  updatePassword,
  updateOrganizationMemberRole,
};
