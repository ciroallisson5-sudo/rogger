// Conforta Store - Supabase Configuration
const SUPABASE_CONFIG = {
  url: 'https://hzcbsarmkcrnktduymeb.supabase.co',
  anonKey: 'sb_publishable_gQxsmXuSTxufC8dazRYowg_27qWjeVy',
  restUrl: 'https://hzcbsarmkcrnktduymeb.supabase.co/rest/v1/'
};

let supabaseClient = null;

function initSupabase() {
  if (typeof supabase !== 'undefined' && !supabaseClient) {
    supabaseClient = supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true
      }
    });
    return supabaseClient;
  }
  return supabaseClient;
}

function getSupabase() {
  if (!supabaseClient) initSupabase();
  return supabaseClient;
}

async function supabaseQuery(table, options = {}) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialized');

  let query = sb.from(table).select(options.select || '*');

  if (options.filters) {
    options.filters.forEach(f => {
      if (f.method === 'eq') query = query.eq(f.column, f.value);
      else if (f.method === 'neq') query = query.neq(f.column, f.value);
      else if (f.method === 'gt') query = query.gt(f.column, f.value);
      else if (f.method === 'gte') query = query.gte(f.column, f.value);
      else if (f.method === 'lt') query = query.lt(f.column, f.value);
      else if (f.method === 'lte') query = query.lte(f.column, f.value);
      else if (f.method === 'ilike') query = query.ilike(f.column, f.value);
      else if (f.method === 'in') query = query.in(f.column, f.value);
      else if (f.method === 'contains') query = query.contains(f.column, f.value);
      else if (f.method === 'or') {
        if (typeof f.value === 'function') query = query.or(f.value);
      }
    });
  }

  if (options.order) query = query.order(options.order.column, { ascending: options.order.ascending ?? false });
  if (options.range) query = query.range(options.range.from, options.range.to);
  if (options.limit) query = query.limit(options.limit);
  if (options.single) query = query.single();

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

async function supabaseInsert(table, data) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialized');
  const { data: result, error } = await sb.from(table).insert(data).select();
  if (error) throw error;
  return result;
}

async function supabaseUpdate(table, data, match) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialized');
  let query = sb.from(table).update(data);
  if (match) {
    Object.entries(match).forEach(([key, value]) => {
      query = query.eq(key, value);
    });
  }
  const { data: result, error } = await query.select();
  if (error) throw error;
  return result;
}

async function supabaseDelete(table, match) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialized');
  let query = sb.from(table).delete();
  if (match) {
    Object.entries(match).forEach(([key, value]) => {
      query = query.eq(key, value);
    });
  }
  const { data: result, error } = await query;
  if (error) throw error;
  return result;
}

async function supabaseUpload(bucket, path, file) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialized');
  const { data, error } = await sb.storage.from(bucket).upload(path, file, {
    cacheControl: '3600',
    upsert: true
  });
  if (error) throw error;
  const { data: urlData } = sb.storage.from(bucket).getPublicUrl(path);
  return urlData.publicUrl;
}

async function supabaseRpc(functionName, params = {}) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialized');
  const { data, error } = await sb.rpc(functionName, params);
  if (error) throw error;
  return data;
}
