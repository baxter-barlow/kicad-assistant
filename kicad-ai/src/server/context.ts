import { SchematicDocument } from "../index.js";
import { SchematicProject } from "../index.js";
import { SymbolLibrary } from "../index.js";

export interface KicadContext {
  kind: "manager" | "schematic" | "pcb";
  hasProject: boolean;
  projectName: string;
  projectPath: string;
  documentPath: string;
  workspacePath: string;
}

export class SessionManager {
  private context: KicadContext | null = null;
  private documents = new Map<string, SchematicDocument>();
  private projects = new Map<string, SchematicProject>();
  private library: SymbolLibrary | null = null;

  updateContext(ctx: KicadContext): void {
    this.context = ctx;
  }

  getContext(): KicadContext | null {
    return this.context;
  }

  requireDocument(): string {
    if (this.context?.documentPath) return this.context.documentPath;
    throw new Error("No active document. Open a schematic first or pass a path.");
  }

  requireProject(): string {
    if (this.context?.projectPath) return this.context.projectPath;
    throw new Error("No active project. Open a project first or pass a path.");
  }

  getDocument(path?: string): SchematicDocument {
    const resolved = path ?? this.requireDocument();
    let doc = this.documents.get(resolved);
    if (!doc) {
      doc = SchematicDocument.open(resolved);
      this.documents.set(resolved, doc);
    }
    return doc;
  }

  getProject(path?: string): SchematicProject {
    const resolved = path ?? this.requireProject();
    let proj = this.projects.get(resolved);
    if (!proj) {
      proj = SchematicProject.open(resolved);
      this.projects.set(resolved, proj);
    }
    return proj;
  }

  getLibrary(): SymbolLibrary {
    if (!this.library) this.library = new SymbolLibrary();
    return this.library;
  }

  closeDocument(path: string): void {
    this.documents.delete(path);
  }

  closeAll(): void {
    this.documents.clear();
    this.projects.clear();
  }
}
