import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SessionManager } from "../context.js";

export function registerSchematicResources(server: McpServer, session: SessionManager): void {
  server.resource(
    "schematic-symbols",
    new ResourceTemplate("kicad://schematic/{path}/symbols", { list: undefined }),
    { description: "All symbols in a schematic", mimeType: "application/json" },
    async (uri, variables) => {
      const doc = session.getDocument(String(variables.path));
      const symbols = doc.getSymbols().map((s) => ({
        ref: s.ref, libraryId: s.libraryId, value: s.value,
        footprint: s.footprint, position: s.at,
      }));
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(symbols, null, 2) }] };
    },
  );

  server.resource(
    "schematic-nets",
    new ResourceTemplate("kicad://schematic/{path}/nets", { list: undefined }),
    { description: "All nets in a schematic", mimeType: "application/json" },
    async (uri, variables) => {
      const doc = session.getDocument(String(variables.path));
      const nets = doc.getNets().map((n) => ({
        name: n.name, isPower: n.isPower, pinCount: n.pins.length,
        pins: n.pins.map((p) => ({ ref: p.symbolRef, pin: p.pinId })),
      }));
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(nets, null, 2) }] };
    },
  );

  server.resource(
    "schematic-summary",
    new ResourceTemplate("kicad://schematic/{path}/summary", { list: undefined }),
    { description: "Human-readable schematic summary", mimeType: "text/plain" },
    async (uri, variables) => {
      const doc = session.getDocument(String(variables.path));
      return { contents: [{ uri: uri.href, mimeType: "text/plain", text: doc.describe() }] };
    },
  );
}
