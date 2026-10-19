import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { ZodError } from "zod";
import { projectDocumentSchema } from "@/lib/validation/projectSchema";
import type { Project } from "@/types";
import { assertProjectWritesAllowed } from "@/lib/security/projectEncryption";
import type { ProjectRow } from "./codec";
import { projectFromStoredRow, storedProjectData } from "./storageCodec";
import { DomainError } from "./errors";

export interface ProjectSummary { id: string; name: string }

export class SupabaseProjectRepository {
  constructor(private readonly db: SupabaseClient) {}

  async getAll(): Promise<Project[]> {
    const { data, error } = await this.db.from("projects").select("*").order("updated_at", { ascending: false });
    if (error) {
      console.error("project_list_failed", { stage: "query", databaseCode: error.code });
      throw new DomainError("FORBIDDEN", error.message);
    }
    return (data as ProjectRow[]).map((row) => {
      try {
        return projectFromStoredRow(row);
      } catch (error) {
        // Log field paths and error codes only: validation messages and raw
        // exceptions can contain project contents or other sensitive values.
        console.error("project_list_failed", {
          stage: "decode",
          projectId: row.id,
          errorType: error instanceof ZodError ? "validation"
            : error instanceof DomainError ? error.code : "unexpected",
          ...(error instanceof ZodError ? {
            issues: error.issues.map((issue) => ({ path: issue.path, code: issue.code })),
          } : {}),
        });
        throw error;
      }
    });
  }

  async getById(id: string): Promise<Project | null> {
    const { data, error } = await this.db.from("projects").select("*").eq("id", id).maybeSingle();
    if (error) throw new DomainError("FORBIDDEN", error.message);
    return data ? projectFromStoredRow(data as ProjectRow) : null;
  }

  async getSummaries(): Promise<ProjectSummary[]> {
    const { data, error } = await this.db.from("projects").select("id,name").order("name");
    if (error) throw new DomainError("FORBIDDEN", error.message);
    return data as ProjectSummary[];
  }

  async save(input: Project): Promise<Project> {
    const project = projectDocumentSchema.parse(input) as Project;
    const existing = await this.getById(project.id);
    if (!existing) {
      const { data, error } = await this.db.from("projects").insert({
        id: project.id,
        name: project.basicInfo.name,
        schema_version: project.schemaVersion,
        revision: 1,
        data: storedProjectData(project),
        created_at: project.createdAt,
        updated_at: project.updatedAt,
      }).select("*").single();
      if (error) throw new DomainError("VALIDATION_FAILED", error.message);
      return projectFromStoredRow(data as ProjectRow);
    }
    const { data, error } = await this.db.from("projects").update({
      name: project.basicInfo.name,
      schema_version: project.schemaVersion,
      revision: existing.revision + 1,
      data: storedProjectData(project),
      updated_at: new Date().toISOString(),
    }).eq("id", project.id).eq("revision", project.revision).select("*").maybeSingle();
    if (error) throw new DomainError("VALIDATION_FAILED", error.message);
    if (!data) throw new DomainError("REVISION_CONFLICT", "Project changed since it was loaded.", {
      currentRevision: existing.revision, updatedAt: existing.updatedAt,
    });
    return projectFromStoredRow(data as ProjectRow);
  }

  async delete(id: string): Promise<void> {
    assertProjectWritesAllowed();
    const { error } = await this.db.from("projects").delete().eq("id", id);
    if (error) throw new DomainError("FORBIDDEN", error.message);
  }
}
