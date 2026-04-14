#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SessionManager } from "./context.js";
import { registerAllTools } from "./tools/index.js";
import { registerAllResources } from "./resources/index.js";
import { registerAllPrompts } from "./prompts/index.js";

const server = new McpServer({
  name: "kicad-ai",
  version: "0.2.0",
});

const session = new SessionManager();

registerAllTools(server, session);
registerAllResources(server, session);
registerAllPrompts(server, session);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("[kicad-ai] fatal:", err);
  process.exit(1);
});
