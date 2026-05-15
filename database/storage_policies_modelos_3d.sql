-- Políticas do Storage para o bucket `modelos-3d`
-- Problema comum: bucket "público" na UI mas 0 policies em storage.objects — leitura via API
-- ou consistência com o resto do projeto falha; o bucket `public` costuma ter várias policies.
--
-- Como aplicar: Supabase → SQL Editor → colar e executar (uma vez).
-- Nome do bucket deve bater com o código (default `modelos-3d` em api/gerar-3d.js e produto.html).

-- Leitura para visitantes e usuários logados (URLs públicas + storage.from().download/list)
DROP POLICY IF EXISTS "modelos_3d_select_anon" ON storage.objects;
CREATE POLICY "modelos_3d_select_anon"
  ON storage.objects
  FOR SELECT
  TO anon
  USING (bucket_id = 'modelos-3d');

DROP POLICY IF EXISTS "modelos_3d_select_authenticated" ON storage.objects;
CREATE POLICY "modelos_3d_select_authenticated"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'modelos-3d');

-- Upload do GLB pelo admin no navegador (supabase.storage com JWT) exige INSERT no bucket.
-- A pipeline Tripo na Vercel usa SERVICE_ROLE (fora destas policies).
-- ATENÇÃO: isto permite qualquer usuário autenticado escrever neste bucket. Se a loja tiver
-- cadastro de clientes, restrinja com uma condição (ex.: tabela de admins ou claim no JWT).
/*
DROP POLICY IF EXISTS "modelos_3d_insert_authenticated" ON storage.objects;
CREATE POLICY "modelos_3d_insert_authenticated"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'modelos-3d');

DROP POLICY IF EXISTS "modelos_3d_update_authenticated" ON storage.objects;
CREATE POLICY "modelos_3d_update_authenticated"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (bucket_id = 'modelos-3d')
  WITH CHECK (bucket_id = 'modelos-3d');

DROP POLICY IF EXISTS "modelos_3d_delete_authenticated" ON storage.objects;
CREATE POLICY "modelos_3d_delete_authenticated"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'modelos-3d');
*/
