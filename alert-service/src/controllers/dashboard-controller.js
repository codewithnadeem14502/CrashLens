const crypto = require("node:crypto");
const { Dashboard } = require("../models/dashboard-model");
const { ApiError, asyncHandler } = require("../utils/constants");

const parsePagination = (query) => {
  const page = query.page || 1;
  const limit = query.limit || 20;
  return { page, limit, skip: (page - 1) * limit };
};

const sanitizeDashboard = (dashboard) => ({
  id: dashboard._id,
  organizationId: dashboard.organizationId,
  projectId: dashboard.projectId,
  name: dashboard.name,
  widgets: dashboard.widgets,
  createdBy: dashboard.createdBy,
  createdAt: dashboard.createdAt,
  updatedAt: dashboard.updatedAt,
});

// Server-assigned so the widget builder can reference a stable id for
// editing/deleting a single widget client-side without round-tripping to
// get one back first; a widget that already has one (an edit of an
// existing widget) keeps it.
const assignWidgetIds = (widgets = []) =>
  widgets.map((widget) => ({ ...widget, widgetId: widget.widgetId || crypto.randomUUID() }));

const findDashboardForRequest = async ({ dashboardId, organizationId }) => {
  const dashboard = await Dashboard.findOne({ _id: dashboardId, organizationId });

  if (!dashboard) {
    throw new ApiError(404, "Dashboard not found");
  }

  return dashboard;
};

const createDashboard = asyncHandler(async (req, res) => {
  const dashboard = await Dashboard.create({
    organizationId: req.user.organizationId,
    projectId: req.body.projectId,
    name: req.body.name,
    widgets: assignWidgetIds(req.body.widgets),
    createdBy: req.user.sub,
  });

  return res.status(201).json({ success: true, data: { dashboard: sanitizeDashboard(dashboard) } });
});

const listDashboards = asyncHandler(async (req, res) => {
  const filter = { organizationId: req.user.organizationId };

  if (req.query.projectId) {
    filter.projectId = req.query.projectId;
  }

  const { page, limit, skip } = parsePagination(req.query);

  const [dashboards, total] = await Promise.all([
    Dashboard.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Dashboard.countDocuments(filter),
  ]);

  return res.status(200).json({
    success: true,
    data: {
      dashboards: dashboards.map(sanitizeDashboard),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    },
  });
});

const getDashboard = asyncHandler(async (req, res) => {
  const dashboard = await findDashboardForRequest({
    dashboardId: req.params.dashboardId,
    organizationId: req.user.organizationId,
  });

  return res.status(200).json({ success: true, data: { dashboard: sanitizeDashboard(dashboard) } });
});

const updateDashboard = asyncHandler(async (req, res) => {
  const dashboard = await findDashboardForRequest({
    dashboardId: req.params.dashboardId,
    organizationId: req.user.organizationId,
  });

  if (req.body.name !== undefined) {
    dashboard.name = req.body.name;
  }

  if (req.body.projectId !== undefined) {
    dashboard.projectId = req.body.projectId;
  }

  if (req.body.widgets !== undefined) {
    dashboard.widgets = assignWidgetIds(req.body.widgets);
  }

  await dashboard.save();

  return res.status(200).json({ success: true, data: { dashboard: sanitizeDashboard(dashboard) } });
});

const deleteDashboard = asyncHandler(async (req, res) => {
  const dashboard = await findDashboardForRequest({
    dashboardId: req.params.dashboardId,
    organizationId: req.user.organizationId,
  });

  await dashboard.deleteOne();

  return res.status(200).json({ success: true, message: "Dashboard deleted" });
});

module.exports = {
  createDashboard,
  listDashboards,
  getDashboard,
  updateDashboard,
  deleteDashboard,
};
