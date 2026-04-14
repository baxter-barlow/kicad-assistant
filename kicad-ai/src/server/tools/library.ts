import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SessionManager } from "../context.js";

export function registerLibraryTools(server: McpServer, session: SessionManager): void {
  server.tool(
    "lib.search",
    "Search KiCad symbol libraries by keyword (e.g. 'opamp', 'voltage regulator', 'STM32')",
    {
      query: z.string().describe("Search query"),
      limit: z.number().optional().default(10).describe("Max results (default 10)"),
    },
    async ({ query, limit }) => {
      const lib = session.getLibrary();
      const results = lib.search(query, limit);
      const rows = results.map((r) => ({
        libraryId: r.libraryId,
        name: r.name,
        description: r.description,
        keywords: r.keywords,
        pinCount: r.pinCount,
      }));
      return { content: [{ type: "text" as const, text: JSON.stringify(rows, null, 2) }] };
    },
  );

  server.tool(
    "lib.resolve",
    "Get full pin and property details for a symbol by library ID (e.g. Device:R, Amplifier_Operational:LM358)",
    {
      library_id: z.string().describe("Symbol library ID (e.g. Device:R)"),
    },
    async ({ library_id }) => {
      const lib = session.getLibrary();
      const def = lib.resolve(library_id);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            libraryId: def.libraryId,
            name: def.name,
            isPower: def.isPower,
            pinCount: def.pins.length,
            pins: def.pins.map((p) => ({
              number: p.number,
              name: p.name,
              type: p.type,
              position: { x: p.x, y: p.y },
            })),
            properties: def.properties,
          }, null, 2),
        }],
      };
    },
  );
}
