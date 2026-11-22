import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const config = window.FOREVER_SUPABASE_CONFIG;
if (!config?.url || !config?.publishableKey) {
  throw new Error('Supabase yapılandırması bulunamadı. supabase-config.js dosyasını kontrol et.');
}

export const supabase = createClient(config.url, config.publishableKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    flowType: 'pkce'
  },
  realtime: {
    params: { eventsPerSecond: 10 }
  }
});
