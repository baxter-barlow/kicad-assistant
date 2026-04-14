export interface SchematicAssertionErrorOptions {
  code: string;
  target: string;
  expected: string;
  actual: string;
  details?: string;
}

export class SchematicAssertionError extends Error {
  readonly code: string;
  readonly target: string;
  readonly expected: string;
  readonly actual: string;
  readonly details?: string;

  constructor(options: SchematicAssertionErrorOptions) {
    const detailSuffix = options.details ? `\n${options.details}` : "";
    super(`Expected ${options.target} to ${options.expected}, but ${options.actual}.${detailSuffix}`);
    this.name = "SchematicAssertionError";
    this.code = options.code;
    this.target = options.target;
    this.expected = options.expected;
    this.actual = options.actual;
    this.details = options.details;
  }
}
