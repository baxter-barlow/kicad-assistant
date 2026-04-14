import { expectSchematic } from "../assertions/SchematicAssertions.js";
import {
  type DuplicateSymbolOptions,
  type SchematicLabelLocator,
  type SchematicNetLocator,
  type SchematicPinLocator,
  type SchematicSymbolLocator,
} from "../document/SchematicDocument.js";
import type { Point } from "../library/PinCalculator.js";
import { SchematicProject, SchematicProjectSheetHandle } from "../project/SchematicProject.js";

export interface SchematicFixtureContext {
  describe(): string;
  getByRef(ref: string): SchematicSymbolLocator;
  getByLibraryId(libraryId: string): SchematicSymbolLocator;
  getByValue(value: string): SchematicSymbolLocator;
  getByFootprint(footprint: string): SchematicSymbolLocator;
  getByLabel(name: string): SchematicLabelLocator;
  getByNet(name: string): SchematicNetLocator;
  pin(ref: string, pinId: string): SchematicPinLocator;
}

export interface RegulatorPinMap {
  input: string;
  output: string;
  ground: string;
  enable?: string;
}

export interface UsbConnectorPinMap {
  vbus: string;
  ground: string | readonly string[];
  dPlus?: string;
  dMinus?: string;
  shield?: string | readonly string[];
}

export interface I2cBusNetMap {
  scl: string;
  sda: string;
  power?: string;
  ground?: string;
}

export interface I2cDevicePinMap {
  scl: string;
  sda: string;
  power?: string;
  ground?: string;
}

export interface ProjectNetExpectation {
  toSpanSheets(expectedSheets: string[]): void;
  toContainPin(sheetName: string, ref: string, pinId: string): void;
}

export class ComponentFixture<TContext extends SchematicFixtureContext> {
  constructor(
    protected readonly context: TContext,
    readonly ref: string,
  ) {}

  describe(): string {
    return `${this.context.describe()} component "${this.ref}"`;
  }

  locator(): SchematicSymbolLocator {
    return this.context.getByRef(this.ref);
  }

  pin(pinId: string): SchematicPinLocator {
    return this.context.pin(this.ref, pinId);
  }

  setValue(value: string): this {
    this.locator().setValue(value);
    return this;
  }

  setFootprint(footprint: string): this {
    this.locator().setFootprint(footprint);
    return this;
  }

  move(at: Point): this {
    this.locator().move(at);
    return this;
  }

  rotate(rotation: number): this {
    this.locator().rotate(rotation);
    return this;
  }

  duplicate(options?: DuplicateSymbolOptions): ComponentFixture<TContext> {
    const result = this.locator().duplicate(options);
    return new ComponentFixture(this.context, result.ref ?? this.ref);
  }

  delete(): this {
    this.locator().delete();
    return this;
  }

  connect(pinId: string, netName: string): this {
    this.pin(pinId).connectTo(netName);
    return this;
  }

  disconnect(pinId: string): this {
    this.pin(pinId).disconnect();
    return this;
  }

  markNoConnect(pinId: string): this {
    this.pin(pinId).markNoConnect();
    return this;
  }

  markDriven(pinId: string, netName?: string): this {
    this.pin(pinId).markDriven(netName);
    return this;
  }

  expectExists(): this {
    expectSchematic(this.locator()).toExist();
    return this;
  }

  expectValue(value: string): this {
    expectSchematic(this.locator()).toHaveValue(value);
    return this;
  }

  expectFootprint(footprint: string): this {
    expectSchematic(this.locator()).toHaveFootprint(footprint);
    return this;
  }

  expectConnected(pinId: string, netName: string): this {
    expectSchematic(this.pin(pinId)).toBeConnectedTo(netName);
    return this;
  }

  expectNoConnect(pinId: string): this {
    expectSchematic(this.pin(pinId)).toBeNoConnect();
    return this;
  }
}

export class PowerDomainFixture<TContext extends SchematicFixtureContext> {
  constructor(
    private readonly context: TContext,
    readonly netName: string,
  ) {}

  describe(): string {
    return `${this.context.describe()} power domain "${this.netName}"`;
  }

  locator(): SchematicNetLocator {
    return this.context.getByNet(this.netName);
  }

  connect(component: string | ComponentFixture<TContext>, pinId: string): this {
    this.context.pin(resolveComponentRef(component), pinId).connectTo(this.netName);
    return this;
  }

  markDriven(): this {
    this.locator().markDriven();
    return this;
  }

  expectDriven(): this {
    expectSchematic(this.locator()).toBeDriven();
    return this;
  }

  expectPin(component: string | ComponentFixture<TContext>, pinId: string): this {
    expectSchematic(this.locator()).toContainPin(resolveComponentRef(component), pinId);
    return this;
  }
}

export class I2cBusFixture<TContext extends SchematicFixtureContext> {
  constructor(
    private readonly context: TContext,
    readonly name: string,
    readonly nets: I2cBusNetMap,
  ) {}

  describe(): string {
    return `${this.context.describe()} i2c bus "${this.name}"`;
  }

  scl(): PowerDomainFixture<TContext> {
    return new PowerDomainFixture(this.context, this.nets.scl);
  }

  sda(): PowerDomainFixture<TContext> {
    return new PowerDomainFixture(this.context, this.nets.sda);
  }

  power(): PowerDomainFixture<TContext> {
    if (!this.nets.power) {
      throw new Error(`I2C bus "${this.name}" has no configured power net.`);
    }
    return new PowerDomainFixture(this.context, this.nets.power);
  }

  ground(): PowerDomainFixture<TContext> {
    if (!this.nets.ground) {
      throw new Error(`I2C bus "${this.name}" has no configured ground net.`);
    }
    return new PowerDomainFixture(this.context, this.nets.ground);
  }

  connectDevice(component: string | ComponentFixture<TContext>, pins: I2cDevicePinMap): this {
    const ref = resolveComponentRef(component);
    this.context.pin(ref, pins.scl).connectTo(this.nets.scl);
    this.context.pin(ref, pins.sda).connectTo(this.nets.sda);

    if (pins.power) {
      this.power().connect(ref, pins.power);
    }
    if (pins.ground) {
      this.ground().connect(ref, pins.ground);
    }

    return this;
  }

  expectDevice(component: string | ComponentFixture<TContext>, pins: I2cDevicePinMap): this {
    const ref = resolveComponentRef(component);
    expectSchematic(this.context.pin(ref, pins.scl)).toBeConnectedTo(this.nets.scl);
    expectSchematic(this.context.pin(ref, pins.sda)).toBeConnectedTo(this.nets.sda);

    if (pins.power) {
      expectSchematic(this.context.pin(ref, pins.power)).toBeConnectedTo(requiredNet(this.nets.power, this.name, "power"));
    }
    if (pins.ground) {
      expectSchematic(this.context.pin(ref, pins.ground)).toBeConnectedTo(requiredNet(this.nets.ground, this.name, "ground"));
    }

    return this;
  }
}

export class McuFixture<TContext extends SchematicFixtureContext> extends ComponentFixture<TContext> {
  gpio(pinId: string): SchematicPinLocator {
    return this.pin(pinId);
  }

  connectPin(pinId: string, netName: string): this {
    return this.connect(pinId, netName);
  }

  connectPower(pinId: string, netName: string): this {
    return this.connect(pinId, netName);
  }

  connectGround(pinId: string, netName: string = "GND"): this {
    return this.connect(pinId, netName);
  }

  connectI2c(bus: I2cBusFixture<TContext>, pins: I2cDevicePinMap): this {
    bus.connectDevice(this, pins);
    return this;
  }

  expectPinNet(pinId: string, netName: string): this {
    return this.expectConnected(pinId, netName);
  }

  expectI2c(bus: I2cBusFixture<TContext>, pins: I2cDevicePinMap): this {
    bus.expectDevice(this, pins);
    return this;
  }
}

export class RegulatorFixture<TContext extends SchematicFixtureContext> extends ComponentFixture<TContext> {
  constructor(
    context: TContext,
    ref: string,
    private readonly pins: RegulatorPinMap,
  ) {
    super(context, ref);
  }

  connectInput(netName: string): this {
    return this.connect(this.pins.input, netName);
  }

  connectOutput(netName: string): this {
    return this.connect(this.pins.output, netName);
  }

  connectGround(netName: string = "GND"): this {
    return this.connect(this.pins.ground, netName);
  }

  connectEnable(netName: string): this {
    if (!this.pins.enable) {
      throw new Error(`Regulator "${this.ref}" has no configured enable pin.`);
    }
    return this.connect(this.pins.enable, netName);
  }

  markOutputDriven(netName?: string): PowerDomainFixture<TContext> {
    const drivenNet = this.pin(this.pins.output).markDriven(netName);
    return new PowerDomainFixture(this.context, drivenNet.name);
  }

  expectInput(netName: string): this {
    return this.expectConnected(this.pins.input, netName);
  }

  expectOutput(netName: string): this {
    return this.expectConnected(this.pins.output, netName);
  }

  expectGround(netName: string = "GND"): this {
    return this.expectConnected(this.pins.ground, netName);
  }
}

export class UsbConnectorFixture<TContext extends SchematicFixtureContext> extends ComponentFixture<TContext> {
  constructor(
    context: TContext,
    ref: string,
    private readonly pins: UsbConnectorPinMap,
  ) {
    super(context, ref);
  }

  connectVbus(netName: string): this {
    return this.connect(this.pins.vbus, netName);
  }

  connectGround(netName: string = "GND"): this {
    for (const pinId of normalizePinIds(this.pins.ground)) {
      this.connect(pinId, netName);
    }
    return this;
  }

  connectShield(netName: string = "GND"): this {
    for (const pinId of normalizePinIds(this.pins.shield)) {
      this.connect(pinId, netName);
    }
    return this;
  }

  connectData(nets: { dPlus?: string; dMinus?: string }): this {
    if (nets.dPlus) {
      this.requirePin(this.pins.dPlus, "dPlus");
      this.connect(this.pins.dPlus!, nets.dPlus);
    }
    if (nets.dMinus) {
      this.requirePin(this.pins.dMinus, "dMinus");
      this.connect(this.pins.dMinus!, nets.dMinus);
    }
    return this;
  }

  expectVbus(netName: string): this {
    return this.expectConnected(this.pins.vbus, netName);
  }

  expectGround(netName: string = "GND"): this {
    for (const pinId of normalizePinIds(this.pins.ground)) {
      this.expectConnected(pinId, netName);
    }
    return this;
  }

  expectShield(netName: string = "GND"): this {
    for (const pinId of normalizePinIds(this.pins.shield)) {
      this.expectConnected(pinId, netName);
    }
    return this;
  }

  expectData(nets: { dPlus?: string; dMinus?: string }): this {
    if (nets.dPlus) {
      this.requirePin(this.pins.dPlus, "dPlus");
      this.expectConnected(this.pins.dPlus!, nets.dPlus);
    }
    if (nets.dMinus) {
      this.requirePin(this.pins.dMinus, "dMinus");
      this.expectConnected(this.pins.dMinus!, nets.dMinus);
    }
    return this;
  }

  private requirePin(pinId: string | undefined, name: string): asserts pinId is string {
    if (!pinId) {
      throw new Error(`USB connector "${this.ref}" has no configured ${name} pin.`);
    }
  }
}

export class SchematicBoardFixture<TContext extends SchematicFixtureContext> {
  constructor(readonly context: TContext) {}

  describe(): string {
    return this.context.describe();
  }

  component(ref: string): ComponentFixture<TContext> {
    return new ComponentFixture(this.context, ref);
  }

  mcu(ref: string): McuFixture<TContext> {
    return new McuFixture(this.context, ref);
  }

  regulator(ref: string, pins: RegulatorPinMap): RegulatorFixture<TContext> {
    return new RegulatorFixture(this.context, ref, pins);
  }

  usbConnector(ref: string, pins: UsbConnectorPinMap): UsbConnectorFixture<TContext> {
    return new UsbConnectorFixture(this.context, ref, pins);
  }

  i2cBus(name: string, nets: I2cBusNetMap): I2cBusFixture<TContext> {
    return new I2cBusFixture(this.context, name, nets);
  }

  powerDomain(netName: string): PowerDomainFixture<TContext> {
    return new PowerDomainFixture(this.context, netName);
  }
}

export class SchematicProjectFixture {
  constructor(readonly project: SchematicProject) {}

  describe(): string {
    return this.project.describe();
  }

  sheet(name: string): SchematicBoardFixture<SchematicProjectSheetHandle> {
    return new SchematicBoardFixture(this.project.sheet(name).one());
  }

  expectNet(name: string): ProjectNetExpectation {
    return this.project.expectNet(name);
  }
}

export function createSchematicFixture<TContext extends SchematicFixtureContext>(
  context: TContext,
): SchematicBoardFixture<TContext> {
  return new SchematicBoardFixture(context);
}

export function createProjectFixture(project: SchematicProject): SchematicProjectFixture {
  return new SchematicProjectFixture(project);
}

export function defineSchematicFixture<TContext extends SchematicFixtureContext, TFixture>(
  builder: (fixture: SchematicBoardFixture<TContext>) => TFixture,
): (context: TContext) => TFixture {
  return (context: TContext) => builder(createSchematicFixture(context));
}

export function defineProjectFixture<TFixture>(
  builder: (fixture: SchematicProjectFixture) => TFixture,
): (project: SchematicProject) => TFixture {
  return (project: SchematicProject) => builder(createProjectFixture(project));
}

function resolveComponentRef<TContext extends SchematicFixtureContext>(
  component: string | ComponentFixture<TContext>,
): string {
  return typeof component === "string" ? component : component.ref;
}

function requiredNet(netName: string | undefined, busName: string, pinRole: string): string {
  if (!netName) {
    throw new Error(`I2C bus "${busName}" has no configured ${pinRole} net.`);
  }
  return netName;
}

function normalizePinIds(pinIds: string | readonly string[] | undefined): readonly string[] {
  if (!pinIds) return [];
  if (typeof pinIds === "string") return [pinIds];
  return [...pinIds];
}
