const mongoose = require("mongoose");
const Project = require("../models/project-model");
const logger = require("../utils/logger");
const { buildDsn, generateDsnPublicKey } = require("../utils/dsn");
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

const MAX_SETTINGS_KEYS = 50;

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

const isObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value);

const validateSettings = (settings) => {
  if (settings === undefined) {
    return;
  }

  if (!isObject(settings)) {
    throw new ApiError(400, "settings must be an object");
  }

  if (Object.keys(settings).length > MAX_SETTINGS_KEYS) {
    throw new ApiError(400, `settings cannot exceed ${MAX_SETTINGS_KEYS} keys`);
  }
};

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

const validateCreateProjectPayload = (payload) => {
  const errors = [];

  if (!payload.name || payload.name.trim().length < 2) {
    errors.push("name must be at least 2 characters");
  }

  if (payload.name && payload.name.trim().length > 120) {
    errors.push("name cannot exceed 120 characters");
  }

  if (payload.settings !== undefined && !isObject(payload.settings)) {
    errors.push("settings must be an object");
  }

  if (payload.settings && Object.keys(payload.settings).length > MAX_SETTINGS_KEYS) {
    errors.push(`settings cannot exceed ${MAX_SETTINGS_KEYS} keys`);
  }

  if (errors.length) {
    throw new ApiError(400, "Invalid project payload", errors);
  }
};

const validateUpdateProjectPayload = (payload) => {
  const allowedFields = new Set(["name", "environment", "settings"]);
  const suppliedFields = Object.keys(payload || {});
  const errors = [];

  if (!suppliedFields.length) {
    errors.push("at least one supported field is required");
  }

  suppliedFields.forEach((field) => {
    if (!allowedFields.has(field)) {
      errors.push(`${field} cannot be updated`);
    }
  });

  if (payload.name !== undefined) {
    if (typeof payload.name !== "string" || payload.name.trim().length < 2) {
      errors.push("name must be at least 2 characters");
    }

    if (typeof payload.name === "string" && payload.name.trim().length > 120) {
      errors.push("name cannot exceed 120 characters");
    }
  }

  if (payload.settings !== undefined && !isObject(payload.settings)) {
    errors.push("settings must be an object");
  }

  if (payload.settings && Object.keys(payload.settings).length > MAX_SETTINGS_KEYS) {
    errors.push(`settings cannot exceed ${MAX_SETTINGS_KEYS} keys`);
  }

  if (errors.length) {
    throw new ApiError(400, "Invalid project update payload", errors);
  }
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
  const filter = {
    organizationId: req.user.organizationId,
  };

  if (req.query.includeArchived !== "true") {
    filter.status = ProjectStatus.ACTIVE;
  }

  const projects = await Project.find(filter).sort({ createdAt: -1 }).lean();

  return res.status(200).json({
    success: true,
    data: {
      projects: projects.map(sanitizeProject),
    },
  });
});

const getProject = asyncHandler(async (req, res) => {
  const project = await findProjectForRequest({
    projectId: req.params.projectId,
    organizationId: req.user.organizationId,
    includeDsn: true,
  });

  return res.status(200).json({
    success: true,
    data: {
      project: sanitizeProject(project),
    },
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
  const project = await findProjectForRequest({
    projectId: req.params.projectId,
    organizationId: req.user.organizationId,
    includeDsn: true,
  });

  return res.status(200).json({
    success: true,
    data: {
      projectId: project._id,
      dsn: project.dsn,
    },
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
