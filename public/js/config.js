/**
 * Configuração do organize! — é o ÚNICO arquivo que você precisa editar para publicar o app.
 *
 * Onde pegar os dois valores: Supabase → Project Settings → API (ou "Connect").
 *
 *   supabaseUrl      : "Project URL", algo como https://abcdefghijk.supabase.co
 *   supabaseAnonKey  : a chave PÚBLICA, chamada "anon public" (começa com eyJ...) ou "Publishable key" (sb_publishable_...)
 *
 * ATENÇÃO: use SOMENTE a chave pública. NUNCA coloque aqui a "service_role" nem a "secret"
 * (sb_secret_...): este arquivo vai para o GitHub e qualquer pessoa consegue ler.
 * A chave pública é feita para ficar à vista — quem protege os dados é a segurança por linha (RLS) do banco.
 */
window.ORGANIZE_CONFIG = {
  supabaseUrl: 'https://cgqfpmvktomgzibkiejs.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNncWZwbXZrdG9tZ3ppYmtpZWpzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE5NzM1NDYsImV4cCI6MjEwNzU0OTU0Nn0.6fGrgQfjAU1Wuqhutox1ne85J-FRUMdkifyxoTBXnYQ',
};