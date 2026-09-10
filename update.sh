#!/bin/bash
set -e

# Navega para o diretório do repositório (onde o script está localizado)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🔄 Atualizando repositório Git..."

# Identifica a branch atual
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "📌 Branch atual: $CURRENT_BRANCH"

# Busca as alterações remotas
echo "🌐 Buscando alterações do repositório remoto (git fetch)..."
git fetch origin

# Realiza o pull da branch atual
echo "📥 Baixando e aplicando alterações (git pull origin $CURRENT_BRANCH)..."
git pull origin "$CURRENT_BRANCH"

echo "✅ Repositório atualizado com sucesso!"
