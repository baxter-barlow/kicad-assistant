import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runErc, exportSvg, exportNetlist } from "../../index.js";
import type { SessionManager } from "../context.js";

const optPath = z.string().optional().describe("Path to .kicad_sch file (defaults to active document)");

export function registerSchematicIoTools(server: McpServer, session: SessionManager): void {
  server.tool(
    "sch.save",
    "Save changes to a schematic file. Preserves unmodified content.",
    {
      path: optPath,
      save_as: z.string().optional().describe("Optional alternate path to save to"),
    },
    async ({ path, save_as }) => {
      const doc = session.getDocument(path);
      const outPath = save_as ? doc.saveAs(save_as) : doc.save();
      return { content: [{ type: "text" as const, text: `Saved to ${outPath}` }] };
    },
  );

  server.tool(
    "sch.run_erc",
    "Run KiCad Electrical Rules Check and return errors/warnings",
    { path: optPath },
    async ({ path }) => {
      const resolved = path ?? session.requireDocument();
      const result = runErc(resolved);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            passed: result.passed,
            errorCount: result.errors.length,
            warningCount: result.warnings.length,
            errors: result.errors,
            warnings: result.warnings,
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    "sch.export_svg",
    "Export a schematic to SVG format",
    {
      path: optPath,
      output: z.string().describe("Output SVG file path"),
    },
    async ({ path, output }) => {
      const resolved = path ?? session.requireDocument();
      const outPath = exportSvg(resolved, output);
      return { content: [{ type: "text" as const, text: `Exported SVG to ${outPath}` }] };
    },
  );

  server.tool(
    "sch.export_netlist",
    "Export a schematic's netlist",
    {
      path: optPath,
      output: z.string().describe("Output netlist file path"),
    },
    async ({ path, output }) => {
      const resolved = path ?? session.requireDocument();
      const outPath = exportNetlist(resolved, output);
      return { content: [{ type: "text" as const, text: `Exported netlist to ${outPath}` }] };
    },
  );
}
