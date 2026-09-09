-- Migration: phi_access_log — HIPAA §164.312(b) audit controls.
--
-- Records who did what to which patient's PHI. Two write paths feed it:
--
--   1. Database triggers (this migration) capture every INSERT / UPDATE /
--      DELETE on the clinical tables that clients mutate directly through
--      PostgREST + RLS (medications, medication_logs, appointments,
--      care_tasks). The trigger runs security definer and stamps the actor
--      from auth.uid() and their role from cc_role().
--
--   2. The service-role API routes write rows in code for the flows that do
--      not touch those tables via a client: vault upload/download/delete
--      (encrypted documents), AI chat queries (PHI egress to the model), and
--      outbound alert dispatch.
--
-- Known limitation: PostgreSQL has no SELECT trigger, so plain reads of the
-- clinical tables (client-direct via RLS) are not captured here. The
-- highest-sensitivity reads — vault document downloads and AI queries — ARE
-- logged via path (2). Full read-level auditing of the clinical tables would
-- require routing those reads through a server endpoint or enabling a
-- database audit extension / log drain (pgAudit); tracked as follow-up.
--
-- The table is append-only: patients and admins may read their own audit
-- trail, but there is no client INSERT/UPDATE/DELETE policy. Trigger inserts
-- run as definer and service-role inserts bypass RLS.

create table if not exists public.phi_access_log (
  id             uuid        primary key default gen_random_uuid(),
  patient_id     uuid        not null,
  actor_user_id  uuid,                    -- null for system/CareIQ-originated events
  actor_role     text,                    -- admin | caregiver | viewer | patient | system
  action         text        not null,    -- create|update|delete|download|upload|ai_query|alert_sent|...
  resource_type  text        not null,    -- medication|medication_log|appointment|care_task|vault_file|ai_chat|alert
  resource_id    uuid,
  detail         jsonb       not null default '{}'::jsonb,
  source         text        not null default 'api' check (source in ('api', 'trigger')),
  ip             text,
  user_agent     text,
  created_at     timestamptz not null default now()
);

create index if not exists phi_access_log_patient_idx
  on public.phi_access_log (patient_id, created_at desc);
create index if not exists phi_access_log_actor_idx
  on public.phi_access_log (actor_user_id, created_at desc);

alter table public.phi_access_log enable row level security;

-- Only the patient or an admin member of that patient may read the trail.
drop policy if exists "phi_log_select" on public.phi_access_log;
create policy "phi_log_select"
  on public.phi_access_log
  for select
  using (public.cc_role(patient_id) = 'admin');

-- No client write policies on purpose: the log is append-only from trusted
-- paths (definer triggers + service role) and immutable to clients.

----------------------------------------------------------------------
-- Trigger: capture mutations on the client-writable clinical tables.
----------------------------------------------------------------------
create or replace function public.log_phi_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_patient uuid;
  v_resource uuid;
  v_action text;
begin
  if (tg_op = 'DELETE') then
    v_patient := old.patient_id; v_resource := old.id; v_action := 'delete';
  elsif (tg_op = 'UPDATE') then
    v_patient := new.patient_id; v_resource := new.id; v_action := 'update';
  else
    v_patient := new.patient_id; v_resource := new.id; v_action := 'create';
  end if;

  insert into public.phi_access_log
    (patient_id, actor_user_id, actor_role, action, resource_type, resource_id, source)
  values
    (v_patient, auth.uid(),
     coalesce(public.cc_role(v_patient), 'system'),
     v_action, tg_argv[0], v_resource, 'trigger');

  if (tg_op = 'DELETE') then return old; else return new; end if;
end;
$$;

drop trigger if exists trg_log_medications on public.medications;
create trigger trg_log_medications
  after insert or update or delete on public.medications
  for each row execute function public.log_phi_mutation('medication');

drop trigger if exists trg_log_medication_logs on public.medication_logs;
create trigger trg_log_medication_logs
  after insert or update or delete on public.medication_logs
  for each row execute function public.log_phi_mutation('medication_log');

drop trigger if exists trg_log_appointments on public.appointments;
create trigger trg_log_appointments
  after insert or update or delete on public.appointments
  for each row execute function public.log_phi_mutation('appointment');

drop trigger if exists trg_log_care_tasks on public.care_tasks;
create trigger trg_log_care_tasks
  after insert or update or delete on public.care_tasks
  for each row execute function public.log_phi_mutation('care_task');

-- vault_files is intentionally NOT triggered: its mutations always go through
-- the service-role API routes, which log richer rows in code (and a trigger
-- there would double-log with a null actor).

notify pgrst, 'reload schema';
