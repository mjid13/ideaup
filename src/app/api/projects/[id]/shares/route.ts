import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const inviteSchema = z.object({
  email: z.string().email(),
  accessMode: z.enum(["read", "write"]),
});

async function context() {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.auth.getClaims();
  return { supabase, authenticated: Boolean(data?.claims?.sub), userId: data?.claims?.sub as string | undefined };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, authenticated } = await context();
  if (!authenticated) return Response.json({ error: { code: "FORBIDDEN", message: "Sign in required." } }, { status: 401 });
  const { id } = await params;
  const { data, error } = await supabase
    .from("project_shares")
    .select("shared_with_user_id, invited_email, access_mode, created_at")
    .eq("project_id", id)
    .order("created_at", { ascending: true });
  if (error) return Response.json({ error: { code: "INTERNAL_ERROR", message: "Shares are temporarily unavailable." } }, { status: 500 });
  return Response.json({
    shares: (data ?? []).map((row) => ({
      userId: row.shared_with_user_id,
      email: row.invited_email,
      accessMode: row.access_mode,
      createdAt: row.created_at,
    })),
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, authenticated, userId } = await context();
  if (!authenticated) return Response.json({ error: { code: "FORBIDDEN", message: "Sign in required." } }, { status: 401 });
  const parsed = inviteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: { code: "VALIDATION_FAILED", message: "Enter a valid email and access level." } }, { status: 400 });
  const { id } = await params;
  const { data, error } = await supabase.rpc("share_project_with_email", {
    target_project_id: id,
    target_email: parsed.data.email,
    target_access_mode: parsed.data.accessMode,
  });
  if (error) {
    if (error.code === "42501") return Response.json({ error: { code: "FORBIDDEN", message: "Only the project owner can share it." } }, { status: 403 });
    if (error.code === "P0002") return Response.json({ error: { code: "NOT_FOUND", message: "No IdeaUp account found for that email." } }, { status: 404 });
    if (error.code === "22023") return Response.json({ error: { code: "VALIDATION_FAILED", message: "You can't share a project with yourself." } }, { status: 400 });
    return Response.json({ error: { code: "INTERNAL_ERROR", message: "Could not share this project." } }, { status: 500 });
  }
  const { data: project } = await supabase.from("projects").select("revision").eq("id", id).maybeSingle();
  await supabase.from("project_audit_events").insert({
    user_id: userId, project_id: id, action: "grant_change",
    revision_before: null, revision_after: project?.revision ?? 1,
    changes: { source: "share", operation: "granted", accessMode: parsed.data.accessMode, sharedWithEmail: parsed.data.email },
  });
  return Response.json({
    userId: data.shared_with_user_id, email: data.invited_email, accessMode: data.access_mode, createdAt: data.created_at,
  });
}
