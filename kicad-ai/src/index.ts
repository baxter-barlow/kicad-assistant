export { SchematicBuilder } from "./builder/SchematicBuilder.js";
export type { PlacedSymbol, AddSymbolOptions, SchematicBuilderOptions } from "./builder/SchematicBuilder.js";
export { SymbolLibrary } from "./library/SymbolLibrary.js";
export type { SymbolDef, PinDef, PropertyDef, SearchResult } from "./library/SymbolLibrary.js";
export { getAbsolutePinPosition } from "./library/PinCalculator.js";
export type { Point } from "./library/PinCalculator.js";
export { route } from "./builder/WireRouter.js";
export type { WireSegment } from "./builder/WireRouter.js";
export { runErc, exportSvg, exportNetlist } from "./utils/kicad-cli.js";
export type { ErcResult, ErcViolation } from "./utils/kicad-cli.js";
export { findKicadCli, findSymbolsPath } from "./utils/kicad-paths.js";
export { NetlistBuilder } from "./netlist/NetlistBuilder.js";
export type { NetlistAddSymbolOptions, NetlistSymbolHandle } from "./netlist/NetlistBuilder.js";
export { Netlist } from "./netlist/Netlist.js";
export type { Net, NetConnection, NetlistSymbol } from "./netlist/Netlist.js";
export { autoLayout } from "./layout/AutoLayout.js";
export type { LayoutResult, LayoutPlacement } from "./layout/AutoLayout.js";
export { computeBoundingBox } from "./layout/BoundingBox.js";
export type { BoundingBox } from "./layout/BoundingBox.js";
export {
  voltageDivider,
  bypassCap,
  pullup,
  pulldown,
  ledWithResistor,
  crystalOscillator,
  decoupleIC,
  linearRegulator,
  resetCircuit,
  i2cBus,
} from "./circuits/CircuitPatterns.js";
export { readSchematic, inferNets } from "./reader/SchematicReader.js";
export type { ReadResult, ReadSymbol, ReadLabel, ReadJunction, InferredNet } from "./reader/SchematicReader.js";
export {
  expectSchematic,
  expectErc,
  captureTextSnapshot,
  captureSvgSnapshot,
  SchematicAssertionError,
} from "./assertions/SchematicAssertions.js";
export {
  SchematicDocument,
  SchematicLocatorError,
  SchematicSymbolLocator,
  SchematicLabelLocator,
  SchematicPinLocator,
  SchematicNetLocator,
  parseSchematicDocument,
} from "./document/SchematicDocument.js";
export {
  SchematicProject,
  SchematicProjectAssertionError,
  SchematicProjectSheetHandle,
  SchematicProjectSheetLocator,
} from "./project/SchematicProject.js";
export {
  captureSemanticSnapshot,
  diffSemanticSnapshots,
  diffErcResults,
  traceLocator,
  captureActionTrace,
  formatLocatorTrace,
  formatActionTrace,
  formatSemanticDiff,
  formatErcDiff,
} from "./tooling/SchematicTooling.js";
export {
  ComponentFixture,
  PowerDomainFixture,
  I2cBusFixture,
  McuFixture,
  RegulatorFixture,
  UsbConnectorFixture,
  SchematicBoardFixture,
  SchematicProjectFixture,
  createSchematicFixture,
  createProjectFixture,
  defineSchematicFixture,
  defineProjectFixture,
} from "./fixtures/SchematicFixtures.js";
export {
  recordDocumentFixtureWorkflow,
  recordProjectFixtureWorkflow,
  generateDocumentWorkflowCode,
  generateProjectWorkflowCode,
} from "./fixtures/SchematicRecorder.js";
export type {
  ParsedSchematicDocument,
  SourceRange,
  LabelKind,
  SchematicPlacedPinNode,
  DuplicateSymbolOptions,
  SchematicNodeKind,
  SchematicNode,
  SchematicValueNode,
  TitleBlockNode,
  SchematicWireNode,
  SchematicLabelNode,
  SchematicJunctionNode,
  SchematicNoConnectNode,
  SchematicSheetPinNode,
  SchematicSheetNode,
  SchematicSymbolNode,
  SchematicOpaqueNode,
  SchematicDocumentOptions,
  SchematicSymbolMatch,
  SchematicLabelMatch,
  SchematicPinMatch,
  SchematicNetMatch,
  SchematicLocatorTrace,
  SchematicActionName,
  SchematicActionTraceEntry,
  SchematicSheetPinMatch,
  SchematicSheetMatch,
} from "./document/SchematicDocument.js";
export type {
  SchematicProjectNetMatch,
  SchematicProjectActionTraceEntry,
} from "./project/SchematicProject.js";
export type {
  SchematicSymbolSnapshot,
  SchematicLabelSnapshot,
  SchematicNetSnapshot,
  SchematicSheetSnapshot,
  SchematicDocumentSemanticSnapshot,
  SchematicProjectNetSnapshot,
  SchematicProjectSheetSnapshot,
  SchematicProjectSemanticSnapshot,
  SchematicSemanticSnapshot,
  SchematicDiffChange,
  SchematicDiffCategory,
  SchematicSemanticDiff,
  SchematicErcDiff,
  CapturedActionTrace,
} from "./tooling/SchematicTooling.js";
export type {
  SchematicFixtureContext,
  ProjectNetExpectation,
  RegulatorPinMap,
  UsbConnectorPinMap,
  I2cBusNetMap,
  I2cDevicePinMap,
} from "./fixtures/SchematicFixtures.js";
export type {
  RecorderCodegenOptions,
  RecordedDocumentFixtureWorkflow,
  RecordedProjectFixtureWorkflow,
} from "./fixtures/SchematicRecorder.js";
