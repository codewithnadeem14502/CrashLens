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

const issueTokenPair = async ({
  user,
  membership,
  req,
  tokenFamilyId = null,
}) => {
  const permissions = RolePermissions[membership.role] || [];
  const accessToken = signAccessToken({
    user,
    membership,
    permissions,
  });
  const refreshToken = generateRefreshToken();

  const refreshTokenDoc = new RefreshToken({
    userId: user._id,
    organizationId: membership.organizationId,
    membershipId: membership._id,
    tokenHash: hashToken(refreshToken),
    expiresAt: getRefreshTokenExpiryDate(),
    createdByIp: req.ip,
    userAgent: req.get("user-agent"),
  });

  refreshTokenDoc.tokenFamilyId = tokenFamilyId || refreshTokenDoc._id;
  await refreshTokenDoc.save();

  return {
    accessToken,
    refreshToken,
    refreshTokenId: refreshTokenDoc._id,
    permissions,
  };
};

const getRefreshTokenFamilyFilter = (refreshTokenDoc) => {
  const familyId = refreshTokenDoc.tokenFamilyId || refreshTokenDoc._id;

  return {
    $or: [{ tokenFamilyId: familyId }, { _id: familyId }],
  };
};

const revokeRefreshTokenFamily = async ({ refreshTokenDoc, req, reason }) => {
  const now = new Date();
  const result = await RefreshToken.updateMany(
    getRefreshTokenFamilyFilter(refreshTokenDoc),
    {
      $set: {
        revokedAt: now,
        revokedByIp: req.ip,
        familyRevokedAt: now,
      },
    },
  );

  logger.warn(
    `Refresh token family revoked for user ${refreshTokenDoc.userId}: ${reason}. revoked=${result.modifiedCount}`,
  );
};

const createOrganizationWithAdmin = asyncHandler(async (req, res) => {
  const organizationName = req.body.organizationName;
  const adminPayload = {
    name: req.body.admin.name,
    email: req.body.admin.email,
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
      passwordHash: await hashPassword(adminPayload.password),
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
  const email = req.body.email;
  const organizationSlug = req.body.organizationSlug
    ? slugify(req.body.organizationSlug)
    : null;

  const user = await User.findOne({ email }).select("+passwordHash");

  if (!user || user.status !== AccountStatus.ACTIVE) {
    throw new ApiError(401, "Invalid email or password");
  }

  const passwordMatches = await verifyPassword(
    req.body.password,
    user.passwordHash,
  );

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
  if (req.user.organizationId !== req.params.organizationId) {
    throw new ApiError(403, "Permission denied for this organization");
  }

  const organization = await Organization.findById(req.params.organizationId);

  if (!organization) {
    throw new ApiError(404, "Organization not found");
  }

  const memberPayload = {
    name: req.body.name,
    email: req.body.email,
    password: req.body.password,
    role: req.body.role,
  };

  let user = await User.findOne({ email: memberPayload.email });

  if (!user) {
    user = await User.create({
      name: memberPayload.name,
      email: memberPayload.email,
      passwordHash: await hashPassword(memberPayload.password),
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

const updatePassword = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.sub).select("+passwordHash");

  if (!user || user.status !== AccountStatus.ACTIVE) {
    throw new ApiError(401, "Authentication session is no longer active");
  }

  const passwordMatches = await verifyPassword(
    req.body.currentPassword,
    user.passwordHash,
  );

  if (!passwordMatches) {
    throw new ApiError(401, "Current password is incorrect");
  }

  const passwordReused = await verifyPassword(
    req.body.newPassword,
    user.passwordHash,
  );

  if (passwordReused) {
    throw new ApiError(
      400,
      "New password must be different from current password",
    );
  }

  user.passwordHash = await hashPassword(req.body.newPassword);
  await user.save();

  await RefreshToken.updateMany(
    {
      userId: user._id,
      revokedAt: null,
    },
    {
      $set: {
        revokedAt: new Date(),
        revokedByIp: req.ip,
      },
    },
  );

  logger.info(`User ${user._id} updated password and revoked active sessions`);

  return res.status(200).json({
    success: true,
    message: "Password updated successfully. Please login again.",
  });
});

const updateOrganizationMemberRole = asyncHandler(async (req, res) => {
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

  const now = new Date();
  const tokenHash = hashToken(refreshToken);
  const existingToken = await RefreshToken.findOneAndUpdate(
    {
      tokenHash,
      revokedAt: null,
      familyRevokedAt: null,
      expiresAt: { $gt: now },
    },
    {
      $set: {
        revokedAt: now,
        revokedByIp: req.ip,
      },
    },
    { new: true },
  );

  if (!existingToken) {
    const rejectedToken = await RefreshToken.findOne({ tokenHash });

    if (!rejectedToken) {
      throw new ApiError(401, "Invalid refresh token");
    }

    if (rejectedToken.revokedAt) {
      await revokeRefreshTokenFamily({
        refreshTokenDoc: rejectedToken,
        req,
        reason: "revoked token reuse detected",
      });
      throw new ApiError(401, "Refresh token reuse detected");
    }

    if (rejectedToken.expiresAt <= now) {
      throw new ApiError(401, "Refresh token has expired");
    }

    throw new ApiError(401, "Invalid refresh token");
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

  let tokenPair;

  try {
    tokenPair = await issueTokenPair({
      user,
      membership,
      req,
      tokenFamilyId: existingToken.tokenFamilyId || existingToken._id,
    });
  } catch (error) {
    await RefreshToken.updateOne(
      {
        _id: existingToken._id,
        replacedByTokenId: null,
      },
      {
        $set: {
          revokedAt: null,
          revokedByIp: null,
        },
      },
    );
    throw error;
  }

  await RefreshToken.updateOne(
    { _id: existingToken._id },
    {
      $set: {
        replacedByTokenId: tokenPair.refreshTokenId,
      },
    },
  );

  const familyRoot = await RefreshToken.findById(
    existingToken.tokenFamilyId || existingToken._id,
  ).select("familyRevokedAt");

  if (familyRoot?.familyRevokedAt) {
    await revokeRefreshTokenFamily({
      refreshTokenDoc: existingToken,
      req,
      reason: "reuse detected during token rotation",
    });
    throw new ApiError(401, "Refresh token reuse detected");
  }

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
  updatePassword,
  login,
  refreshAccessToken,
  revokeRefreshToken,
  Permissions,
};
