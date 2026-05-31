# Recrutamento Autofill IA 🚀

Uma extensão moderna para Google Chrome projetada para automatizar o preenchimento de formulários de recrutamento e vagas de emprego (como Gupy, Greenhouse, Lever, etc.) de forma inteligente. A extensão utiliza a API do **Google Gemini** para responder perguntas complexas e o **Supabase** para gerenciar o perfil profissional, o histórico de perguntas/respostas (com busca vetorial) e o armazenamento do currículo e carta de apresentação.

---

## ✨ Características & Funcionalidades

### 1. 🤖 Autopreenchimento Inteligente (Batch Fill)
* **Preenchimento em Lote**: Em vez de fazer requisições individuais que causam gargalos de limite de taxa (rate limit), a extensão escaneia o formulário inteiro, monta o contexto do seu perfil profissional e gera as respostas em uma única chamada de IA.
* **Respeito às Opções do DOM**: A IA é instruída a mapear respostas exatas de dropdowns (select), botões de opção (radio) e caixas de seleção (checkboxes) com base nas opções disponíveis na página, evitando respostas incompatíveis.
* **Suporte a Múltiplos Idiomas**: Detecta se a pergunta está em inglês ou português e responde no idioma correspondente.

### 2. ☁️ Aprendizado Inline e Integrado (In-Context Learning)
* **Ícone de Upload Dinâmico**: Ao lado de cada campo identificado no formulário, é injetado um ícone de nuvem (upload).
* **Ativação Baseada em Conteúdo**: O botão de upload fica desabilitado se o campo estiver vazio e se ativa assim que o usuário preenche ou edita o campo.
* **Validação de Conteúdo Inédito**: Se o campo for novo, ao clicar no upload, abre-se um modal elegante para você revisar e editar a pergunta e a resposta antes de enviar ao banco de dados.
* **Sobrescrita Inteligente**: Se o banco já possuir uma resposta para aquela pergunta (ou similar via busca semântica), um modal exibe o valor anterior e o novo lado a lado para confirmação antes de sobrescrever.
* **Feedback Visual Premium**: Transições suaves, animação de carregamento (spinner), botão verde com checkmark ao salvar com sucesso e sistema de notificações Toast flutuantes e elegantes.

### 3. 🔍 Busca Semântica Avançada (pgvector)
* A extensão gera embeddings vetoriais de 1536 dimensões para as perguntas usando a API de Embeddings do Gemini.
* Utiliza busca semântica no banco de dados via função RPC do Supabase (`match_questions`), com limiar de similaridade de cosseno de `0.8`, garantindo que perguntas reescritas ou parecidas encontrem respostas salvas anteriormente sem precisar da IA.

### 4. 📁 Anexo Automático de Arquivos
* Permite carregar o seu Currículo (CV) e Carta de Apresentação diretamente para o Supabase Storage (`recruitment-files`).
* Mapeia inputs do tipo `file` e injeta os arquivos correspondentes em formato PDF diretamente no formulário usando a API `DataTransfer` do navegador.

### 5. ⚙️ Ajustes Dinâmicos de Modelos e APIs
* Interface de ajustes para salvar URL e chaves do Supabase (Anon e Service Role) e chave do Google Gemini.
* Consulta em tempo real a lista de modelos de IA compatíveis no Google AI Studio (ex: `gemini-2.5-flash`, `gemini-2.0-flash`, `gemini-1.5-pro`) para você escolher o seu preferido na aba Ajustes.

---

## 🛠️ Arquitetura e Estrutura do Projeto

A extensão segue a especificação **Manifest V3** do Google Chrome:

```
├── manifest.json            # Manifesto da extensão
├── background.js            # Service Worker (coordena chamadas de APIs e estado)
├── content.js               # Script de conteúdo (interage com a página do formulário)
├── popup.html               # Painel lateral / Popup da extensão
├── popup.js                 # Lógica da interface do painel lateral
├── popup.css                # Estilização da interface da extensão
├── schema.sql               # Estrutura de banco e funções do Supabase
├── LICENSE                  # Licença MIT
├── README.md                # Este arquivo de documentação
├── styles/
│   └── content.css          # Estilos injetados na página do formulário (modais, botões)
└── utils/
    ├── dom-parser.js        # Utilitário para ler campos e descobrir labels no DOM
    ├── form-filler.js       # Simula digitação realista caractere a caractere para SPAs
    ├── gemini-client.js     # Cliente nativo para a API de IA do Google Gemini
    ├── storage-manager.js   # Gerenciamento local das chaves (chrome.storage)
    └── supabase-client.js   # Cliente REST leve e assíncrono para o Supabase (sem SDK pesada)
```

---

## 💾 Configuração do Banco de Dados (Supabase)

Execute o arquivo [schema.sql](schema.sql) no Editor SQL do seu projeto do Supabase. Ele irá:

1. Habilitar a extensão de vetores (`vector`).
2. Criar a tabela `perfil_profissional` para guardar as informações densas sobre você.
3. Criar a tabela `qa_historico` com a coluna `embedding vector(1536)` para guardar o histórico de perguntas e respostas.
4. Criar a função RPC `match_questions` para busca semântica vetorial rápida.
5. Configurar as políticas de Row Level Security (RLS) para permitir o uso pessoal.
6. Criar índices para busca textual rápida em português e busca vetorial (`ivfflat`).

---

## 🚀 Instalação Local

1. Baixe ou clone este repositório para sua máquina.
2. Abra o Google Chrome e acesse `chrome://extensions/`.
3. Ative o **Modo do desenvolvedor** (canto superior direito).
4. Clique em **Carregar sem compactação** (canto superior esquerdo) e selecione a pasta deste projeto.
5. O painel lateral abrirá ao clicar no ícone da extensão.

---

## ⚙️ Configuração Inicial

1. Abra a extensão no seu navegador e acesse a aba **Ajustes**.
2. Preencha os campos com os dados do seu projeto do Supabase (URL e chaves) e a sua chave da API do Gemini (obtida gratuitamente no Google AI Studio).
3. Clique em **Validar & Salvar**. O sistema testará as conexões e exibirá badges verdes indicando que está tudo conectado.
4. Vá para a aba **Arquivos** e carregue seu Currículo e Carta de Apresentação em formato PDF.
5. Pronto! Agora acesse qualquer formulário de vaga de emprego, clique em **Buscar Campos** e depois em **Autopreencher**.

---

## 📄 Licença

Este projeto está licenciado sob a licença MIT. Consulte o arquivo [LICENSE](LICENSE) para obter mais informações.
