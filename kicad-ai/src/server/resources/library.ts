import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SessionManager } from "../context.js";

export function registerLibraryResources(server: McpServer, session: SessionManager): void {
  server.resource(
    "library-symbol",
    new ResourceTemplate("kicad://library/symbol/{libraryId}", { list: undefined }),
    { description: "Full pin and property details for a KiCad symbol", mimeType: "application/json" },
    async (uri, variables) => {
      const lib = session.getLibrary();
      const def = lib.resolve(String(variables.libraryId));
      const data = {
        libraryId: def.libraryId,
        name: def.name,
        isPower: def.isPower,
        pinCount: def.pins.length,
        pins: def.pins.map((p) => ({
          number: p.number, name: p.name, type: p.type,
          position: { x: p.x, y: p.y },
        })),
        properties: def.properties,
      };
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(data, null, 2) }] };
    },
  );
}
