#!/usr/bin/env node
// PreToolUse guard: blocks file read/write/edit tools from touching .env files.
// Allows .env.example. Reads the hook JSON payload from stdin.
// Exit 2 = block the tool call; exit 0 = allow.

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    // If nothing is piped in, don't hang forever.
    if (process.stdin.isTTY) resolve("");
  });
}

// Collect every string value found anywhere inside a value.
function collectStrings(value, out) {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
  } else if (value && typeof value === "object") {
    for (const key of Object.keys(value)) collectStrings(value[key], out);
  }
}

// True if the string references a .env or .env.<anything> path, except .env.example.
function referencesSecretEnv(str) {
  // Match a path segment that is exactly ".env" or ".env.<suffix>".
  const re = /(^|[\/\\])\.env(\.[^\/\\]+)?/g;
  let match;
  while ((match = re.exec(str)) !== null) {
    const suffix = match[2]; // includes leading dot, e.g. ".local", or undefined for bare .env
    if (suffix === ".example") continue; // allowed
    return true;
  }
  return false;
}

async function main() {
  const raw = await readStdin();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    // No/invalid payload: nothing to inspect, allow.
    process.exit(0);
  }

  const toolInput = payload && payload.tool_input;
  if (!toolInput) process.exit(0);

  const strings = [];
  collectStrings(toolInput, strings);

  for (const s of strings) {
    if (referencesSecretEnv(s)) {
      process.stderr.write("Blocked: secret files are off limits to the agent\n");
      process.exit(2);
    }
  }

  process.exit(0);
}

main();
