-- Direct, trusted user-to-user project sharing. One owner grants one other
-- registered user read or read+write access to a single project. No public
-- links, no teams, no generic roles — a per-(project, user) grant, mirroring
-- the existing mcp_project_grants shape.

create table public.project_shares (
  project_id uuid not null references public.projects(id) on delete cascade,
  shared_with_user_id uuid not null references auth.users(id) on delete cascade,
  -- Denormalized at invite time so the owner's collaborator list can show who
  -- has access without a second privileged lookup into auth.users.
  invited_email text not null,
  access_mode public.mcp_access_mode not null default 'read',
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, shared_with_user_id)
);
create index project_shares_user_idx on public.project_shares (shared_with_user_id);

alter table public.project_shares enable row level security;

-- Read visibility: the collaborator can see their own grant; the project
-- owner can see every grant on projects they own (management UI).
create policy project_shares_select on public.project_shares for select to authenticated using (
  shared_with_user_id = auth.uid()
  or exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
);

-- Changing access level and revoking don't need the auth.users lookup, so
-- they're plain owner-gated RLS writes (same style as projects_update_direct).
create policy project_shares_owner_update on public.project_shares for update to authenticated using (
  exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
) with check (
  exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
);
create policy project_shares_owner_delete on public.project_shares for delete to authenticated using (
  exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
);
-- Deliberately no insert policy: every insert happens inside
-- share_project_with_email() below, which needs security-definer privileges
-- anyway to resolve an email to a user id. No permissive policy = denied.

-- Mirrors has_active_project_grant(): used inside projects' own RLS policies.
create function public.has_project_share(target_project_id uuid, require_write boolean default false)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.project_shares s
    where s.project_id = target_project_id
      and s.shared_with_user_id = auth.uid()
      and (not require_write or s.access_mode = 'write')
  )
$$;

-- Extend read access: owner (unchanged) OR an active share, but only for
-- direct/browser sessions — shares never grant MCP-token access.
drop policy projects_select on public.projects;
create policy projects_select on public.projects for select to authenticated using (
  (
    user_id = auth.uid() and (
      public.request_oauth_client_id() is null or public.has_active_project_grant(id, false)
    )
  )
  or (
    public.request_oauth_client_id() is null and public.has_project_share(id, false)
  )
);

-- Extend direct write access: owner (unchanged) OR a write-mode share.
-- Delete stays owner-only (projects_delete_direct is untouched).
drop policy projects_update_direct on public.projects;
create policy projects_update_direct on public.projects for update to authenticated using (
  public.request_oauth_client_id() is null and (
    user_id = auth.uid() or public.has_project_share(id, true)
  )
) with check (
  user_id = auth.uid() or (public.request_oauth_client_id() is null and public.has_project_share(id, true))
);

-- Let the owner see audit rows a collaborator generated on a shared project
-- (previously audit_owner_select only showed your own rows).
drop policy audit_owner_select on public.project_audit_events;
create policy audit_owner_select on public.project_audit_events for select to authenticated using (
  (user_id = auth.uid() and public.request_oauth_client_id() is null)
  or exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
);

-- Invite: owner-only, resolves email -> user id (needs auth.users access),
-- upserts the share (also used to change an existing collaborator's mode).
create function public.share_project_with_email(
  target_project_id uuid, target_email text, target_access_mode public.mcp_access_mode
) returns public.project_shares
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  target_user_id uuid;
  result public.project_shares;
begin
  if uid is null then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if not exists (select 1 from public.projects where id = target_project_id and user_id = uid) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select id into target_user_id from auth.users where lower(email) = lower(target_email) limit 1;
  if target_user_id is null then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if target_user_id = uid then
    raise exception 'CANNOT_SHARE_WITH_SELF' using errcode = '22023';
  end if;
  insert into public.project_shares (project_id, shared_with_user_id, invited_email, access_mode, created_by)
    values (target_project_id, target_user_id, target_email, target_access_mode, uid)
    on conflict (project_id, shared_with_user_id)
    do update set access_mode = excluded.access_mode, updated_at = now()
    returning * into result;
  return result;
end $$;

revoke all on function public.share_project_with_email(uuid,text,public.mcp_access_mode) from public;
grant execute on function public.share_project_with_email(uuid,text,public.mcp_access_mode) to authenticated;
