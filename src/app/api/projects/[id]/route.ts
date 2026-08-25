import { createServerSupabaseClient } from "@/lib/supabase/server";
import { SupabaseProjectRepository } from "@/lib/projects/repository";
import { DomainError } from "@/lib/projects/errors";
import { projectDocumentSchema } from "@/lib/validation/projectSchema";

export const runtime = "nodejs";

async function context() {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.auth.getClaims();
  return { supabase, authenticated: Boolean(data?.claims?.sub), userId: data?.claims?.sub };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, authenticated, userId } = await context();
  if (!authenticated) return Response.json({ error: { code: "FORBIDDEN", message: "Sign in required." } }, { status: 401 });
  try {
    const project = await new SupabaseProjectRepository(supabase, userId).getById((await params).id);
    return project ? Response.json(project) : Response.json({ error: { code: "NOT_FOUND", message: "Project not found." } }, { status: 404 });
  } catch {
    return Response.json({ error: { code: "INTERNAL_ERROR", message: "Project data is temporarily unavailable." } }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, authenticated, userId } = await context();
  if (!authenticated) return Response.json({ error: { code: "FORBIDDEN", message: "Sign in required." } }, { status: 401 });
  const parsed = projectDocumentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || parsed.data.id !== (await params).id) {
    return Response.json({ error: { code: "VALIDATION_FAILED", message: "Invalid project.", issues: parsed.error?.issues } }, { status: 400 });
  }
  try {
    const repository = new SupabaseProjectRepository(supabase, userId);
    const before = await repository.getById(parsed.data.id);
    const saved = await repository.save(parsed.data);
    const action = request.headers.get("x-project-action") === "import" ? "import" : before ? "update" : "create";
    await supabase.from("project_audit_events").insert({
      user_id: userId, project_id: saved.id, action,
      revision_before: before?.revision ?? null, revision_after: saved.revision,
      changes: [{ path: "project", operation: action }],
    });
    return Response.json(saved);
  } catch (error) {
    const status = error instanceof DomainError && error.code === "REVISION_CONFLICT" ? 409 : 400;
    const code = error instanceof DomainError ? error.code : "INTERNAL_ERROR";
    const message = code === "INTERNAL_ERROR" ? "Project data is temporarily unavailable." : (error as Error).message;
    return Response.json({ error: { code, message } }, { status: code === "INTERNAL_ERROR" ? 500 : status });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, authenticated } = await context();
  if (!authenticated) return Response.json({ error: { code: "FORBIDDEN", message: "Sign in required." } }, { status: 401 });
  await new SupabaseProjectRepository(supabase).delete((await params).id);
  return new Response(null, { status: 204 });
}
