const UUID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const OBJECT_ID_PATTERN = /\b[0-9a-f]{24}\b/gi;
const LONG_HEX_PATTERN = /\b(?:0x)?[0-9a-f]{16,}\b/gi;
const NUMBER_PATTERN = /\b\d+(?:\.\d+)?\b/g;
const MULTI_SPACE_PATTERN = /\s+/g;

const normalizeMessage = (message) =>
  String(message || "")
    .trim()
    .replace(UUID_PATTERN, "<uuid>")
    .replace(OBJECT_ID_PATTERN, "<objectid>")
    .replace(LONG_HEX_PATTERN, "<hex>")
    .replace(NUMBER_PATTERN, "<num>")
    .replace(MULTI_SPACE_PATTERN, " ");

const normalizePath = (filePath) =>
  String(filePath || "")
    .replace(process.cwd(), "")
    .replace(/\\/g, "/")
    .replace(/:\d+:\d+$/, "")
    .replace(/:\d+$/, "");

module.exports = {
  normalizeMessage,
  normalizePath,
};
