const path = require("node:path");

const root = __dirname;
const logs = path.join(root, "logs");
const common = {
  // Resolve Node through the service PATH. Do not pin the child interpreter
  // to process.execPath, which can resolve differently from the executable
  // used by the service launcher on some VPS images.
  interpreter: "node",
  autorestart: true,
  watch: false,
  max_restarts: 10,
  min_uptime: "10s",
  restart_delay: 3000,
  kill_timeout: 10000,
  time: true,
  merge_logs: true,
  env_production: { NODE_ENV: "production" }
};

module.exports = {
  apps: [
    {
      ...common,
      name: "handelo-api",
      cwd: path.join(root, "apps/handelo-api"),
      script: "src/server.ts",
      node_args: "--env-file=../../.env --import tsx",
      max_memory_restart: "700M",
      out_file: path.join(logs, "handelo-api-out.log"),
      error_file: path.join(logs, "handelo-api-error.log")
    },
    {
      ...common,
      name: "handelo-telegram",
      cwd: path.join(root, "apps/handelo-telegram"),
      script: "src/index.ts",
      node_args: "--env-file=../../.env --import tsx",
      max_memory_restart: "250M",
      out_file: path.join(logs, "handelo-telegram-out.log"),
      error_file: path.join(logs, "handelo-telegram-error.log")
    },
    {
      ...common,
      name: "handelo-mcp-http",
      cwd: path.join(root, "packages/handelo-mcp"),
      script: "src/http.ts",
      node_args: "--env-file-if-exists=../../.env --import tsx",
      max_memory_restart: "300M",
      out_file: path.join(logs, "handelo-mcp-out.log"),
      error_file: path.join(logs, "handelo-mcp-error.log")
    }
  ]
};
