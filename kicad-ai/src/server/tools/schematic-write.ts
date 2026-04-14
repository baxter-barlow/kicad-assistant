import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SessionManager } from "../context.js";

const optPath = z.string().optional().describe("Path to .kicad_sch file (defaults to active document)");

export function registerSchematicWriteTools(server: McpServer, session: SessionManager): void {
  server.tool(
    "sch.set_value",
    "Set the value of a component (e.g. change a resistor from 10k to 4.7k)",
    {
      path: optPath,
      ref: z.string().describe("Reference designator (e.g. R1)"),
      value: z.string().describe("New value (e.g. 4.7k, 100nF, LM7805)"),
    },
    async ({ path, ref, value }) => {
      const doc = session.getDocument(path);
      doc.getByRef(ref).setValue(value);
      return { content: [{ type: "text" as const, text: `Set ${ref} value to "${value}"` }] };
    },
  );

  server.tool(
    "sch.set_footprint",
    "Set the footprint of a component",
    {
      path: optPath,
      ref: z.string().describe("Reference designator (e.g. R1)"),
      footprint: z.string().describe("Footprint (e.g. Resistor_SMD:R_0805_2012Metric)"),
    },
    async ({ path, ref, footprint }) => {
      const doc = session.getDocument(path);
      doc.getByRef(ref).setFootprint(footprint);
      return { content: [{ type: "text" as const, text: `Set ${ref} footprint to "${footprint}"` }] };
    },
  );

  server.tool(
    "sch.move",
    "Move a symbol to a new position on the schematic",
    {
      path: optPath,
      ref: z.string().describe("Reference designator (e.g. R1)"),
      x: z.number().describe("New X coordinate (KiCad mils)"),
      y: z.number().describe("New Y coordinate (KiCad mils)"),
    },
    async ({ path, ref, x, y }) => {
      const doc = session.getDocument(path);
      doc.getByRef(ref).move({ x, y });
      return { content: [{ type: "text" as const, text: `Moved ${ref} to (${x}, ${y})` }] };
    },
  );

  server.tool(
    "sch.rotate",
    "Rotate a symbol (0, 90, 180, or 270 degrees)",
    {
      path: optPath,
      ref: z.string().describe("Reference designator (e.g. R1)"),
      rotation: z.number().describe("Rotation in degrees (0, 90, 180, 270)"),
    },
    async ({ path, ref, rotation }) => {
      const doc = session.getDocument(path);
      doc.getByRef(ref).rotate(rotation);
      return { content: [{ type: "text" as const, text: `Rotated ${ref} to ${rotation} degrees` }] };
    },
  );

  server.tool(
    "sch.delete",
    "Delete a symbol from the schematic",
    {
      path: optPath,
      ref: z.string().describe("Reference designator (e.g. R1)"),
    },
    async ({ path, ref }) => {
      const doc = session.getDocument(path);
      doc.getByRef(ref).delete();
      return { content: [{ type: "text" as const, text: `Deleted ${ref}` }] };
    },
  );

  server.tool(
    "sch.connect_pin",
    "Connect a pin to a named net by placing a label",
    {
      path: optPath,
      ref: z.string().describe("Reference designator (e.g. U1)"),
      pin: z.string().describe("Pin number or name"),
      net: z.string().describe("Net name to connect to (e.g. I2C_SCL, VCC)"),
    },
    async ({ path, ref, pin, net }) => {
      const doc = session.getDocument(path);
      doc.pin(ref, pin).connectTo(net);
      return { content: [{ type: "text" as const, text: `Connected ${ref} pin ${pin} to net "${net}"` }] };
    },
  );

  server.tool(
    "sch.disconnect_pin",
    "Disconnect a pin from its current net",
    {
      path: optPath,
      ref: z.string().describe("Reference designator"),
      pin: z.string().describe("Pin number or name"),
    },
    async ({ path, ref, pin }) => {
      const doc = session.getDocument(path);
      doc.pin(ref, pin).disconnect();
      return { content: [{ type: "text" as const, text: `Disconnected ${ref} pin ${pin}` }] };
    },
  );

  server.tool(
    "sch.mark_no_connect",
    "Mark a pin as intentionally unconnected (no-connect flag)",
    {
      path: optPath,
      ref: z.string().describe("Reference designator"),
      pin: z.string().describe("Pin number or name"),
    },
    async ({ path, ref, pin }) => {
      const doc = session.getDocument(path);
      doc.pin(ref, pin).markNoConnect();
      return { content: [{ type: "text" as const, text: `Marked ${ref} pin ${pin} as no-connect` }] };
    },
  );
}
