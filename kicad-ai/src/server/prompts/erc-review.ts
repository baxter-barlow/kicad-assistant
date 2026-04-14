import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runErc } from "../../index.js";
import type { SessionManager } from "../context.js";

export function registerErcReviewPrompt(server: McpServer, session: SessionManager): void {
  server.prompt(
    "erc-review",
    "Run ERC on a schematic and get AI analysis of the results with fix suggestions",
    {
      path: z.string().optional().describe("Path to .kicad_sch file (defaults to active document)"),
    },
    async ({ path }) => {
      const resolved = path ?? session.requireDocument();
      const result = runErc(resolved);

      const violations = [
        ...result.errors.map((e) => `ERROR: ${e.message}`),
        ...result.warnings.map((w) => `WARNING: ${w.message}`),
      ].join("\n");

      const body = result.passed
        ? "ERC passed with no errors."
        : `ERC found ${result.errors.length} error(s) and ${result.warnings.length} warning(s):\n\n${violations}`;

      return {
        messages: [{
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Review the following KiCad Electrical Rules Check results for ${resolved}.\n\n${body}\n\nFor each violation:\n1. Explain what it means\n2. Rate severity (critical / important / cosmetic)\n3. Suggest a specific fix using the available schematic tools`,
          },
        }],
      };
    },
  );
}
