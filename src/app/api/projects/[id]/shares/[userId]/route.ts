import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; userId: string }> }) {
  const supabase = await createServerSupabaseClient();
  const { data: claims } = await supabase.auth.getClaims();
  const actingUserId = claims?.claims?.sub;
  if (!actingUserId) return Response.json({ error: { code: "FORBIDDEN", message: "Sign in required." } }, { status: 401 });
  const { id, userId } = await params;

  const { data: revoked, error } = await supabase
    .from("project_shares")
    .delete()
    .eq("project_id", id)
    .eq("shared_with_user_id", userId)
    .select("invited_email, access_mode")
    .maybeSingle();
  if (error) return Response.json({ error: { code: "INTERNAL_ERROR", message: "Could not remove this collaborator." } }, { status: 500 });
  if (!revoked) return new Response(null, { status: 204 });

  const { data: project } = await supabase.from("projects").select("revision").eq("id", id).maybeSingle();
  await supabase.from("project_audit_events").insert({
    user_id: actingUserId, project_id: id, action: "grant_change",
    revision_before: null, revision_after: project?.revision ?? 1,
    changes: { source: "share", operation: "revoked", accessMode: revoked.access_mode, sharedWithEmail: revoked.invited_email },
  });
  return new Response(null, { status: 204 });
}
