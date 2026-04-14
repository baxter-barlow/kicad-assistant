import { existsSync } from "fs";
import { execSync } from "child_process";
import { platform } from "os";
import { join } from "path";

const PLATFORM = platform();

const CLI_SEARCH_PATHS: Record<string, string[]> = {
  darwin: [
    "/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli",
  ],
  linux: [
    "/usr/bin/kicad-cli",
    "/usr/local/bin/kicad-cli",
    "/snap/kicad/current/usr/bin/kicad-cli",
  ],
  win32: [
    "C:\\Program Files\\KiCad\\bin\\kicad-cli.exe",
    "C:\\Program Files (x86)\\KiCad\\bin\\kicad-cli.exe",
  ],
};

const SYMBOLS_SEARCH_PATHS: Record<string, string[]> = {
  darwin: [
    "/Applications/KiCad/KiCad.app/Contents/SharedSupport/symbols",
  ],
  linux: [
    "/usr/share/kicad/symbols",
    "/usr/local/share/kicad/symbols",
    "/snap/kicad/current/usr/share/kicad/symbols",
  ],
  win32: [
    "C:\\Program Files\\KiCad\\share\\kicad\\symbols",
    "C:\\Program Files (x86)\\KiCad\\share\\kicad\\symbols",
  ],
};

export function findKicadCli(): string {
  // 1. Check environment variable
  const envPath = process.env.KICAD_CLI;
  if (envPath && existsSync(envPath)) return envPath;

  // 2. Check platform-specific known locations
  const paths = CLI_SEARCH_PATHS[PLATFORM] ?? [];
  for (const p of paths) {
    if (existsSync(p)) return p;
  }

  // 3. Try PATH lookup
  try {
    const cmd = PLATFORM === "win32" ? "where kicad-cli" : "which kicad-cli";
    const result = execSync(cmd, { encoding: "utf-8", timeout: 5000 }).trim();
    if (result && existsSync(result)) return result;
  } catch {
    // not found on PATH
  }

  throw new Error(
    "kicad-cli not found. Install KiCad or set the KICAD_CLI environment variable."
  );
}

export function findSymbolsPath(): string {
  // 1. Check environment variable
  const envPath = process.env.KICAD_SYMBOLS_PATH;
  if (envPath && existsSync(envPath)) return envPath;

  // 2. Check platform-specific known locations
  const paths = SYMBOLS_SEARCH_PATHS[PLATFORM] ?? [];
  for (const p of paths) {
    if (existsSync(p)) return p;
  }

  // 3. Try to derive from kicad-cli location
  try {
    const cli = findKicadCli();
    if (PLATFORM === "darwin") {
      const base = cli.replace("/Contents/MacOS/kicad-cli", "/Contents/SharedSupport/symbols");
      if (existsSync(base)) return base;
    } else {
      const base = join(cli, "..", "..", "share", "kicad", "symbols");
      if (existsSync(base)) return base;
    }
  } catch {
    // couldn't find cli
  }

  throw new Error(
    "KiCad symbol libraries not found. Install KiCad or set the KICAD_SYMBOLS_PATH environment variable."
  );
}
