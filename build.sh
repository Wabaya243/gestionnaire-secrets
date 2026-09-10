#!/usr/bin/env bash
set -o errexit          # arrête tout à la première erreur

# 1. Compiler le frontend React
cd frontend
npm ci                  # ci plutôt que install : respecte le lockfile
npm run build           # produit frontend/dist/

# 2. Copier le build là où FastAPI le cherche
cd ..
rm -rf backend/static
cp -r frontend/dist backend/static

# 3. Installer les dépendances Python
pip install -r backend/requirements.txt