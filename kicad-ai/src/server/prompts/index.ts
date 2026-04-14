import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SessionManager } from "../context.js";
import { registerErcReviewPrompt } from "./erc-review.js";
import { registerBomCheckPrompt } from "./bom-check.js";
import { registerDesignReviewPrompt } from "./design-review.js";

export function registerAllPrompts(server: McpServer, session: SessionManager): void {
  registerErcReviewPrompt(server, session);
  registerBomCheckPrompt(server, session);
  registerDesignReviewPrompt(server, session);
}
