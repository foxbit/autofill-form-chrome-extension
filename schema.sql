-- 1. Habilitar a extensão pgvector para busca semântica
create extension if not exists vector;

-- 2. Tabela: perfil_profissional
create table if not exists public.perfil_profissional (
  id uuid default gen_random_uuid() primary key,
  secao varchar(100) not null,
  -- Valores possíveis: 'dados_pessoais', 'experiencia', 'ux_design', 'ui_design', 
  -- 'gestao_lideranca', 'habilidades_tecnicas', 'ia_automacao'
  
  titulo_bloco varchar(255) not null,
  -- Ex: 'Case SVA+ Carrefour', 'Habilidade Bash', 'Experiência em Liderança'
  
  conteudo text not null,
  -- Texto denso com descrição das competências e cases
  
  tags text[] default array[]::text[],
  -- Ex: ['React', 'Bash', 'Product Design', 'SaaS', 'Liderança']
  
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  
  constraint unique_secao_titulo unique(secao, titulo_bloco)
);

-- Habilitar Row Level Security (RLS)
alter table public.perfil_profissional enable row level security;

-- Criar políticas de acesso simplificadas (uso pessoal)
create policy "Allow all access to perfil_profissional" 
  on public.perfil_profissional for all 
  using (true) with check (true);

-- 3. Tabela: qa_historico
create table if not exists public.qa_historico (
  id uuid default gen_random_uuid() primary key,
  
  pergunta text not null unique,
  -- A pergunta exata do formulário
  -- Ex: "Qual sua pretensão salarial?"
  
  resposta text not null,
  -- A resposta validada pelo usuário
  
  idioma varchar(10) default 'pt',
  -- 'pt' para português, 'en' para inglês
  
  embedding vector(1536) default null,
  -- Embedding vetorial da pergunta para busca semântica
  -- Dimensão: 1536 (padrão do Google Embeddings API)
  
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  
  constraint check_idioma check (idioma in ('pt', 'en'))
);

-- Habilitar Row Level Security (RLS)
alter table public.qa_historico enable row level security;

-- Criar políticas de acesso simplificadas (uso pessoal)
create policy "Allow all access to qa_historico" 
  on public.qa_historico for all 
  using (true) with check (true);

-- Índices para busca vetorial rápida (IVFFlat)
create index if not exists qa_historico_embedding_idx on public.qa_historico using ivfflat (embedding vector_cosine_ops);

-- Índice GIN para busca textual exata/FTS no idioma português
create index if not exists qa_historico_pergunta_idx on public.qa_historico using gin(to_tsvector('portuguese', pergunta));

-- 4. Função para Busca Semântica (RPC)
create or replace function public.match_questions (
  query_embedding vector(1536),
  match_threshold float,
  match_count int
)
returns table (
  id uuid,
  pergunta text,
  resposta text,
  idioma varchar(10),
  similarity float
)
language sql stable
as $$
  select
    id,
    pergunta,
    resposta,
    idioma,
    1 - (embedding <=> query_embedding) as similarity
  from public.qa_historico
  where 1 - (embedding <=> query_embedding) > match_threshold
  order by embedding <=> query_embedding
  limit match_count;
$$;
