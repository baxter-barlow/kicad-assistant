import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SessionManager } from "../context.js";

export function registerActiveResources(server: McpServer, session: SessionManager): void {
  server.resource(
    "active-symbols",
    "kicad://active/symbols",
    { description: "Symbols in the active schematic (requires set_context)", mimeType: "application/json" },
    async (uri) => {
      const doc = session.getDocument();
      const symbols = doc.getSymbols().map((s) => ({
        ref: s.ref, libraryId: s.libraryId, value: s.value,
        footprint: s.footprint, position: s.at,
      }));
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(symbols, null, 2) }] };
    },
  );

  server.resource(
    "active-nets",
    "kicad://active/nets",
    { description: "Nets in the active schematic (requires set_context)", mimeType: "application/json" },
    async (uri) => {
      const doc = session.getDocument();
      const nets = doc.getNets().map((n) => ({
        name: n.name, isPower: n.isPower, pinCount: n.pins.length,
        pins: n.pins.map((p) => ({ ref: p.symbolRef, pin: p.pinId })),
      }));
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(nets, null, 2) }] };
    },
  );

  server.resource(
    "active-summary",
    "kicad://active/summary",
    { description: "Summary of the active schematic (requires set_context)", mimeType: "text/plain" },
    async (uri) => {
      const doc = session.getDocument();
      return { contents: [{ uri: uri.href, mimeType: "text/plain", text: doc.describe() }] };
    },
  );
}
