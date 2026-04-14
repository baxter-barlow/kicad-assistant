import { describe, it, expect } from "vitest";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join, relative, resolve } from "path";
import { runErc } from "../src/utils/kicad-cli.js";

const OUT_DIR = join(import.meta.dirname, "..", "test-output", "kicad-cli");
const TEMPLATE = join(import.meta.dirname, "..", "template.kicad_sch");

describe("kicad-cli helpers", () => {
  it("runs ERC correctly for relative schematic paths with directories", () => {
    rmSync(OUT_DIR, { recursive: true, force: true });

    const nestedDir = join(OUT_DIR, "relative");
    mkdirSync(nestedDir, { recursive: true });

    const schematicPath = join(nestedDir, "template-relative.kicad_sch");
    const reportPath = join(nestedDir, "template-relative-erc.rpt");
    copyFileSync(TEMPLATE, schematicPath);
    rmSync(reportPath, { force: true });

    const relativePath = relative(process.cwd(), schematicPath);
    const relativeResult = runErc(relativePath);
    const absoluteResult = runErc(resolve(schematicPath));

    expect(relativeResult.raw.length).toBeGreaterThan(0);
    expect(relativeResult.passed).toBe(absoluteResult.passed);
    expect(relativeResult.errors.map(e => e.message)).toEqual(
      absoluteResult.errors.map(e => e.message)
    );
    expect(relativeResult.warnings.map(w => w.message)).toEqual(
      absoluteResult.warnings.map(w => w.message)
    );
  });

  it("does not trust a stale ERC report when the CLI run fails", () => {
    rmSync(OUT_DIR, { recursive: true, force: true });

    const staleDir = join(OUT_DIR, "stale");
    mkdirSync(staleDir, { recursive: true });

    const missingSchematicPath = join(staleDir, "missing.kicad_sch");
    const staleReportPath = join(staleDir, "missing-erc.rpt");

    writeFileSync(
      staleReportPath,
      [
        "FAKE_STALE_REPORT",
        "[pin_not_connected]: stale result that must be ignored",
        "    ; error",
      ].join("\n"),
      "utf-8"
    );

    const result = runErc(resolve(missingSchematicPath));

    expect(result.passed).toBe(false);
    expect(result.errors[0]?.message).toContain("ERC report not generated");
    expect(result.raw).not.toContain("FAKE_STALE_REPORT");
  });
});
