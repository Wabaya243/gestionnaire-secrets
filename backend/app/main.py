from contextlib import asynccontextmanager

from fastapi import FastAPI
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.config import settings
from app.database import init_db
from app.routers import auth, vault
from app.routers.auth import limiter


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Exécuté une fois au démarrage : crée les tables si absentes.
    init_db()
    yield
    # Après le yield : code d'arrêt (rien à faire ici)

app = FastAPI(
    title="Gestionnaire web sécurisé de secrets",
    version="0.1.0",
    lifespan=lifespan,
    # En production on masque la doc : elle expose toute la surface d'attaque.
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None,
)


#  Limitation de débit 
# Le limiter est attaché à l'app, son middleware intercepte chaque requête,
# et le handler renvoie un 429 propre quand le quota est dépassé.

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

#  En-têtes de sécurité 

app.middleware("http")
async def security_headers(request, call_next):
    """
    Ajoute les en-têtes défensifs à CHAQUE réponse.
    Un middleware garantit qu'aucune route ne peut les oublier.
    """
    response = await call_next(request)

    # Empêche l'inclusion du site dans une iframe (clickjacking)
    response.headers["X-Frame-Options"] = "DENY"
    # Empêche le navigateur de deviner le type MIME
    response.headers["X-Content-Type-Options"] = "nosniff"
    # Limite les informations envoyées aux sites tiers
    response.headers["Referrer-Policy"] = "no-referrer"
    # Restreint les sources de scripts : première ligne contre le XSS
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; "
        "style-src 'self' 'unsafe-inline'; object-src 'none'"
    )

    if settings.is_production:
        # Force HTTPS pendant 1 an, sous-domaines inclus
        response.headers["Strict-Transport-Security"] = (
            "max-age=31536000; includeSubDomains"
        )

    return response

app.include_router(auth.router)
app.include_router(vault.router)

# Le build React est copié ici par le script de déploiement.
STATIC_DIR = Path(__file__).parent.parent / "static"

if STATIC_DIR.exists():
    # Les fichiers compilés (JS, CSS, WASM) vivent dans /assets
    app.mount(
        "/assets",
        StaticFiles(directory=STATIC_DIR / "assets"),
        name="assets",
    )

    @app.get("/{full_path:path}")
    def serve_spa(full_path: str):
        """
        Renvoie index.html pour toute route inconnue.
        React gère la navigation côté client : le serveur doit donc
        servir la même page quel que soit le chemin demandé.

        Cette route est déclarée EN DERNIER : FastAPI teste les routes
        dans l'ordre, donc /api/... est traité avant d'arriver ici.
        """
        # Sécurité : on ne laisse jamais cette route intercepter l'API,
        # sinon une faute de frappe dans une URL renverrait du HTML
        # au lieu d'un 404 JSON.
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Route inconnue")

        return FileResponse(STATIC_DIR / "index.html")

app.get("/api/health")
def health():   
    
    return {"status": "ok"}
