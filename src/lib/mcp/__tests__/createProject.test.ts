import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/server";
import type { McpToolContext } from "../context";
import type { ProjectRow } from "@/lib/projects/codec";
import { projectFromStoredRow } from "@/lib/projects/storageCodec";
import { registerWriteTools } from "../tools/write";

beforeEach(() => {
  vi.stubEnv("PROJECT_ENCRYPTION_MODE", "required");
  vi.stubEnv("PROJECT_ENCRYPTION_ACTIVE_KEY_ID", "test");
  vi.stubEnv("PROJECT_ENCRYPTION_KEYS", JSON.stringify({ test: Buffer.alloc(32, 3).toString("base64") }));
});
afterEach(() => vi.unstubAllEnvs());

it("creates an MCP project whose ciphertext is bound to the saved row ID", async () => {
  type Handler = (input: unknown) => Promise<{ isError?: boolean }>;
  const handlers: Record<string, Handler> = {};
  let stored: ProjectRow | undefined;
  const rpc = vi.fn(async (_name: string, args: Record<string, unknown>) => {
    // The legacy RPC generates an ID when target_project_id is omitted.
    stored = {
      id: (args.target_project_id as string | undefined) ?? crypto.randomUUID(),
      name: args.project_name as string,
      schema_version: args.project_schema_version as number,
      revision: 1,
      data: args.project_data,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    return { data: stored, error: null };
  });
  const server = {
    registerTool(name: string, _config: unknown, handler: Handler) { handlers[name] = handler; },
  } as unknown as McpServer;
  const ctx = {
    requireWrite: vi.fn(), limit: vi.fn(), db: { rpc },
  } as unknown as McpToolContext;
  registerWriteTools(server, ctx);

  const response = await handlers.create_project({
    idempotency_key: "create-encrypted-project",
    basic: { name: "MCP project", description: "Test", businessModel: "saas", currency: "USD" },
  });

  expect(response.isError).not.toBe(true);
  expect(rpc).toHaveBeenCalledWith("create_project_with_mcp_grant", expect.objectContaining({
    target_project_id: expect.any(String),
  }));
  expect(stored).toBeDefined();
  const restored = projectFromStoredRow(stored!);
  expect(restored.id).toBe(stored!.id);
  expect(restored.basicInfo.name).toBe("MCP project");
});
