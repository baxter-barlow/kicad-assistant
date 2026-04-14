import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SessionManager } from "../context.js";

const optPath = z.string().optional().describe("Path to .kicad_sch file (defaults to active document)");

export function registerSchematicReadTools(server: McpServer, session: SessionManager): void {
  server.tool(
    "sch.open",
    "Open a KiCad schematic file and return a summary of its contents",
    { path: z.string().describe("Absolute path to .kicad_sch file") },
    async ({ path }) => {
      const doc = session.getDocument(path);
      return { content: [{ type: "text" as const, text: doc.describe() }] };
    },
  );

  server.tool(
    "sch.describe",
    "Get a human-readable summary of a schematic's contents",
    { path: optPath },
    async ({ path }) => {
      const doc = session.getDocument(path);
      return { content: [{ type: "text" as const, text: doc.describe() }] };
    },
  );

  server.tool(
    "sch.list_symbols",
    "List all symbols with their references, values, footprints, and positions",
    { path: optPath },
    async ({ path }) => {
      const doc = session.getDocument(path);
      const symbols = doc.getSymbols();
      const rows = symbols.map((s) => ({
        ref: s.ref,
        libraryId: s.libraryId,
        value: s.value,
        footprint: s.footprint,
        position: s.at,
        rotation: s.rotation,
        uuid: s.uuid,
      }));
      return { content: [{ type: "text" as const, text: JSON.stringify(rows, null, 2) }] };
    },
  );

  server.tool(
    "sch.list_nets",
    "List all nets with their connected pins",
    { path: optPath },
    async ({ path }) => {
      const doc = session.getDocument(path);
      const nets = doc.getNets();
      const rows = nets.map((n) => ({
        name: n.name,
        isPower: n.isPower,
        isGlobal: n.isGlobal,
        pinCount: n.pins.length,
        pins: n.pins.map((p) => ({ ref: p.symbolRef, pin: p.pinId, pinName: p.pinName })),
      }));
      return { content: [{ type: "text" as const, text: JSON.stringify(rows, null, 2) }] };
    },
  );

  server.tool(
    "sch.get_symbol",
    "Get detailed information about a symbol by reference designator (e.g. R1, U3)",
    {
      path: optPath,
      ref: z.string().describe("Reference designator (e.g. R1, U3)"),
    },
    async ({ path, ref }) => {
      const doc = session.getDocument(path);
      const match = doc.getByRef(ref).one();
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            ref: match.ref,
            libraryId: match.libraryId,
            value: match.value,
            footprint: match.footprint,
            position: match.at,
            rotation: match.rotation,
            mirror: match.mirror,
            uuid: match.uuid,
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    "sch.diff",
    "Show what changed in a schematic since it was opened",
    { path: optPath },
    async ({ path }) => {
      const doc = session.getDocument(path);
      const trace = doc.getActionTrace();
      if (trace.length === 0) {
        return { content: [{ type: "text" as const, text: "No changes since opened." }] };
      }
      const entries = trace.map((e) => ({
        action: e.action,
        target: e.target,
        details: e.details,
      }));
      return { content: [{ type: "text" as const, text: JSON.stringify(entries, null, 2) }] };
    },
  );
}
