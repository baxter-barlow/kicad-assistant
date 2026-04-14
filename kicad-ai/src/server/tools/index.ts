import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SessionManager } from "../context.js";
import { registerContextTools } from "./context.js";
import { registerSchematicReadTools } from "./schematic-read.js";
import { registerSchematicWriteTools } from "./schematic-write.js";
import { registerSchematicIoTools } from "./schematic-io.js";
import { registerSchematicGenTools } from "./schematic-gen.js";
import { registerLibraryTools } from "./library.js";
import { registerProjectTools } from "./project.js";

export function registerAllTools(server: McpServer, session: SessionManager): void {
  registerContextTools(server, session);
  registerSchematicReadTools(server, session);
  registerSchematicWriteTools(server, session);
  registerSchematicIoTools(server, session);
  registerSchematicGenTools(server, session);
  registerLibraryTools(server, session);
  registerProjectTools(server, session);
}
