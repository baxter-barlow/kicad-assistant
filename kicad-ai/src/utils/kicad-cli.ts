import { execFileSync } from "child_process";
import { readFileSync, mkdirSync, rmSync } from "fs";
import { basename, dirname, resolve } from "path";
import { findKicadCli } from "./kicad-paths.js";

let cachedCliPath: string | undefined;

function getCliPath(): string {
  if (!cachedCliPath) cachedCliPath = findKicadCli();
  return cachedCliPath;
}

function getExecError(e: unknown): string {
  if (e && typeof e === "object") {
    const obj = e as Record<string, unknown>;
    if (typeof obj.stdout === "string" && obj.stdout) return obj.stdout;
    if (typeof obj.stderr === "string" && obj.stderr) return obj.stderr;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

export interface ErcViolation {
  severity: "error" | "warning";
  message: string;
}

export interface ErcResult {
  passed: boolean;
  errors: ErcViolation[];
  warnings: ErcViolation[];
  raw: string;
}

export function runErc(schPath: string): ErcResult {
  const cli = getCliPath();
  const resolvedSchPath = resolve(schPath);
  const schDir = dirname(resolvedSchPath);
  const schFile = basename(resolvedSchPath);
  const rptPath = resolvedSchPath.replace(/\.kicad_sch$/, "-erc.rpt");

  // Remove any previous report so a failed CLI invocation cannot be mistaken
  // for a fresh ERC run by re-reading stale output.
  rmSync(rptPath, { force: true });

  let cliOutput: string;
  try {
    cliOutput = execFileSync(cli, ["sch", "erc", schFile], {
      encoding: "utf-8",
      timeout: 30000,
      cwd: schDir,
    });
  } catch (e: unknown) {
    cliOutput = getExecError(e);
  }
  return parseErcOutput(rptPath, cliOutput);
}

function parseErcOutput(rptPath: string, cliOutput: string): ErcResult {
  let rptText: string;
  try {
    rptText = readFileSync(rptPath, "utf-8");
  } catch {
    return {
      passed: false,
      errors: [{ severity: "error", message: `ERC report not generated. CLI output: ${cliOutput}` }],
      warnings: [],
      raw: cliOutput,
    };
  }

  const errors: ErcViolation[] = [];
  const warnings: ErcViolation[] = [];
  const lines = rptText.split("\n");
  let currentMessage = "";
  let currentSeverity: "error" | "warning" | null = null;

  for (const line of lines) {
    if (line.startsWith("[")) {
      if (currentMessage && currentSeverity) {
        const violation = { severity: currentSeverity, message: currentMessage.trim() };
        if (currentSeverity === "error") errors.push(violation);
        else warnings.push(violation);
      }
      currentMessage = line;
      currentSeverity = null;
    } else if (line.trim() === "; error") {
      currentSeverity = "error";
    } else if (line.trim() === "; warning") {
      currentSeverity = "warning";
    } else if (line.startsWith("    @") && currentMessage) {
      currentMessage += " " + line.trim();
    }
  }

  if (currentMessage && currentSeverity) {
    const violation = { severity: currentSeverity, message: currentMessage.trim() };
    if (currentSeverity === "error") errors.push(violation);
    else warnings.push(violation);
  }

  return { passed: errors.length === 0, errors, warnings, raw: rptText };
}

export function exportSvg(schPath: string, outPath: string): string {
  const cli = getCliPath();
  mkdirSync(dirname(outPath), { recursive: true });
  try {
    execFileSync(cli, ["sch", "export", "svg", schPath, "-o", outPath], {
      encoding: "utf-8",
      timeout: 30000,
    });
  } catch (e: unknown) {
    throw new Error(`SVG export failed: ${getExecError(e)}`);
  }
  return outPath;
}

export function exportNetlist(schPath: string, outPath: string): string {
  const cli = getCliPath();
  mkdirSync(dirname(outPath), { recursive: true });
  try {
    execFileSync(cli, ["sch", "export", "netlist", schPath, "-o", outPath], {
      encoding: "utf-8",
      timeout: 30000,
    });
  } catch (e: unknown) {
    throw new Error(`Netlist export failed: ${getExecError(e)}`);
  }
  return outPath;
}
