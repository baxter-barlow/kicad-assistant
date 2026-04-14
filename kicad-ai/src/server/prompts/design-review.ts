import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SessionManager } from "../context.js";

export function registerDesignReviewPrompt(server: McpServer, session: SessionManager): void {
  server.prompt(
    "design-review",
    "Review a schematic for common design issues (missing decoupling, floating pins, pull-ups, etc.)",
    {
      path: z.string().optional().describe("Path to .kicad_sch file (defaults to active document)"),
      focus: z.enum(["power", "decoupling", "connectivity", "all"]).optional().default("all")
        .describe("Area to focus the review on"),
    },
    async ({ path, focus }) => {
      const doc = session.getDocument(path);
      const summary = doc.describe();
      const nets = doc.getNets();
      const symbols = doc.getSymbols();

      const netSummary = nets.map((n) => {
        const pinList = n.pins.map((p) => `${p.symbolRef}:${p.pinId}`).join(", ");
        return `${n.name} (${n.isPower ? "power" : "signal"}, ${n.pins.length} pins): ${pinList}`;
      }).join("\n");

      const focusInstructions: Record<string, string> = {
        power: "Focus on power distribution: missing power flags, undriven power nets, power pin connections.",
        decoupling: "Focus on decoupling: check that every IC has bypass capacitors on its power pins, placed close to the IC.",
        connectivity: "Focus on connectivity: single-pin nets, floating inputs, unconnected pins that should be tied.",
        all: "Review all aspects: power, decoupling, connectivity, pull-ups/pull-downs, and general best practices.",
      };

      return {
        messages: [{
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Review this KiCad schematic for design issues.\n\n${focusInstructions[focus ?? "all"]}\n\nSchematic summary:\n${summary}\n\nNet connectivity:\n${netSummary}\n\nComponents (${symbols.length} total):\n${symbols.map((s) => `${s.ref} (${s.libraryId}) = ${s.value ?? "?"}`).join("\n")}\n\nFor each issue found:\n1. Describe the problem\n2. Rate severity (critical / important / suggestion)\n3. Propose a specific fix using the available schematic tools`,
          },
        }],
      };
    },
  );
}
