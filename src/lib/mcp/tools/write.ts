import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { analyzeProject } from "@/lib/projects/analysis";
import { projectData, type ProjectRow } from "@/lib/projects/codec";
import { projectFromStoredRow, storedProjectData } from "@/lib/projects/storageCodec";
import { applyProjectChanges, type FieldChange } from "@/lib/projects/mutations";
import {
  EDITABLE_LISTS, addRevenueStream, applyListOperation, moveRevenueStream, removeRevenueStream,
} from "@/lib/projects/listMutations";
import { DomainError } from "@/lib/projects/errors";
import { createEmptyProject } from "@/lib/storage/factory";
import { projectDocumentSchema, projectFormSchema } from "@/lib/validation/projectSchema";
import { parseImportBundle } from "@/lib/export/importData";
import type { Project } from "@/types";
import type { McpToolContext } from "../context";
import { COST } from "../rateLimit";
import { guard } from "../errors";
import { normalizeMcpPath, publicMcpPath } from "../paths";
import { projectLinks, result } from "../result";
import { businessModel, jsonOutput, projectId, quality, writeHints } from "./shared";


/**
 * The audit table is read by the project owner at /settings/connections, so it
 * records the public path and reason without copying sensitive project values.
 */
function auditPayload(reason: string, diff: FieldChange[], operation?: string) {
  return {
    reason,
    source: "mcp",
    changes: diff.map((change) => ({
      path: publicMcpPath(change.path),
      ...(operation ? { op: operation } : {}),
      ...(change.quality ? { quality: change.quality } : {}),
    })),
  };
}

const writeGuards = {
  expected_revision: z.number().int().positive(),
  idempotency_key: z.string().min(8).max(200),
  reason: z.string().min(1).max(500),
};

export function registerWriteTools(server: McpServer, ctx: McpToolContext) {
  /** Every list and scalar write lands here, so revision, idempotency, audit, and rate limiting stay in one place. */
  async function persist(input: {
    projectId: string; expectedRevision: number; idempotencyKey: string; reason: string;
    apply: (previous: Project) => { project: Project; diff: FieldChange[] };
    operation?: string; summary: string;
    /** Evaluated after `apply`, for facts only the mutation knows (a generated id). */
    extra?: () => Record<string, unknown>;
  }) {
    await ctx.requireWrite();
    await ctx.limit("write", { limit: 20, cost: COST.write });
    const previous = await ctx.readProject(input.projectId);
    if (previous.revision !== input.expectedRevision) {
      throw new DomainError("REVISION_CONFLICT", "The project changed since it was read.", {
        currentRevision: previous.revision, updatedAt: previous.updatedAt,
      });
    }
    const applied = input.apply(previous);
    const { data, error } = await ctx.db.rpc("apply_project_mutation", {
      target_project_id: input.projectId, expected_revision: input.expectedRevision,
      request_idempotency_key: input.idempotencyKey,
      project_name: applied.project.basicInfo.name, project_data: storedProjectData(applied.project),
      allowed_changes: auditPayload(input.reason, applied.diff, input.operation),
    });
    if (error) throw error;
    const updated = projectFromStoredRow(data as ProjectRow);
    const before = analyzeProject(previous, 0);
    const after = analyzeProject(updated, 0);
    return result({
      previousRevision: previous.revision,
      revision: updated.revision,
      diff: applied.diff.map((change) => ({ ...change, path: publicMcpPath(change.path) })),
      scoreDelta: after.score.overall - before.score.overall,
      metricDeltas: {
        mrr: after.metrics.revenue.mrr - before.metrics.revenue.mrr,
        runwayMonths: (after.metrics.funding.runwayMonths ?? 0) - (before.metrics.funding.runwayMonths ?? 0),
      },
      analysis: { score: after.score, decision: after.decision },
      ...(input.extra?.() ?? {}),
    }, input.summary, {
      links: projectLinks(updated.id, ["summary", "analysis"]),
      meta: { "ideaup/revision": updated.revision },
    });
  }

  async function create(project: Project, idempotencyKey: string, summary: string) {
    await ctx.requireWrite(true);
    await ctx.limit("create", { limit: 20, cost: COST.write });
    const { data, error } = await ctx.db.rpc("create_project_with_mcp_grant", {
      target_project_id: project.id, project_name: project.basicInfo.name,
      project_data: storedProjectData(project), project_schema_version: 1,
      request_idempotency_key: idempotencyKey,
    });
    if (error) throw error;
    const created = projectFromStoredRow(data as ProjectRow);
    return result({
      id: created.id, revision: created.revision, assumptions: projectData(created),
      analysis: analyzeProject(created), grantNotice: "Added to this client's project grants.",
    }, summary, { links: projectLinks(created.id, ["summary", "documents"]) });
  }

  server.registerTool("create_project", {
    title: "Create a project",
    description: "Create a safe new project and grant it only to this client.",
    inputSchema: z.object({
      idempotency_key: z.string().min(8).max(200),
      basic: z.object({ name: z.string().min(1).max(200), description: z.string().default(""),
        businessModel, currency: z.enum(["OMR", "USD", "SAR", "AED", "EUR", "GBP"]) }),
      assumptions: projectFormSchema.partial().optional(),
    }), outputSchema: jsonOutput, annotations: writeHints,
  }, guard(async ({ idempotency_key, basic, assumptions }) => {
    const empty = createEmptyProject(basic.businessModel, basic.currency);
    const candidate = projectDocumentSchema.parse({ ...empty, ...assumptions, basicInfo: basic });
    return create(candidate as Project, idempotency_key, "Project created.");
  }));

  server.registerTool("import_project", {
    title: "Import a project",
    description: "Create a project from an export_project JSON bundle. Audited as a create, since the import lands as a new project granted only to this client.",
    inputSchema: z.object({
      idempotency_key: z.string().min(8).max(200),
      bundle_json: z.string().min(2).max(1_000_000),
      name_override: z.string().min(1).max(200).optional(),
    }), outputSchema: jsonOutput, annotations: writeHints,
  }, guard(async ({ idempotency_key, bundle_json, name_override }) => {
    const imported = parseImportBundle(bundle_json);
    const name = name_override ?? imported.basicInfo.name;
    const project = { ...imported, basicInfo: { ...imported.basicInfo, name } };
    return create(project, idempotency_key, "Project imported.");
  }));

  server.registerTool("update_project", {
    title: "Update assumptions",
    description: "Atomically apply allowlisted field changes with revision and idempotency checks. Change paths use public MCP section names, such as one_pager.problem or pricing.productPrice.value; call get_writable_paths to see them all. An assumption can also carry a range: write pricing.productPrice.range.low and .range.high (with .value as the most likely point inside them) to replace a falsely precise single number with a low/high estimate that run_monte_carlo samples. A single list item is addressable as revenue_streams[<id>].price.value; to add, remove, or reorder items use add_revenue_stream, remove_revenue_stream, or edit_list.",
    inputSchema: projectId.extend({
      ...writeGuards,
      changes: z.array(z.object({
        path: z.string().min(1), value: z.json(), quality: quality.optional(),
      })).min(1).max(30),
    }), outputSchema: jsonOutput, annotations: writeHints,
  }, guard(async ({ project_id, expected_revision, idempotency_key, reason, changes }) => persist({
    projectId: project_id, expectedRevision: expected_revision, idempotencyKey: idempotency_key, reason,
    summary: "Project updated.",
    apply: (previous) => applyProjectChanges(previous, changes.map((change) => ({
      ...change, path: normalizeMcpPath(change.path),
    }))),
  })));

  server.registerTool("add_revenue_stream", {
    title: "Add a revenue stream",
    description: "Append one stream to the hybrid revenue mix. Send everything known about the stream in this call — a stream added and then priced costs two revisions. Once it exists, edit single fields with update_project at revenue_streams[<id>].<field>.value.",
    inputSchema: projectId.extend({
      ...writeGuards,
      name: z.string().min(1).max(120),
      kind: z.enum(["one_time", "recurring", "usage", "transactional"]),
      assumptions: z.record(z.string(), z.json()).optional(),
    }), outputSchema: jsonOutput, annotations: writeHints,
  }, guard(async ({ project_id, expected_revision, idempotency_key, reason, name, kind, assumptions }) => {
    let streamId = "";
    return persist({
      projectId: project_id, expectedRevision: expected_revision, idempotencyKey: idempotency_key, reason,
      operation: "append", summary: "Revenue stream added.",
      apply: (previous) => {
        const applied = addRevenueStream(previous, { name, kind, assumptions });
        streamId = applied.streamId;
        return applied;
      },
      extra: () => ({ streamId }),
    });
  }));

  server.registerTool("remove_revenue_stream", {
    title: "Remove a revenue stream",
    description: "Delete one stream from the revenue mix. The removed stream is recorded in the audit log so the owner can restore it by hand.",
    inputSchema: projectId.extend({ ...writeGuards, stream_id: z.string().min(1).max(200) }),
    outputSchema: jsonOutput, annotations: { ...writeHints, destructiveHint: true },
  }, guard(async ({ project_id, expected_revision, idempotency_key, reason, stream_id }) => persist({
    projectId: project_id, expectedRevision: expected_revision, idempotencyKey: idempotency_key, reason,
    operation: "remove", summary: "Revenue stream removed.",
    apply: (previous) => removeRevenueStream(previous, stream_id),
  })));

  server.registerTool("reorder_revenue_streams", {
    title: "Reorder revenue streams",
    description: "Move one stream to a new position in the mix. Order is presentational — it does not change the revenue calculation.",
    inputSchema: projectId.extend({
      ...writeGuards, stream_id: z.string().min(1).max(200), to_index: z.number().int().min(0).max(11),
    }), outputSchema: jsonOutput, annotations: writeHints,
  }, guard(async ({ project_id, expected_revision, idempotency_key, reason, stream_id, to_index }) => persist({
    projectId: project_id, expectedRevision: expected_revision, idempotencyKey: idempotency_key, reason,
    operation: "move", summary: "Revenue streams reordered.",
    apply: (previous) => moveRevenueStream(previous, stream_id, to_index),
  })));

  server.registerTool("edit_list", {
    title: "Edit a document list",
    description: `Add, replace, remove, or reorder one item in a list-shaped field, without rewriting its siblings. Editable lists: ${Object.keys(EDITABLE_LISTS).join(", ")}. Items are addressed by their id, or by index when they have none.`,
    inputSchema: projectId.extend({
      ...writeGuards,
      path: z.enum(Object.keys(EDITABLE_LISTS) as [string, ...string[]]),
      operation: z.enum(["append", "replace_item", "remove", "move"]),
      item: z.json().optional(),
      item_id: z.string().min(1).max(200).optional(),
      to_index: z.number().int().min(0).max(500).optional(),
    }), outputSchema: jsonOutput, annotations: writeHints,
  }, guard(async ({ project_id, expected_revision, idempotency_key, reason, path, operation, item, item_id, to_index }) => persist({
    projectId: project_id, expectedRevision: expected_revision, idempotencyKey: idempotency_key, reason,
    operation, summary: `List ${operation} applied.`,
    apply: (previous) => applyListOperation(previous, {
      path: path as keyof typeof EDITABLE_LISTS, operation, item, itemId: item_id, toIndex: to_index,
    }),
  })));
}
