import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SessionManager } from "../context.js";

export function registerContextTools(server: McpServer, session: SessionManager): void {
  server.tool(
    "set_context",
    "Update the active KiCad context (called by the assistant panel on project/document changes)",
    {
      kind: z.enum(["manager", "schematic", "pcb"]).describe("Which KiCad application is active"),
      has_project: z.boolean().describe("Whether a project is loaded"),
      project_name: z.string().optional().default("").describe("Project name"),
      project_path: z.string().optional().default("").describe("Absolute path to .kicad_pro file"),
      document_path: z.string().optional().default("").describe("Absolute path to active .kicad_sch or .kicad_pcb"),
      workspace_path: z.string().optional().default("").describe("Directory containing project files"),
    },
    async ({ kind, has_project, project_name, project_path, document_path, workspace_path }) => {
      session.updateContext({
        kind,
        hasProject: has_project,
        projectName: project_name,
        projectPath: project_path,
        documentPath: document_path,
        workspacePath: workspace_path,
      });
      return {
        content: [{
          type: "text" as const,
          text: `Context updated: ${kind} ${project_name ? `(${project_name})` : ""} ${document_path || "no document"}`,
        }],
      };
    },
  );
}
