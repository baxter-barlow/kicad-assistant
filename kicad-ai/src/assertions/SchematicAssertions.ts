import {
  SchematicDocument,
  SchematicLabelLocator,
  SchematicNetLocator,
  SchematicPinLocator,
  SchematicSymbolLocator,
  type SchematicLabelMatch,
  type SchematicNetMatch,
  type SchematicPinMatch,
  type SchematicSymbolMatch,
} from "../document/SchematicDocument.js";
import type { ErcResult } from "../utils/kicad-cli.js";
import { SchematicAssertionError } from "./SchematicAssertionError.js";

type LocatorTarget =
  | SchematicSymbolLocator
  | SchematicLabelLocator
  | SchematicPinLocator
  | SchematicNetLocator;

type AssertionTarget = LocatorTarget | SchematicDocument;

abstract class BaseAssertions<TMatch> {
  protected constructor(
    protected readonly target: AssertionTarget,
    protected readonly describeTarget: () => string,
    protected readonly resolveMatches: () => TMatch[],
    protected readonly describeMatch: (match: TMatch) => string,
  ) {}

  toExist(): void {
    const matches = this.resolveMatches();
    if (matches.length === 0) {
      this.fail("locator.missing", "exist", "found 0 matches");
    }
  }

  toHaveCount(expectedCount: number): void {
    const matches = this.resolveMatches();
    if (matches.length !== expectedCount) {
      this.fail(
        "locator.count_mismatch",
        `have count ${expectedCount}`,
        `found ${matches.length} match(es)`,
        describeMatches(matches, this.describeMatch),
      );
    }
  }

  protected requireSingle(kind: string): TMatch {
    const matches = this.resolveMatches();
    if (matches.length !== 1) {
      this.fail(
        `${kind}.not_single`,
        `resolve to exactly 1 ${kind}`,
        `found ${matches.length} match(es)`,
        describeMatches(matches, this.describeMatch),
      );
    }
    return matches[0];
  }

  protected fail(code: string, expected: string, actual: string, details?: string): never {
    throw new SchematicAssertionError({
      code,
      target: this.describeTarget(),
      expected,
      actual,
      details,
    });
  }
}

class SymbolAssertions extends BaseAssertions<SchematicSymbolMatch> {
  constructor(locator: SchematicSymbolLocator) {
    super(locator, () => locator.describe(), () => locator.all(), describeSymbol);
  }

  toHaveValue(expectedValue: string): void {
    const symbol = this.requireSingle("symbol");
    if (symbol.value !== expectedValue) {
      this.fail(
        "symbol.value_mismatch",
        `have value "${expectedValue}"`,
        `found value "${symbol.value ?? ""}"`,
      );
    }
  }

  toHaveFootprint(expectedFootprint: string): void {
    const symbol = this.requireSingle("symbol");
    if (symbol.footprint !== expectedFootprint) {
      this.fail(
        "symbol.footprint_mismatch",
        `have footprint "${expectedFootprint}"`,
        `found footprint "${symbol.footprint ?? ""}"`,
      );
    }
  }
}

class LabelAssertions extends BaseAssertions<SchematicLabelMatch> {
  constructor(locator: SchematicLabelLocator) {
    super(locator, () => locator.describe(), () => locator.all(), describeLabel);
  }
}

class PinAssertions extends BaseAssertions<SchematicPinMatch> {
  constructor(locator: SchematicPinLocator) {
    super(locator, () => locator.describe(), () => locator.all(), describePin);
  }

  toBeConnectedTo(netName: string): void {
    const pin = this.requireSingle("pin");
    if (pin.netName !== netName) {
      this.fail(
        "pin.net_mismatch",
        `be connected to net "${netName}"`,
        pin.netName ? `found net "${pin.netName}"` : "found no net",
      );
    }
  }

  toBeNoConnect(): void {
    const pin = this.requireSingle("pin");
    if (!pin.isNoConnect) {
      this.fail("pin.not_no_connect", "be marked no-connect", "pin is still electrically connectable");
    }
  }
}

class NetAssertions extends BaseAssertions<SchematicNetMatch> {
  constructor(locator: SchematicNetLocator) {
    super(locator, () => locator.describe(), () => locator.all(), describeNet);
  }

  toContainPin(ref: string, pinId: string): void {
    const net = this.requireSingle("net");
    const hasPin = net.pins.some(pin => pin.symbolRef === ref && pin.pinId === pinId);
    if (!hasPin) {
      this.fail(
        "net.missing_pin",
        `contain pin ${ref}:${pinId}`,
        "pin was not present on the net",
        `Pins on net: ${net.pins.map(pin => `${pin.symbolRef}:${pin.pinId}`).join(", ") || "<none>"}`,
      );
    }
  }

  toBeDriven(): void {
    const net = this.requireSingle("net");
    if (!net.isPower) {
      this.fail("net.not_driven", "be driven", "net is not marked driven or powered");
    }
  }
}

class ErcAssertions {
  private cached?: ErcResult;

  constructor(private readonly document: SchematicDocument) {}

  toHaveNoErrors(): ErcResult {
    const result = this.getResult();
    if (result.errors.length > 0) {
      throw new SchematicAssertionError({
        code: "erc.has_errors",
        target: `${this.document.describe()} ERC`,
        expected: "have no ERC errors",
        actual: `found ${result.errors.length} error(s)`,
        details: result.errors.slice(0, 3).map(error => error.message).join("\n"),
      });
    }
    return result;
  }

  toHaveErrorCount(expectedCount: number): ErcResult {
    const result = this.getResult();
    if (result.errors.length !== expectedCount) {
      throw new SchematicAssertionError({
        code: "erc.error_count_mismatch",
        target: `${this.document.describe()} ERC`,
        expected: `have ${expectedCount} ERC error(s)`,
        actual: `found ${result.errors.length} error(s)`,
        details: result.errors.slice(0, 5).map(error => error.message).join("\n"),
      });
    }
    return result;
  }

  toHaveWarningCount(expectedCount: number): ErcResult {
    const result = this.getResult();
    if (result.warnings.length !== expectedCount) {
      throw new SchematicAssertionError({
        code: "erc.warning_count_mismatch",
        target: `${this.document.describe()} ERC`,
        expected: `have ${expectedCount} ERC warning(s)`,
        actual: `found ${result.warnings.length} warning(s)`,
        details: result.warnings.slice(0, 5).map(warning => warning.message).join("\n"),
      });
    }
    return result;
  }

  private getResult(): ErcResult {
    if (!this.cached) {
      this.cached = this.document.runErc();
    }
    return this.cached;
  }
}

export function expectSchematic(target: SchematicSymbolLocator): SymbolAssertions;
export function expectSchematic(target: SchematicLabelLocator): LabelAssertions;
export function expectSchematic(target: SchematicPinLocator): PinAssertions;
export function expectSchematic(target: SchematicNetLocator): NetAssertions;
export function expectSchematic(
  target: LocatorTarget,
): SymbolAssertions | LabelAssertions | PinAssertions | NetAssertions {
  if (target instanceof SchematicSymbolLocator) return new SymbolAssertions(target);
  if (target instanceof SchematicLabelLocator) return new LabelAssertions(target);
  if (target instanceof SchematicPinLocator) return new PinAssertions(target);
  if (target instanceof SchematicNetLocator) return new NetAssertions(target);
  throw new Error("Unsupported schematic assertion target.");
}

export function expectErc(document: SchematicDocument): ErcAssertions {
  return new ErcAssertions(document);
}

export function captureTextSnapshot(document: SchematicDocument): string {
  return document.snapshotText();
}

export function captureSvgSnapshot(document: SchematicDocument, outPath: string): string {
  return document.snapshotSvg(outPath);
}

function describeMatches<TMatch>(matches: TMatch[], describeMatch: (match: TMatch) => string): string {
  if (matches.length === 0) return "Found matches: <none>";
  return `Found matches: ${matches.slice(0, 5).map(describeMatch).join(", ")}${matches.length > 5 ? ", ..." : ""}`;
}

function describeSymbol(symbol: SchematicSymbolMatch): string {
  return `${symbol.ref ?? "<no ref>"} (${symbol.libraryId ?? "unknown"})`;
}

function describeLabel(label: SchematicLabelMatch): string {
  return `${label.labelKind} "${label.name}"`;
}

function describePin(pin: SchematicPinMatch): string {
  return `${pin.symbolRef ?? "<no ref>"}:${pin.pinId}${pin.netName ? ` on ${pin.netName}` : ""}`;
}

function describeNet(net: SchematicNetMatch): string {
  return `${net.name} (${net.pins.length} pin${net.pins.length === 1 ? "" : "s"})`;
}

export { SchematicAssertionError } from "./SchematicAssertionError.js";
