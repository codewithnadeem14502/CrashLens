const mongoose = require("mongoose");
const Project = require("../models/project-model");
const logger = require("../utils/logger");
const { buildDsn, generateDsnPublicKey } = require("../utils/dsn");
const { redisClient } = require("../utils/redis");
const {
  publishProjectArchived,
  publishProjectCreated,
  publishProjectDsnRegenerated,
  publishProjectUpdated,
} = require("../events/project-events");
const {
  ApiError,
  DefaultEnvironment,
  ProjectEnvironments,
  ProjectStatus,
  asyncHandler,
  slugify,
} = require("../utils/constants");
const {
  validateCreateProjectPayload,
  validateSettings,
  validateUpdateProjectPayload,
} = require("../validators/project-validator");

const parsePositiveInteger = (value, fallback) => {
  const parsedValue = Number.parseInt(value, 10);

  return Number.isInteger(parsedValue) && parsedValue > 0
    ? parsedValue
    : fallback;
};

const PROJECT_DSN_CACHE_TTL_SECONDS = parsePositiveInteger(
  process.env.PROJECT_DSN_CACHE_TTL_SECONDS,
  300,
);
const PROJECT_CACHE_TTL_SECONDS = parsePositiveInteger(
  process.env.PROJECT_CACHE_TTL_SECONDS,
  120,
);

const serializeSettings = (settings) => {
  if (!settings) {
    return {};
  }

  if (settings instanceof Map) {
    return Object.fromEntries(settings);
  }

  return settings;
};

const sanitizeProject = (project) => ({
  id: project._id,
  organizationId: project.organizationId,
  name: project.name,
  slug: project.slug,
  environment: project.environment,
  status: project.status,
  settings: serializeSettings(project.settings),
  createdBy: project.createdBy,
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
  archivedAt: project.archivedAt,
});

const normalizeEnvironment = (environment) => {
  if (environment === undefined || environment === null || environment === "") {
    return DefaultEnvironment;
  }

  if (typeof environment !== "string") {
    throw new ApiError(400, "environment must be a string");
  }

  const normalized = environment.trim().toLowerCase();

  if (!Object.values(ProjectEnvironments).includes(normalized)) {
    throw new ApiError(
      400,
      `environment must be one of: ${Object.values(ProjectEnvironments).join(", ")}`,
    );
  }

  return normalized;
};

const ensureObjectId = (value, fieldName) => {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    throw new ApiError(400, `${fieldName} is invalid`);
  }
};

const findProjectForRequest = async ({ projectId, organizationId, includeDsn }) => {
  ensureObjectId(projectId, "projectId");

  const query = Project.findOne({
    _id: projectId,
    organizationId,
  });

  if (includeDsn) {
    query.select("+dsn +dsnPublicKey");
  }

  const project = await query;

  if (!project) {
    throw new ApiError(404, "Project not found");
  }

  return project;
};

const createUniqueProjectDsn = async (projectId) => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const dsnPublicKey = generateDsnPublicKey();
    const dsn = buildDsn({ publicKey: dsnPublicKey, projectId });
    const existingProject = await Project.exists({
      $or: [{ dsnPublicKey }, { dsn }],
    });

    if (!existingProject) {
      return { dsn, dsnPublicKey };
    }
  }

  throw new ApiError(500, "Unable to generate project DSN");
};

const getProjectDsnCacheKey = ({ organizationId, projectId }) =>
  `project-service:project-dsn:${organizationId}:${projectId}`;

const getProjectCacheKey = ({ organizationId, projectId }) =>
  `project-service:project:${organizationId}:${projectId}`;

const getProjectListCacheKey = ({ organizationId, includeArchived }) =>
  `project-service:project-list:${organizationId}:includeArchived=${includeArchived}`;

const buildProjectDsnPayload = (project) => ({
  projectId: project._id.toString(),
  dsn: project.dsn,
});

const canUseRedis = () => redisClient.status === "ready";

const readJsonCache = async ({ cacheKey, validator }) => {
  if (!canUseRedis()) {
    logger.debug(`Skipping cache read because Redis is ${redisClient.status}`);
    return null;
  }

  try {
    const cachedValue = await redisClient.get(cacheKey);

    if (!cachedValue) {
      return null;
    }

    const cachedPayload = JSON.parse(cachedValue);

    if (validator && !validator(cachedPayload)) {
      logger.warn(`Invalid cache payload found for key ${cacheKey}`);
      await redisClient.del(cacheKey);
      return null;
    }

    return cachedPayload;
  } catch (error) {
    logger.warn(`Failed to read cache key ${cacheKey}: ${error.message}`);
    return null;
  }
};

const writeJsonCache = async ({ cacheKey, payload, ttlSeconds }) => {
  if (!canUseRedis()) {
    logger.debug(`Skipping cache write because Redis is ${redisClient.status}`);
    return;
  }

  try {
    await redisClient.set(
      cacheKey,
      JSON.stringify(payload),
      "EX",
      ttlSeconds,
    );
  } catch (error) {
    logger.warn(`Failed to write cache key ${cacheKey}: ${error.message}`);
  }
};

const deleteCacheKeys = async (cacheKeys) => {
  if (!canUseRedis()) {
    logger.debug(`Skipping cache invalidation because Redis is ${redisClient.status}`);
    return;
  }

  try {
    await redisClient.del(...cacheKeys);
  } catch (error) {
    logger.warn(`Failed to invalidate cache keys: ${error.message}`);
  }
};

const isProjectDsnPayload = (payload) => payload.projectId && payload.dsn;

const isProjectPayload = (payload) => payload.project && payload.project.id;

const isProjectListPayload = (payload) => Array.isArray(payload.projects);

const writeProjectDsnCache = async ({ cacheKey, payload }) =>
  writeJsonCache({
    cacheKey,
    payload,
    ttlSeconds: PROJECT_DSN_CACHE_TTL_SECONDS,
  });

const invalidateProjectReadCaches = async ({ organizationId, projectId }) => {
  await deleteCacheKeys([
    getProjectDsnCacheKey({ organizationId, projectId }),
    getProjectCacheKey({ organizationId, projectId }),
    getProjectListCacheKey({ organizationId, includeArchived: true }),
    getProjectListCacheKey({ organizationId, includeArchived: false }),
  ]);
};

const createProject = asyncHandler(async (req, res) => {
  validateCreateProjectPayload(req.body);

  const organizationId = req.user.organizationId;
  const createdBy = req.user.sub;
  const name = req.body.name.trim();
  const slug = slugify(name);
  const environment = normalizeEnvironment(req.body.environment);
  const settings = req.body.settings || {};

  const existingProject = await Project.findOne({
    organizationId,
    slug,
  }).lean();

  if (existingProject) {
    throw new ApiError(409, "Project already exists in this organization");
  }

  const projectId = new mongoose.Types.ObjectId();
  const dsn = await createUniqueProjectDsn(projectId);

  const project = await Project.create({
    _id: projectId,
    organizationId,
    name,
    slug,
    environment,
    settings,
    dsn: dsn.dsn,
    dsnPublicKey: dsn.dsnPublicKey,
    createdBy,
  });

  logger.info(
    `Created project ${project._id} for organization ${organizationId} by user ${createdBy}`,
  );

  await invalidateProjectReadCaches({
    organizationId,
    projectId: project._id,
  });

  await publishProjectCreated(project);

  return res.status(201).json({
    success: true,
    message: "Project created successfully",
    data: {
      project: sanitizeProject(project),
      dsn: dsn.dsn,
    },
  });
});

const listProjects = asyncHandler(async (req, res) => {
  const includeArchived = req.query.includeArchived === "true";
  const cacheKey = getProjectListCacheKey({
    organizationId: req.user.organizationId,
    includeArchived,
  });
  const cachedProjectList = await readJsonCache({
    cacheKey,
    validator: isProjectListPayload,
  });

  if (cachedProjectList) {
    logger.info(`Returned cached project list for organization ${req.user.organizationId}`);

    return res.status(200).json({
      success: true,
      data: cachedProjectList,
    });
  }

  const filter = {
    organizationId: req.user.organizationId,
  };

  if (!includeArchived) {
    filter.status = ProjectStatus.ACTIVE;
  }

  const projects = await Project.find(filter).sort({ createdAt: -1 }).lean();
  const responsePayload = {
    projects: projects.map(sanitizeProject),
  };

  await writeJsonCache({
    cacheKey,
    payload: responsePayload,
    ttlSeconds: PROJECT_CACHE_TTL_SECONDS,
  });

  return res.status(200).json({
    success: true,
    data: responsePayload,
  });
});

const getProject = asyncHandler(async (req, res) => {
  ensureObjectId(req.params.projectId, "projectId");

  const cacheKey = getProjectCacheKey({
    organizationId: req.user.organizationId,
    projectId: req.params.projectId,
  });
  const cachedProject = await readJsonCache({
    cacheKey,
    validator: isProjectPayload,
  });

  if (cachedProject) {
    logger.info(`Returned cached project ${req.params.projectId}`);

    return res.status(200).json({
      success: true,
      data: cachedProject,
    });
  }

  const project = await findProjectForRequest({
    projectId: req.params.projectId,
    organizationId: req.user.organizationId,
    includeDsn: true,
  });
  const responsePayload = {
    project: sanitizeProject(project),
  };

  await writeJsonCache({
    cacheKey,
    payload: responsePayload,
    ttlSeconds: PROJECT_CACHE_TTL_SECONDS,
  });

  return res.status(200).json({
    success: true,
    data: responsePayload,
  });
});

const updateProject = asyncHandler(async (req, res) => {
  validateUpdateProjectPayload(req.body);

  const project = await findProjectForRequest({
    projectId: req.params.projectId,
    organizationId: req.user.organizationId,
    includeDsn: true,
  });

  if (project.status === ProjectStatus.ARCHIVED) {
    throw new ApiError(409, "Archived projects cannot be updated");
  }

  if (req.body.name !== undefined) {
    const name = req.body.name.trim();
    const slug = slugify(name);
    const existingProject = await Project.findOne({
      _id: { $ne: project._id },
      organizationId: req.user.organizationId,
      slug,
    }).lean();

    if (existingProject) {
      throw new ApiError(409, "Project already exists in this organization");
    }

    project.name = name;
    project.slug = slug;
  }

  if (req.body.environment !== undefined) {
    project.environment = normalizeEnvironment(req.body.environment);
  }

  if (req.body.settings !== undefined) {
    validateSettings(req.body.settings);
    project.settings = req.body.settings;
  }

  await project.save();
  await invalidateProjectReadCaches({
    organizationId: req.user.organizationId,
    projectId: project._id,
  });

  logger.info(`Updated project ${project._id} by user ${req.user.sub}`);

  await publishProjectUpdated(project);

  return res.status(200).json({
    success: true,
    message: "Project updated successfully",
    data: {
      project: sanitizeProject(project),
    },
  });
});

const archiveProject = asyncHandler(async (req, res) => {
  const project = await findProjectForRequest({
    projectId: req.params.projectId,
    organizationId: req.user.organizationId,
  });

  if (project.status === ProjectStatus.ARCHIVED) {
    return res.status(200).json({
      success: true,
      message: "Project already archived",
      data: {
        project: sanitizeProject(project),
      },
    });
  }

  project.status = ProjectStatus.ARCHIVED;
  project.archivedAt = new Date();
  project.archivedBy = req.user.sub;

  await project.save();
  await invalidateProjectReadCaches({
    organizationId: req.user.organizationId,
    projectId: project._id,
  });

  logger.info(`Archived project ${project._id} by user ${req.user.sub}`);

  await publishProjectArchived(project);

  return res.status(200).json({
    success: true,
    message: "Project archived successfully",
    data: {
      project: sanitizeProject(project),
    },
  });
});

const getProjectDsn = asyncHandler(async (req, res) => {
  ensureObjectId(req.params.projectId, "projectId");

  const cacheKey = getProjectDsnCacheKey({
    organizationId: req.user.organizationId,
    projectId: req.params.projectId,
  });
  const cachedProjectDsn = await readJsonCache({
    cacheKey,
    validator: isProjectDsnPayload,
  });

  if (cachedProjectDsn) {
    logger.info(`Returned cached DSN for project ${req.params.projectId}`);

    return res.status(200).json({
      success: true,
      data: cachedProjectDsn,
    });
  }

  const project = await findProjectForRequest({
    projectId: req.params.projectId,
    organizationId: req.user.organizationId,
    includeDsn: true,
  });
  const responsePayload = buildProjectDsnPayload(project);

  await writeProjectDsnCache({
    cacheKey,
    payload: responsePayload,
  });

  return res.status(200).json({
    success: true,
    data: responsePayload,
  });
});

const regenerateProjectDsn = asyncHandler(async (req, res) => {
  const project = await findProjectForRequest({
    projectId: req.params.projectId,
    organizationId: req.user.organizationId,
    includeDsn: true,
  });

  if (project.status === ProjectStatus.ARCHIVED) {
    throw new ApiError(409, "Cannot regenerate DSN for archived project");
  }

  const oldDsnPublicKey = project.dsnPublicKey;
  const dsn = await createUniqueProjectDsn(project._id);

  project.dsn = dsn.dsn;
  project.dsnPublicKey = dsn.dsnPublicKey;

  await project.save();
  await invalidateProjectReadCaches({
    organizationId: req.user.organizationId,
    projectId: project._id,
  });
  await writeProjectDsnCache({
    cacheKey: getProjectDsnCacheKey({
      organizationId: req.user.organizationId,
      projectId: project._id,
    }),
    payload: buildProjectDsnPayload(project),
  });

  logger.warn(`Regenerated DSN for project ${project._id} by user ${req.user.sub}`);

  await publishProjectDsnRegenerated({ project, oldDsnPublicKey });

  return res.status(200).json({
    success: true,
    message: "Project DSN regenerated successfully",
    data: {
      projectId: project._id,
      dsn: project.dsn,
    },
  });
});

module.exports = {
  archiveProject,
  createProject,
  getProject,
  getProjectDsn,
  listProjects,
  regenerateProjectDsn,
  updateProject,
};
