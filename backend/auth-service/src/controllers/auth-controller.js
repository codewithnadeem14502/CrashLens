const User = require("../models/user-model");
const Organization = require("../models/organization-model");
const Membership = require("../models/membership-model");
const RefreshToken = require("../models/refresh-token-model");
const logger = require("../utils/logger");
const { hashPassword, verifyPassword } = require("../utils/password");
const {
  generateRefreshToken,
  getRefreshTokenExpiryDate,
  hashToken,
  signAccessToken,
} = require("../utils/tokens");
const {
  MembershipStatus,
  AccountStatus,
  AssignableMemberRoles,
  Permissions,
  RolePermissions,
  Roles,
  ApiError,
  asyncHandler,
  slugify,
} = require("../utils/constants");

const sanitizeUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  status: user.status,
  createdAt: user.createdAt,
});

const sanitizeOrganization = (organization) => ({
  id: organization._id,
  name: organization.name,
  slug: organization.slug,
  status: organization.status,
  createdBy: organization.createdBy,
  createdAt: organization.createdAt,
});

const sanitizeMembership = (membership, permissions) => ({
  id: membership._id,
  organizationId: membership.organizationId,
  role: membership.role,
  status: membership.status,
  permissions,
  joinedAt: membership.joinedAt,
});

const issueTokenPair = async ({ user, membership, req }) => {
  const permissions = RolePermissions[membership.role] || [];
  const accessToken = signAccessToken({
    user,
    membership,
    permissions,
  });
  const refreshToken = generateRefreshToken();

  const refreshTokenDoc = await RefreshToken.create({
    userId: user._id,
    organizationId: membership.organizationId,
    membershipId: membership._id,
    tokenHash: hashToken(refreshToken),
    expiresAt: getRefreshTokenExpiryDate(),
    createdByIp: req.ip,
    userAgent: req.get("user-agent"),
  });

  return {
    accessToken,
    refreshToken,
    refreshTokenId: refreshTokenDoc._id,
    permissions,
  };
};

const validateLoginPayload = (payload) => {
  const errors = [];

  if (!payload.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
    errors.push("email must be a valid email address");
  }

  if (!payload.password) {
    errors.push("password is required");
  }

  if (payload.organizationSlug && typeof payload.organizationSlug !== "string") {
    errors.push("organizationSlug must be a string");
  }

  if (errors.length) {
    throw new ApiError(400, "Invalid login payload", errors);
  }
};

const validateCreateMemberPayload = (payload) => {
  const errors = [];

  if (!payload.name || payload.name.trim().length < 2) {
    errors.push("name must be at least 2 characters");
  }

  if (!payload.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
    errors.push("email must be a valid email address");
  }

  if (!payload.password || payload.password.length < 8) {
    errors.push("password must be at least 8 characters");
  }

  if (!AssignableMemberRoles.includes(payload.role)) {
    errors.push(`role must be one of: ${AssignableMemberRoles.join(", ")}`);
  }

  if (errors.length) {
    throw new ApiError(400, "Invalid member payload", errors);
  }
};

const validateUpdateMemberRolePayload = (payload) => {
  const errors = [];

  if (!AssignableMemberRoles.includes(payload.role)) {
    errors.push(`role must be one of: ${AssignableMemberRoles.join(", ")}`);
  }

  if (errors.length) {
    throw new ApiError(400, "Invalid member role payload", errors);
  }
};

const validateOrganizationAdminPayload = (payload) => {
  const errors = [];
  const organizationName = payload.organizationName;
  const admin = payload.admin || {};

  if (!organizationName || organizationName.trim().length < 2) {
    errors.push("organizationName must be at least 2 characters");
  }

  if (!admin.name || admin.name.trim().length < 2) {
    errors.push("admin.name must be at least 2 characters");
  }

  if (!admin.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(admin.email)) {
    errors.push("admin.email must be a valid email address");
  }

  if (!admin.password || admin.password.length < 8) {
    errors.push("admin.password must be at least 8 characters");
  }

  if (errors.length) {
    throw new ApiError(400, "Invalid organization admin payload", errors);
  }
};

const createOrganizationWithAdmin = asyncHandler(async (req, res) => {
  validateOrganizationAdminPayload(req.body);

  const organizationName = req.body.organizationName.trim();
  const adminPayload = {
    name: req.body.admin.name.trim(),
    email: req.body.admin.email.trim().toLowerCase(),
    password: req.body.admin.password,
  };
  const organizationSlug = slugify(organizationName);

  const existingOrganization = await Organization.findOne({
    slug: organizationSlug,
  }).lean();

  if (existingOrganization) {
    throw new ApiError(409, "Organization already exists");
  }

  const existingUser = await User.findOne({ email: adminPayload.email }).lean();

  if (existingUser) {
    throw new ApiError(409, "Admin email is already registered");
  }

  let createdUser;
  let createdOrganization;
  let createdMembership;

  try {
    createdUser = await User.create({
      name: adminPayload.name,
      email: adminPayload.email,
      passwordHash: hashPassword(adminPayload.password),
    });

    createdOrganization = await Organization.create({
      name: organizationName,
      slug: organizationSlug,
      createdBy: createdUser._id,
    });

    createdMembership = await Membership.create({
      organizationId: createdOrganization._id,
      userId: createdUser._id,
      role: Roles.ADMIN,
    });
  } catch (error) {
    if (createdMembership) {
      await Membership.deleteOne({ _id: createdMembership._id });
    }

    if (createdOrganization) {
      await Organization.deleteOne({ _id: createdOrganization._id });
    }

    if (createdUser) {
      await User.deleteOne({ _id: createdUser._id });
    }

    throw error;
  }

  const tokenPair = await issueTokenPair({
    user: createdUser,
    membership: createdMembership,
    req,
  });

  logger.info(
    `Created organization ${createdOrganization._id} with admin ${createdUser._id}`,
  );

  return res.status(201).json({
    success: true,
    message: "Organization and admin created successfully",
    data: {
      user: sanitizeUser(createdUser),
      organization: sanitizeOrganization(createdOrganization),
      membership: {
        id: createdMembership._id,
        role: createdMembership.role,
        permissions: tokenPair.permissions,
      },
      accessToken: tokenPair.accessToken,
      refreshToken: tokenPair.refreshToken,
    },
  });
});

const login = asyncHandler(async (req, res) => {
  validateLoginPayload(req.body);

  const email = req.body.email.trim().toLowerCase();
  const organizationSlug = req.body.organizationSlug
    ? slugify(req.body.organizationSlug)
    : null;

  const user = await User.findOne({ email }).select("+passwordHash");

  if (!user || user.status !== AccountStatus.ACTIVE) {
    throw new ApiError(401, "Invalid email or password");
  }

  const passwordMatches = verifyPassword(req.body.password, user.passwordHash);

  if (!passwordMatches) {
    logger.warn(`Failed login attempt for email ${email}`);
    throw new ApiError(401, "Invalid email or password");
  }

  let organizationFilter = {};

  if (organizationSlug) {
    const organization = await Organization.findOne({
      slug: organizationSlug,
    }).lean();

    if (!organization) {
      throw new ApiError(401, "Invalid email or password");
    }

    organizationFilter = { organizationId: organization._id };
  }

  const memberships = await Membership.find({
    userId: user._id,
    status: MembershipStatus.ACTIVE,
    ...organizationFilter,
  }).sort({ createdAt: 1 });

  if (!memberships.length) {
    throw new ApiError(401, "Invalid email or password");
  }

  if (!organizationSlug && memberships.length > 1) {
    throw new ApiError(409, "organizationSlug is required for this account");
  }

  const membership = memberships[0];
  const tokenPair = await issueTokenPair({ user, membership, req });

  logger.info(`User ${user._id} logged in for organization ${membership.organizationId}`);

  return res.status(200).json({
    success: true,
    message: "Login successful",
    data: {
      user: sanitizeUser(user),
      membership: sanitizeMembership(membership, tokenPair.permissions),
      accessToken: tokenPair.accessToken,
      refreshToken: tokenPair.refreshToken,
    },
  });
});

const createOrganizationMember = asyncHandler(async (req, res) => {
  validateCreateMemberPayload(req.body);

  if (req.user.organizationId !== req.params.organizationId) {
    throw new ApiError(403, "Permission denied for this organization");
  }

  const organization = await Organization.findById(req.params.organizationId);

  if (!organization) {
    throw new ApiError(404, "Organization not found");
  }

  const memberPayload = {
    name: req.body.name.trim(),
    email: req.body.email.trim().toLowerCase(),
    password: req.body.password,
    role: req.body.role,
  };

  let user = await User.findOne({ email: memberPayload.email });

  if (!user) {
    user = await User.create({
      name: memberPayload.name,
      email: memberPayload.email,
      passwordHash: hashPassword(memberPayload.password),
    });
  }

  const existingMembership = await Membership.findOne({
    organizationId: organization._id,
    userId: user._id,
  });

  if (existingMembership && existingMembership.status === MembershipStatus.ACTIVE) {
    throw new ApiError(409, "User is already an active organization member");
  }

  let membership;

  if (existingMembership) {
    existingMembership.role = memberPayload.role;
    existingMembership.status = MembershipStatus.ACTIVE;
    existingMembership.joinedAt = new Date();
    membership = await existingMembership.save();
  } else {
    membership = await Membership.create({
      organizationId: organization._id,
      userId: user._id,
      role: memberPayload.role,
    });
  }

  const permissions = RolePermissions[membership.role] || [];

  logger.info(
    `Admin ${req.user.sub} created ${membership.role} member ${user._id} in organization ${organization._id}`,
  );

  return res.status(201).json({
    success: true,
    message: "Organization member created successfully",
    data: {
      user: sanitizeUser(user),
      membership: sanitizeMembership(membership, permissions),
    },
  });
});

const updateOrganizationMemberRole = asyncHandler(async (req, res) => {
  validateUpdateMemberRolePayload(req.body);

  if (req.user.organizationId !== req.params.organizationId) {
    throw new ApiError(403, "Permission denied for this organization");
  }

  if (req.user.role !== Roles.ADMIN) {
    throw new ApiError(403, "Only admin members can update roles");
  }

  if (req.user.membershipId === req.params.memberId) {
    throw new ApiError(403, "Admin cannot update their own role");
  }

  const membership = await Membership.findOne({
    _id: req.params.memberId,
    organizationId: req.params.organizationId,
    status: MembershipStatus.ACTIVE,
  });

  if (!membership) {
    throw new ApiError(404, "Organization member not found");
  }

  if (!AssignableMemberRoles.includes(membership.role)) {
    throw new ApiError(403, "Only developer and viewer roles can be updated");
  }

  const previousRole = membership.role;

  if (previousRole === req.body.role) {
    return res.status(200).json({
      success: true,
      message: "Organization member role already matches requested role",
      data: {
        membership: sanitizeMembership(
          membership,
          RolePermissions[membership.role] || [],
        ),
      },
    });
  }

  membership.role = req.body.role;
  await membership.save();

  await RefreshToken.updateMany(
    {
      membershipId: membership._id,
      organizationId: membership.organizationId,
      revokedAt: null,
    },
    {
      $set: {
        revokedAt: new Date(),
        revokedByIp: req.ip,
      },
    },
  );

  logger.info(
    `Admin ${req.user.sub} updated member ${membership.userId} role from ${previousRole} to ${membership.role} in organization ${membership.organizationId}`,
  );

  return res.status(200).json({
    success: true,
    message: "Organization member role updated successfully",
    data: {
      membership: sanitizeMembership(
        membership,
        RolePermissions[membership.role] || [],
      ),
    },
  });
});

const deleteOrganizationMember = asyncHandler(async (req, res) => {
  if (req.user.organizationId !== req.params.organizationId) {
    throw new ApiError(403, "Permission denied for this organization");
  }

  const membership = await Membership.findOne({
    _id: req.params.memberId,
    organizationId: req.params.organizationId,
    status: MembershipStatus.ACTIVE,
  });

  if (!membership) {
    throw new ApiError(404, "Organization member not found");
  }

  if (!AssignableMemberRoles.includes(membership.role)) {
    throw new ApiError(403, "Only developer and viewer members can be deleted");
  }

  membership.status = MembershipStatus.REMOVED;
  await membership.save();

  await RefreshToken.updateMany(
    {
      membershipId: membership._id,
      organizationId: membership.organizationId,
      revokedAt: null,
    },
    {
      $set: {
        revokedAt: new Date(),
        revokedByIp: req.ip,
      },
    },
  );

  logger.info(
    `Admin ${req.user.sub} removed ${membership.role} member ${membership.userId} from organization ${membership.organizationId}`,
  );

  return res.status(200).json({
    success: true,
    message: "Organization member deleted successfully",
  });
});

const refreshAccessToken = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    throw new ApiError(400, "refreshToken is required");
  }

  const existingToken = await RefreshToken.findOne({
    tokenHash: hashToken(refreshToken),
  });

  if (!existingToken) {
    throw new ApiError(401, "Invalid refresh token");
  }

  if (existingToken.revokedAt) {
    throw new ApiError(401, "Refresh token has been revoked");
  }

  if (existingToken.expiresAt <= new Date()) {
    throw new ApiError(401, "Refresh token has expired");
  }

  const [user, membership] = await Promise.all([
    User.findById(existingToken.userId),
    Membership.findById(existingToken.membershipId),
  ]);

  if (
    !user ||
    user.status !== AccountStatus.ACTIVE ||
    !membership ||
    membership.status !== MembershipStatus.ACTIVE
  ) {
    throw new ApiError(401, "Refresh token session is no longer active");
  }

  const tokenPair = await issueTokenPair({ user, membership, req });

  existingToken.revokedAt = new Date();
  existingToken.revokedByIp = req.ip;
  existingToken.replacedByTokenId = tokenPair.refreshTokenId;
  await existingToken.save();

  logger.info(`Refresh token rotated for user ${user._id}`);

  return res.status(200).json({
    success: true,
    message: "Token refreshed successfully",
    data: {
      accessToken: tokenPair.accessToken,
      refreshToken: tokenPair.refreshToken,
    },
  });
});

const revokeRefreshToken = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    throw new ApiError(400, "refreshToken is required");
  }

  const existingToken = await RefreshToken.findOne({
    tokenHash: hashToken(refreshToken),
  });

  if (existingToken && !existingToken.revokedAt) {
    existingToken.revokedAt = new Date();
    existingToken.revokedByIp = req.ip;
    await existingToken.save();
    logger.info(`Refresh token revoked for user ${existingToken.userId}`);
  }

  return res.status(200).json({
    success: true,
    message: "Refresh token revoked successfully",
  });
});

const getOrganization = asyncHandler(async (req, res) => {
  const organization = await Organization.findById(
    req.params.organizationId,
  ).lean();

  if (!organization) {
    throw new ApiError(404, "Organization not found");
  }

  if (req.user.organizationId !== organization._id.toString()) {
    throw new ApiError(403, "Permission denied for this organization");
  }

  return res.status(200).json({
    success: true,
    data: {
      organization: sanitizeOrganization(organization),
    },
  });
});

const getOrganizationMembers = asyncHandler(async (req, res) => {
  if (req.user.organizationId !== req.params.organizationId) {
    throw new ApiError(403, "Permission denied for this organization");
  }

  const memberships = await Membership.find({
    organizationId: req.params.organizationId,
    status: MembershipStatus.ACTIVE,
  })
    .populate("userId", "name email status createdAt")
    .sort({ createdAt: 1 })
    .lean();

  return res.status(200).json({
    success: true,
    data: {
      members: memberships.map((membership) => ({
        id: membership._id,
        role: membership.role,
        joinedAt: membership.joinedAt,
        user: {
          id: membership.userId._id,
          name: membership.userId.name,
          email: membership.userId.email,
          status: membership.userId.status,
          createdAt: membership.userId.createdAt,
        },
      })),
    },
  });
});

module.exports = {
  createOrganizationWithAdmin,
  createOrganizationMember,
  deleteOrganizationMember,
  getOrganization,
  getOrganizationMembers,
  updateOrganizationMemberRole,
  login,
  refreshAccessToken,
  revokeRefreshToken,
  Permissions,
};
