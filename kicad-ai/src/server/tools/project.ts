import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SessionManager } from "../context.js";

export function registerProjectTools(server: McpServer, session: SessionManager): void {
  server.tool(
    "project.open",
    "Open a KiCad project and return its sheet structure",
    { path: z.string().describe("Absolute path to .kicad_pro file") },
    async ({ path }) => {
      const proj = session.getProject(path);
      return { content: [{ type: "text" as const, text: proj.describe() }] };
    },
  );

  server.tool(
    "project.describe",
    "Get a summary of the active project's sheet structure",
    { path: z.string().optional().describe("Path to .kicad_pro file (defaults to active project)") },
    async ({ path }) => {
      const proj = session.getProject(path);
      return { content: [{ type: "text" as const, text: proj.describe() }] };
    },
  );
}
