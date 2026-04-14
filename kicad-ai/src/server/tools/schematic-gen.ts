import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NetlistBuilder } from "../../index.js";
import type { SessionManager } from "../context.js";

export function registerSchematicGenTools(server: McpServer, _session: SessionManager): void {
  server.tool(
    "sch.generate",
    "Generate a new schematic from a declarative netlist specification. Provide symbols with their net assignments and the tool handles placement, wiring, and layout automatically.",
    {
      output_path: z.string().describe("Output .kicad_sch file path"),
      symbols: z.array(z.object({
        library_id: z.string().describe("Symbol library ID (e.g. Device:R)"),
        ref: z.string().describe("Reference designator (e.g. R1)"),
        value: z.string().optional().describe("Component value (e.g. 10k)"),
        footprint: z.string().optional().describe("Footprint"),
        nets: z.record(z.string()).optional().describe('Pin-to-net mapping (e.g. {"1": "VCC", "2": "OUT"})'),
      })).describe("List of symbols to place"),
      power_flags: z.array(z.string()).optional().describe('Net names that need PWR_FLAG (e.g. ["VCC", "GND"])'),
      no_connects: z.array(z.object({
        ref: z.string(),
        pin: z.string(),
      })).optional().describe("Pins to mark as no-connect"),
    },
    async ({ output_path, symbols, power_flags, no_connects }) => {
      const builder = new NetlistBuilder();

      for (const sym of symbols) {
        builder.addSymbol(sym.library_id, {
          ref: sym.ref,
          value: sym.value,
          footprint: sym.footprint,
          nets: sym.nets,
        });
      }

      if (power_flags) {
        for (const net of power_flags) builder.addPowerFlag(net);
      }

      if (no_connects) {
        for (const nc of no_connects) builder.addNoConnect(nc.ref, nc.pin);
      }

      const outPath = builder.save(output_path);
      return {
        content: [{
          type: "text" as const,
          text: `Generated schematic with ${symbols.length} symbols at ${outPath}`,
        }],
      };
    },
  );
}
