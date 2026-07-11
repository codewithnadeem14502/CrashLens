const Joi = require("joi");
const { queryDefinitionSchema } = require("./query-validator");
const { MAX_WIDGETS_PER_DASHBOARD } = require("../models/dashboard-model");

const layoutSchema = Joi.object({
  x: Joi.number().integer().min(0).default(0),
  y: Joi.number().integer().min(0).default(0),
  w: Joi.number().integer().min(1).max(12).default(4),
  h: Joi.number().integer().min(1).max(12).default(3),
});

const widgetSchema = Joi.object({
  widgetId: Joi.string().max(64),
  title: Joi.string().max(120).required(),
  chartType: Joi.string().valid("stat").default("stat"),
  query: queryDefinitionSchema.required(),
  layout: layoutSchema.default(),
});

const objectIdSchema = Joi.string().hex().length(24);

const createDashboardSchema = {
  body: Joi.object({
    name: Joi.string().max(120).required(),
    projectId: objectIdSchema,
    widgets: Joi.array().items(widgetSchema).max(MAX_WIDGETS_PER_DASHBOARD).default([]),
  }),
};

const updateDashboardSchema = {
  params: Joi.object({ dashboardId: objectIdSchema.required() }),
  body: Joi.object({
    name: Joi.string().max(120),
    projectId: objectIdSchema.allow(null),
    widgets: Joi.array().items(widgetSchema).max(MAX_WIDGETS_PER_DASHBOARD),
  }).min(1),
};

const dashboardIdParamSchema = {
  params: Joi.object({ dashboardId: objectIdSchema.required() }),
};

const listDashboardsSchema = {
  query: Joi.object({
    projectId: objectIdSchema,
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
  }),
};

const executeQuerySchema = {
  body: Joi.object({
    query: queryDefinitionSchema.required(),
    thresholdType: Joi.string().valid("static", "percent_change").default("static"),
  }),
};

module.exports = {
  createDashboardSchema,
  updateDashboardSchema,
  dashboardIdParamSchema,
  listDashboardsSchema,
  executeQuerySchema,
};
