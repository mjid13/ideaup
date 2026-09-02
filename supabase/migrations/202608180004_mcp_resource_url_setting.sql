-- The access-token hook used to read the MCP resource URL from the database
-- setting `app.settings.mcp_resource_url`. Supabase no longer allows a project
-- owner to set database-level parameters ("permission denied to set parameter"),
-- so that value now lives in an ordinary table instead.
--
-- When the URL is unavailable the hook leaves `aud` untouched, which produces a
-- token the MCP server rejects with a bare 401 — the failure is invisible from
-- the client's side, so this table is the thing to check first when a freshly
-- authorized client cannot call anything.

create table public.mcp_server_settings (
  -- Single row by construction: there is one canonical MCP URL per database.
  id boolean primary key default true check (id),
  resource_url text not null check (resource_url ~ '^https?://'),
  updated_at timestamptz not null default now()
);

alter table public.mcp_server_settings enable row level security;
-- No policies: the value is deployment configuration, not user data. The hook
-- below reads it as its owner, and the dashboard/service role still can.

create or replace function public.custom_access_token_hook(event jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  claims jsonb := event -> 'claims';
  cid text;
  resource text;
begin
  cid := coalesce(claims ->> 'client_id', claims -> 'app_metadata' ->> 'client_id');
  if cid is null then
    return event;
  end if;
  select s.resource_url into resource from public.mcp_server_settings s limit 1;
  -- Fall back to the old database setting so a deployment that already had it
  -- configured keeps working without being touched.
  resource := coalesce(resource, current_setting('app.settings.mcp_resource_url', true));
  if resource is null then
    return event;
  end if;
  claims := jsonb_set(claims, '{aud}', to_jsonb(resource));
  return jsonb_set(event, '{claims}', claims);
end $$;

grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;

-- Set the canonical MCP URL for this environment. It must match MCP_RESOURCE_URL
-- in the application environment exactly: same scheme, same host, no trailing slash.
--
--   insert into public.mcp_server_settings (resource_url)
--   values ('https://your-app.example.com/mcp')
--   on conflict (id) do update set resource_url = excluded.resource_url, updated_at = now();
