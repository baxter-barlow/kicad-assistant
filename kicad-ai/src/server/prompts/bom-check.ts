import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SessionManager } from "../context.js";

export function registerBomCheckPrompt(server: McpServer, session: SessionManager): void {
  server.prompt(
    "bom-check",
    "Check all components for missing values or footprints and suggest completions",
    {
      path: z.string().optional().describe("Path to .kicad_sch file (defaults to active document)"),
    },
    async ({ path }) => {
      const doc = session.getDocument(path);
      const symbols = doc.getSymbols();

      const rows = symbols.map((s) => ({
        ref: s.ref,
        libraryId: s.libraryId,
        value: s.value ?? "(missing)",
        footprint: s.footprint ?? "(missing)",
      }));

      const missing = rows.filter((r) => r.value === "(missing)" || r.footprint === "(missing)");

      const table = rows
        .map((r) => `${r.ref}\t${r.libraryId}\t${r.value}\t${r.footprint}`)
        .join("\n");

      return {
        messages: [{
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Review the BOM for this schematic. ${missing.length} component(s) have missing values or footprints.\n\nRef\tLibrary ID\tValue\tFootprint\n${table}\n\nFor each component with a missing value or footprint:\n1. Suggest an appropriate value based on the library ID and circuit context\n2. Suggest a standard footprint (prefer 0805 for passives unless the design requires otherwise)\n3. Use sch.set_value and sch.set_footprint to apply the fixes`,
          },
        }],
      };
    },
  );
}
