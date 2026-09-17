"""MIP RUM — middleware ASGI de tracing distribué (un fichier, stdlib uniquement).

Lit le header W3C ``traceparent`` injecté par le SDK web MIP RUM, chronomètre la
requête, et expédie un span OTLP/HTTP JSON ``http.server`` vers l'ingestion MIP.
La corrélation front→back se fait par trace_id ; la session web (optionnelle)
voyage dans ``tracestate: mip=s:<session_id>``.

Activation par variables d'environnement — sans elles, passthrough total :
  MIP_RUM_ENDPOINT  ex. https://xxx.supabase.co/functions/v1/v1-traces
  MIP_RUM_APP_ID    ex. gip-plateforme
  MIP_RUM_API_KEY   optionnel (clé d'app MIP RUM)
  MIP_RUM_IGNORE    routes exactes ignorées (défaut "/health,/docs,/openapi.json,/favicon.ico")

Usage FastAPI / Starlette :
  from mip_rum_middleware import MIPRumMiddleware
  app.add_middleware(MIPRumMiddleware)

Garanties : le tracing ne lève jamais d'exception vers l'app hôte, et n'avale
jamais celle de l'app ; ni corps, ni query string, ni header métier collectés
(route template + méthode + statut + durée) ; batch mémoire borné (flush 5 s ou
20 spans, file coupée à 1000) ; envoi best effort (timeout 3 s, échec
silencieux) — un restart peut perdre la fenêtre de flush courante, assumé.

Exceptions (P5.3) : une exception non gérée devient un événement ``exception``
du span (type, message, stack, ``mip.exception_id``), puis REMONTE intacte au
serveur ASGI. Levée avant le début de la réponse, le serveur répondra 500 : le
span porte ce 500. Levée après, le statut déjà envoyé est conservé et le span est
marqué en échec (statut OTLP ERROR, ``error.type``) — jamais un 500 inventé. Une
annulation (``asyncio.CancelledError``, client parti) n'est pas une exception
applicative.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import secrets
import time
import traceback
import urllib.request

VERSION = "0.5.0"

_TRACEPARENT = re.compile(r"^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$")
_TRACESTATE_MIP = re.compile(r"(?:^|[,\s])mip=s:([A-Za-z0-9_-]{1,64})")
_SEG_NUM = re.compile(r"^\d+$")
_SEG_UUID = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I
)
_SEG_HEX = re.compile(r"^[0-9a-f]{16,}$", re.I)

_DEFAULT_IGNORE = "/health,/docs,/openapi.json,/favicon.ico"

# Plafonds d'ÉMISSION : l'ingestion scrubbe puis tronque plus court. Larges à
# dessein, pour qu'une troncature ici ne coupe jamais un secret que le scrub
# serveur n'aurait plus reconnu.
_EXCEPTION_MESSAGE_MAX = 8000
_EXCEPTION_STACK_MAX = 16000


def _normalize(path: str) -> str:
    """Même convention que le SDK web : /partners/42 -> /partners/:id."""
    segs = [
        ":id" if (_SEG_NUM.match(s) or _SEG_UUID.match(s) or _SEG_HEX.match(s)) else s
        for s in path.split("/")
    ]
    return "/".join(segs) or "/"


def _kv(key: str, value) -> dict:
    if isinstance(value, bool):
        v = {"boolValue": value}
    elif isinstance(value, int):
        v = {"intValue": str(value)}
    elif isinstance(value, float):
        v = {"doubleValue": value}
    else:
        v = {"stringValue": str(value)}
    return {"key": key, "value": v}


def _exception_event(exc: BaseException, time_ns: int) -> dict:
    """Événement OTLP ``exception`` (conventions OpenTelemetry), stack comprise.

    ``exception.type`` est le nom de la classe, comme le SDK OpenTelemetry Python :
    une même exception garde donc la même empreinte, quel que soit l'émetteur.
    """
    stack = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
    return {
        "timeUnixNano": str(time_ns),
        "name": "exception",
        "attributes": [
            _kv("exception.type", type(exc).__name__),
            _kv("exception.message", str(exc)[:_EXCEPTION_MESSAGE_MAX]),
            _kv("exception.stacktrace", stack[:_EXCEPTION_STACK_MAX]),
            # Identité stable de CETTE exception : un log qui la décrirait aussi
            # porterait le même identifiant, et l'ingestion n'en garderait qu'une.
            _kv("mip.exception_id", secrets.token_hex(16)),
            # Elle a traversé toute l'app sans être interceptée.
            _kv("mip.error_handled", False),
        ],
    }


def _post(endpoint: str, payload: dict) -> None:
    """POST OTLP bloquant (exécuté hors event loop, via run_in_executor)."""
    req = urllib.request.Request(
        endpoint,
        data=json.dumps(payload).encode(),
        headers={"content-type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=3) as resp:
        resp.read()


class MIPRumMiddleware:
    """Middleware ASGI pur (pas de BaseHTTPMiddleware : zéro buffering du corps)."""

    def __init__(
        self,
        app,
        endpoint: str | None = None,
        app_id: str | None = None,
        api_key: str | None = None,
        service_name: str = "fastapi",
        ignore: str | None = None,
        flush_s: float = 5.0,
        batch_size: int = 20,
        queue_max: int = 1000,
    ) -> None:
        self.app = app
        self.endpoint = endpoint or os.environ.get("MIP_RUM_ENDPOINT")
        self.app_id = app_id or os.environ.get("MIP_RUM_APP_ID")
        self.api_key = api_key or os.environ.get("MIP_RUM_API_KEY")
        self.service_name = service_name
        self.ignore = set(
            s.strip()
            for s in (ignore or os.environ.get("MIP_RUM_IGNORE") or _DEFAULT_IGNORE).split(",")
            if s.strip()
        )
        self.flush_s = flush_s
        self.batch_size = batch_size
        self.queue_max = queue_max
        self.enabled = bool(self.endpoint and self.app_id)
        self._buf: list[dict] = []
        self._task: asyncio.Task | None = None
        # compteur observable : spans perdus faute de place (file saturée). Reste
        # à 0 en régime nominal ; non nul = l'ingestion ne suit pas le débit.
        self._dropped = 0

    # --- ASGI -----------------------------------------------------------------
    async def __call__(self, scope, receive, send):
        if not self.enabled or scope.get("type") != "http":
            return await self.app(scope, receive, send)

        # État PROPRE à cette requête : rien n'est partagé entre deux appels
        # concurrents, donc aucune exception ne peut changer de trace.
        state = {"code": 0, "started": False}

        async def send_wrapper(message):
            await send(message)
            # Après l'envoi : un début de réponse refusé par le serveur n'a pas
            # commencé, et son statut n'a jamais été reçu par le client.
            if message.get("type") == "http.response.start":
                state["code"] = int(message.get("status", 0))
                state["started"] = True

        start_ns = time.time_ns()
        t0 = time.perf_counter()
        failure = None
        try:
            await self.app(scope, receive, send_wrapper)
        except Exception as exc:
            # Observée puis relancée telle quelle : `raise` sans argument garde la
            # traceback d'origine. `CancelledError` (client parti) n'est pas une
            # `Exception` et traverse sans être enregistrée.
            failure = (exc, time.time_ns())
            raise
        finally:
            try:
                self._record(scope, state, t0, start_ns, failure)
            except Exception:  # le tracing ne casse JAMAIS la requête hôte
                pass

    # --- collecte ---------------------------------------------------------------
    def _record(self, scope, state: dict, t0: float, start_ns: int, failure=None) -> None:
        path = scope.get("path", "/")
        if path in self.ignore or scope.get("method") == "OPTIONS":
            return  # préflights CORS : jamais de span
        duration_ms = round((time.perf_counter() - t0) * 1000, 1)

        headers = {}
        for k, v in scope.get("headers") or []:
            if k in (b"traceparent", b"tracestate"):
                headers[k.decode("latin1")] = v.decode("latin1")

        m = _TRACEPARENT.match(headers.get("traceparent", ""))
        trace_id = m.group(1) if m else secrets.token_hex(16)
        parent_span_id = m.group(2) if m else None
        span_id = secrets.token_hex(8)
        ms = _TRACESTATE_MIP.search(headers.get("tracestate", ""))
        session_id = ms.group(1) if ms else None

        # route template FastAPI si le routing l'a posée, sinon path normalisé
        route = scope.get("route")
        route_path = getattr(route, "path_format", None) or getattr(route, "path", None)
        if not route_path:
            route_path = _normalize(path)

        status_code = state["code"]
        if failure is not None and not state["started"]:
            # Rien n'est parti : le serveur ASGI répondra 500 à la place de l'app.
            status_code = 500

        attrs = [
            _kv("mip.trace_id", trace_id),
            _kv("mip.span_id", span_id),
            _kv("mip.route", route_path),
            _kv("http.url", path),
            _kv("http.method", str(scope.get("method", "GET")).upper()),
            _kv("http.status_code", int(status_code)),
            _kv("http.duration_ms", float(duration_ms)),
        ]
        if parent_span_id:
            attrs.append(_kv("mip.parent_span_id", parent_span_id))
        if session_id:
            attrs.append(_kv("mip.session_id", session_id))
        if failure is not None:
            # Indicateur d'échec standard, indépendant du statut déjà envoyé.
            attrs.append(_kv("error.type", type(failure[0]).__name__))

        span = {
            "traceId": trace_id,
            "spanId": span_id,
            "name": "http.server",
            "kind": 2,
            "startTimeUnixNano": str(start_ns),
            "endTimeUnixNano": str(start_ns + int(duration_ms * 1_000_000)),
            "attributes": attrs,
        }
        if parent_span_id:
            span["parentSpanId"] = parent_span_id
        if failure is not None:
            span["status"] = {"code": 2}  # ERROR
            span["events"] = [_exception_event(*failure)]

        if len(self._buf) >= self.queue_max:
            overflow = len(self._buf) - self.queue_max + 1
            del self._buf[:overflow]  # on jette les plus anciens (FIFO borné)
            self._dropped += overflow
        self._buf.append(span)

        loop = asyncio.get_running_loop()
        if self._task is None or self._task.done():
            self._task = loop.create_task(self._flush_loop())
        if len(self._buf) >= self.batch_size:
            asyncio.ensure_future(self._flush())

    # --- expédition ---------------------------------------------------------------
    def _otlp(self, batch: list[dict]) -> dict:
        res_attrs = [
            _kv("service.name", self.service_name),
            _kv("mip.app_id", self.app_id),
        ]
        if self.api_key:
            res_attrs.append(_kv("mip.api_key", self.api_key))
        return {
            "resourceSpans": [
                {
                    "resource": {"attributes": res_attrs},
                    "scopeSpans": [
                        {
                            "scope": {"name": "mip-rum-fastapi", "version": VERSION},
                            "spans": batch,
                        }
                    ],
                }
            ]
        }

    async def _flush(self) -> None:
        if not self._buf:
            return
        batch, self._buf = self._buf[:200], self._buf[200:]
        try:
            await asyncio.get_running_loop().run_in_executor(
                None, _post, self.endpoint, self._otlp(batch)
            )
        except Exception:
            pass  # best effort : pas de retry côté serveur (volume négligeable)

    async def _flush_loop(self) -> None:
        while True:
            await asyncio.sleep(self.flush_s)
            await self._flush()
