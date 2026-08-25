import { createServerSupabaseClient } from "@/lib/supabase/server";
import { SupabaseProjectRepository } from "@/lib/projects/repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return Response.json({ error: { code: "FORBIDDEN", message: "Sign in required." } }, { status: 401 });
  try {
    return Response.json(await new SupabaseProjectRepository(supabase, userId).getAll());
  } catch {
    return Response.json({ error: { code: "INTERNAL_ERROR", message: "Project data is temporarily unavailable." } }, { status: 500 });
  }
}
