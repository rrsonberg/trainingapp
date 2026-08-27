-- Client + staff RLS for exercise_sets.
--
-- WHY THIS EXISTS
-- exercise_sets has RLS enabled and zero policies, so every write is rejected:
--   new row violates row-level security policy for table "exercise_sets"
-- The mobile outbox blocks on it and refuses to skip ahead, so a strength
-- workout never reaches the server. The identical gap on session_exercises has
-- already been closed; these are the same policies one level deeper.
--
-- SHAPE
-- Authority comes from the parent session, exactly as the existing `sessions`
-- policies define it: a client owns rows hanging off a session whose client_id
-- is their auth.uid(). Staff reach them through coaches_client / is_tenant_staff.
--
-- There is deliberately NO DELETE policy. The client soft-deletes by setting
-- deleted_at, which UPDATE already covers, and the outbox never issues a hard
-- delete. Granting DELETE would widen the surface for nothing.
--
-- Run in the Supabase SQL editor against the trainer-console project.

CREATE POLICY "client reads own sets" ON public.exercise_sets
FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.session_exercises se
            JOIN public.sessions s ON s.id = se.session_id
           WHERE se.id = exercise_sets.session_exercise_id
             AND s.client_id = auth.uid())
);

CREATE POLICY "client writes own sets" ON public.exercise_sets
FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.session_exercises se
            JOIN public.sessions s ON s.id = se.session_id
           WHERE se.id = exercise_sets.session_exercise_id
             AND s.client_id = auth.uid()
             AND NOT public.is_read_only(s.tenant_id))
);

CREATE POLICY "client updates own sets" ON public.exercise_sets
FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.session_exercises se
            JOIN public.sessions s ON s.id = se.session_id
           WHERE se.id = exercise_sets.session_exercise_id
             AND s.client_id = auth.uid()
             AND NOT public.is_read_only(s.tenant_id))
);

CREATE POLICY "staff manage sets" ON public.exercise_sets
FOR ALL USING (
  EXISTS (SELECT 1 FROM public.session_exercises se
            JOIN public.sessions s ON s.id = se.session_id
           WHERE se.id = exercise_sets.session_exercise_id
             AND (public.coaches_client(s.client_id) OR public.is_tenant_staff(s.tenant_id)))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.session_exercises se
            JOIN public.sessions s ON s.id = se.session_id
           WHERE se.id = exercise_sets.session_exercise_id
             AND (public.coaches_client(s.client_id) OR public.is_tenant_staff(s.tenant_id)))
);
