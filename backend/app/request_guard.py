"""Bound request bytes before JSON parsing; reject browser cross-origin mutations."""
from fastapi.responses import JSONResponse
from app.config import settings


class RequestGuard:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope["path"].startswith("/api/"):
            return await self.app(scope, receive, send)
        headers = dict(scope["headers"])
        if scope["method"] in {"POST", "PUT", "PATCH", "DELETE"}:
            # A custom header requires a CORS preflight cross-origin; no CORS is enabled.
            if headers.get(b"x-vault-request") != b"1" or headers.get(b"sec-fetch-site") == b"cross-site":
                return await JSONResponse({"detail": "Requête d’origine non autorisée"}, 403)(scope, receive, send)
        limit = ((settings.MAX_FILE_BYTES + 28 + 2) // 3 * 4 + 8192
                 if scope["path"] == "/api/files" and scope["method"] == "POST" else 64 * 1024)
        try:
            declared = int(headers.get(b"content-length", b"0"))
        except ValueError:
            return await JSONResponse({"detail": "Taille de requête invalide"}, 400)(scope, receive, send)
        if declared > limit:
            return await JSONResponse({"detail": "Requête trop volumineuse"}, 413)(scope, receive, send)
        chunks = []
        length = 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            length += len(chunk)
            if length > limit:
                return await JSONResponse({"detail": "Requête trop volumineuse"}, 413)(scope, receive, send)
            chunks.append(chunk)
            if not message.get("more_body", False):
                break
        delivered = False

        async def replay():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": b"".join(chunks), "more_body": False}
            return await receive()

        await self.app(scope, replay, send)
