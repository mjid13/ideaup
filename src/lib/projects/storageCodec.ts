import "server-only";

import type { Project } from "@/types";
import { decodeProjectData, encodeProjectData } from "@/lib/security/projectEncryption";
import { projectData, projectFromRow, type ProjectRow } from "./codec";

export function projectFromStoredRow(row: ProjectRow, viewerId?: string): Project {
  return projectFromRow({ ...row, data: decodeProjectData(row.id, row.data) }, viewerId);
}

export function storedProjectData(project: Project): unknown {
  return encodeProjectData(project.id, projectData(project));
}
