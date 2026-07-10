const { normalizePath } = require("../utils/normalization");

const INTERNAL_FRAME_PATTERN =
  /\b(node:internal|internal\/|node_modules\/|bootstrap_node|Module\.)/i;

const STACK_FRAME_PATTERNS = [
  /^\s*at\s+(?<fn>.+?)\s+\((?<file>.+?):(?<line>\d+):(?<column>\d+)\)\s*$/,
  /^\s*at\s+(?<file>.+?):(?<line>\d+):(?<column>\d+)\s*$/,
];

const parseFrame = (line) => {
  for (const pattern of STACK_FRAME_PATTERNS) {
    const match = line.match(pattern);
    if (match?.groups) {
      return {
        function: match.groups.fn || "<anonymous>",
        file: normalizePath(match.groups.file),
        line: Number.parseInt(match.groups.line, 10),
        column: Number.parseInt(match.groups.column, 10),
      };
    }
  }

  return null;
};

const extractTopFrame = (stack) => {
  if (!stack || typeof stack !== "string") {
    return null;
  }

  const frames = stack
    .split("\n")
    .map(parseFrame)
    .filter(Boolean);

  return frames.find((frame) => !INTERNAL_FRAME_PATTERN.test(frame.file)) || null;
};

const buildCulprit = (topFrame) => {
  if (!topFrame) {
    return null;
  }

  return `${topFrame.function}:${topFrame.file}`;
};

module.exports = {
  buildCulprit,
  extractTopFrame,
};
