import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SessionManager } from "../context.js";
import { registerSchematicResources } from "./schematic.js";
import { registerActiveResources } from "./active.js";
import { registerLibraryResources } from "./library.js";

export function registerAllResources(server: McpServer, session: SessionManager): void {
  registerSchematicResources(server, session);
  registerActiveResources(server, session);
  registerLibraryResources(server, session);
}
