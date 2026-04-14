import { describe, it, expect } from "vitest";
import { SchematicBuilder } from "../src/builder/SchematicBuilder.js";
import { SymbolLibrary } from "../src/library/SymbolLibrary.js";
import { NetlistBuilder } from "../src/netlist/NetlistBuilder.js";

describe("Input validation", () => {
  it("rejects invalid library ID format", () => {
    const sch = new SchematicBuilder();
    expect(() => sch.addSymbol("BadFormat", { ref: "R1", at: [0, 0] }))
      .toThrow('Expected "Library:Symbol" format');
  });

  it("rejects non-existent symbol", () => {
    const sch = new SchematicBuilder();
    expect(() => sch.addSymbol("Device:NonExistentPart", { ref: "R1", at: [0, 0] }))
      .toThrow("not found");
  });

  it("rejects non-existent library", () => {
    const sch = new SchematicBuilder();
    expect(() => sch.addSymbol("FakeLib:R", { ref: "R1", at: [0, 0] }))
      .toThrow("not found");
  });

  it("rejects invalid rotation", () => {
    const sch = new SchematicBuilder();
    expect(() => sch.addSymbol("Device:R", { ref: "R1", at: [0, 0], rotation: 45 }))
      .toThrow("Invalid rotation");
  });

  it("rejects NaN coordinates", () => {
    const sch = new SchematicBuilder();
    expect(() => sch.addSymbol("Device:R", { ref: "R1", at: [NaN, 0] }))
      .toThrow("Invalid coordinates");
  });

  it("rejects empty ref", () => {
    const sch = new SchematicBuilder();
    expect(() => sch.addSymbol("Device:R", { ref: "", at: [0, 0] }))
      .toThrow("ref is required");
  });

  it("throws helpful error when connecting non-existent pin", () => {
    const sch = new SchematicBuilder();
    const r1 = sch.addSymbol("Device:R", { ref: "R1", at: [0, 0] });
    const r2 = sch.addSymbol("Device:R", { ref: "R2", at: [20, 0] });

    expect(() => sch.connect(r1, 99, r2, 1))
      .toThrow(/Pin "99" not found.*Available/);
  });
});

describe("SymbolLibrary errors", () => {
  it("rejects invalid library ID", () => {
    const lib = new SymbolLibrary();
    expect(() => lib.resolve("no-colon")).toThrow("Expected");
  });

  it("rejects non-existent symbol", () => {
    const lib = new SymbolLibrary();
    expect(() => lib.resolve("Device:ZZZZZ")).toThrow("not found");
  });
});

describe("NetlistBuilder marker validation", () => {
  it("rejects pins that are both connected and marked no-connect", () => {
    const sch = new NetlistBuilder();
    const header = sch.addSymbol("Connector_Generic:Conn_01x02", {
      ref: "J1",
      at: [100, 100],
    });

    header.markNoConnect(1);
    header.setNet(1, "SIG");

    expect(() => sch.generate()).toThrow("cannot be marked no-connect");
  });
});
