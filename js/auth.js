// Conforta Store - Authentication

async function checkAuth() {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const { data: { user }, error } = await sb.auth.getUser();
    if (error || !user) return null;
    return user;
  } catch { return null; }
}

async function signUp(email, password, fullName, phone) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialized');

  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName, phone }
    }
  });
  if (error) throw error;
  return data;
}

async function signIn(email, password) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialized');

  const { data, error } = await sb.auth.signInWithPassword({
    email,
    password
  });
  if (error) throw error;
  return data;
}

async function signOut() {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialized');
  const { error } = await sb.auth.signOut();
  if (error) throw error;
  if (typeof siteNavigate === 'function') siteNavigate('index.html');
  else window.location.href = 'index.html';
}

async function getProfile(userId) {
  try {
    const sb = getSupabase();
    if (!sb) return null;
    const { data, error } = await sb.from('profiles').select('*').eq('id', userId).maybeSingle();
    if (error) throw error;
    return data;
  } catch { return null; }
}

async function updateProfile(userId, updates) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialized');
  const patch = { ...updates };
  delete patch.id;
  delete patch.email;

  const { data: updated, error: updateErr } = await sb
    .from('profiles')
    .update(patch)
    .eq('id', userId)
    .select()
    .maybeSingle();

  if (updateErr) {
    const msg = String(updateErr.message || '');
    const missingCol =
      updateErr.code === 'PGRST204' ||
      /cpf_cnpj/i.test(msg) ||
      /column.*does not exist/i.test(msg);
    if (missingCol && patch.cpf_cnpj != null) {
      const err = new Error(
        'Campo CPF/CNPJ ainda não existe no banco. Execute o SQL database/profiles_cpf_cnpj.sql no Supabase.'
      );
      err.code = 'CPF_COLUMN_MISSING';
      throw err;
    }
    throw updateErr;
  }

  if (updated) return updated;

  const row = { id: userId, ...patch };
  const { data: inserted, error: insertErr } = await sb.from('profiles').insert(row).select().maybeSingle();
  if (insertErr) throw insertErr;
  return inserted;
}

async function uploadAvatar(userId, file) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialized');
  const ext = file.name.split('.').pop();
  const path = `avatars/${userId}.${ext}`;
  const url = await supabaseUpload('public', path, file);
  await updateProfile(userId, { avatar_url: url });
  return url;
}

async function uploadBanner(userId, file) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialized');
  const ext = file.name.split('.').pop();
  const path = `banners/${userId}.${ext}`;
  const url = await supabaseUpload('public', path, file);
  await updateProfile(userId, { banner_url: url });
  return url;
}

// Auth UI helpers
function renderAuthModal() {
  const html = `
    <div class="modal-overlay" id="authModal">
      <div class="modal">
        <div class="modal-header">
          <h3 id="authModalTitle">Entrar</h3>
          <button class="modal-close" onclick="closeModal('authModal')">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="modal-body" id="authModalBody">
          <div id="authLoginForm">
            <div class="form-group">
              <label class="form-label">E-mail</label>
              <input class="form-input" type="email" id="authEmail" placeholder="seu@email.com">
            </div>
            <div class="form-group">
              <label class="form-label">Senha</label>
              <input class="form-input" type="password" id="authPassword" placeholder="Sua senha">
            </div>
            <button class="btn btn-primary btn-block" onclick="handleSignIn()">Entrar</button>
            <p style="text-align:center;margin-top:12px;font-size:0.85rem;color:var(--gray-500)">
              Não tem conta? <a href="#" style="color:var(--primary);font-weight:600" onclick="showSignUp()">Cadastre-se</a>
            </p>
          </div>
          <div id="authSignUpForm" style="display:none">
            <div class="form-group">
              <label class="form-label">Nome completo</label>
              <input class="form-input" type="text" id="authName" placeholder="Seu nome">
            </div>
            <div class="form-group">
              <label class="form-label">E-mail</label>
              <input class="form-input" type="email" id="authEmailSignUp" placeholder="seu@email.com">
            </div>
            <div class="form-group">
              <label class="form-label">Telefone</label>
              <input class="form-input" type="tel" id="authPhone" placeholder="(27) 99999-9999">
            </div>
            <div class="form-group">
              <label class="form-label">Senha</label>
              <input class="form-input" type="password" id="authPasswordSignUp" placeholder="Mínimo 6 caracteres">
            </div>
            <button class="btn btn-primary btn-block" onclick="handleSignUp()">Criar conta</button>
            <p style="text-align:center;margin-top:12px;font-size:0.85rem;color:var(--gray-500)">
              Já tem conta? <a href="#" style="color:var(--primary);font-weight:600" onclick="showSignIn()">Entrar</a>
            </p>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', html);
}

function showSignUp() {
  document.getElementById('authLoginForm').style.display = 'none';
  document.getElementById('authSignUpForm').style.display = 'block';
  document.getElementById('authModalTitle').textContent = 'Criar conta';
}

function showSignIn() {
  document.getElementById('authLoginForm').style.display = 'block';
  document.getElementById('authSignUpForm').style.display = 'none';
  document.getElementById('authModalTitle').textContent = 'Entrar';
}

async function handleSignIn() {
  const email = document.getElementById('authEmail').value;
  const password = document.getElementById('authPassword').value;
  if (!email || !password) { showToast('Preencha e-mail e senha.', 'error'); return; }
  try {
    showLoading(true);
    await signIn(email, password);
    showToast('Login realizado com sucesso!', 'success');
    closeModal('authModal');
    setTimeout(() => window.location.reload(), 500);
  } catch (e) {
    showToast('E-mail ou senha inválidos.', 'error');
  } finally { showLoading(false); }
}

async function handleSignUp() {
  const name = document.getElementById('authName').value;
  const email = document.getElementById('authEmailSignUp').value;
  const phone = document.getElementById('authPhone').value;
  const password = document.getElementById('authPasswordSignUp').value;
  if (!name || !email || !password) { showToast('Preencha todos os campos.', 'error'); return; }
  if (password.length < 6) { showToast('A senha deve ter no mínimo 6 caracteres.', 'error'); return; }
  try {
    showLoading(true);
    await signUp(email, password, name, phone);
    showToast('Conta criada! Verifique seu e-mail.', 'success');
    closeModal('authModal');
  } catch (e) {
    showToast(e.message || 'Erro ao criar conta.', 'error');
  } finally { showLoading(false); }
}

// Init auth UI
document.addEventListener('DOMContentLoaded', () => {
  renderAuthModal();
  const sb = getSupabase();
  if (sb) {
    sb.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
        updateCartCount();
        updateUserUI();
      }
    });
  }
  updateUserUI();
});

async function updateUserUI() {
  const user = await checkAuth();
  const authBtn = document.getElementById('authBtn');
  if (!authBtn) return;
  const iconSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
  if (user) {
    authBtn.innerHTML = iconSvg;
    authBtn.setAttribute('aria-label', 'Meu perfil');
    authBtn.href = 'perfil.html';
  } else {
    authBtn.innerHTML = iconSvg;
    authBtn.setAttribute('aria-label', 'Entrar');
    authBtn.href = 'perfil.html';
  }
}
