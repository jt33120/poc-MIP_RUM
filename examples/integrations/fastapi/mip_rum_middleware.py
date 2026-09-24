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

Contexte et capture manuelle (P7.4) — API minimale, ``contextvars`` de la stdlib :

  from mip_rum_middleware import MIPRumMiddleware, capture_exception, rum_context

  app.add_middleware(MIPRumMiddleware)

  @app.post("/commandes")
  async def creer(commande: Commande):
      with rum_context(user_id=commande.client, canal="web"):
          try:
              return await traiter(commande)
          except PaiementRefuse as exc:
              capture_exception(exc, {"moyen": commande.moyen})
              raise  # une seule erreur : l'identifiant est porté par l'exception

Le contexte est porté par un ``ContextVar`` : chaque requête a le sien, chaque
tâche ``asyncio`` hérite du sien, et le scope précédent est restauré dans un
``finally``. Rien ne survit à la fin d'une requête.
"""

from __future__ import annotations

import asyncio
import contextlib
import contextvars
import json
import os
import re
import secrets
import time
import traceback
import urllib.request

VERSION = "0.6.0"

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

# Limites du contexte, alignées sur le port d'ingestion (qui reborne et scrubbe :
# ce bornage-ci évite un aller-retour inutile, il ne le remplace pas).
_CONTEXT_MAX_NAME = 100
_CONTEXT_MAX_STRING = 500
_CONTEXT_MAX_KEYS = 64
_SESSION_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

# Attributs de scope reconnus : tout le reste est du contexte métier libre.
_SCOPE_FIELDS = ("session_id", "route", "user_id", "account_id")


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


def _exception_id(exc: BaseException) -> str:
    """Identité STABLE d'une exception, portée par l'objet lui-même.

    C'est ce qui permet à une capture manuelle suivie d'un ``raise`` de ne pas
    produire deux erreurs : le middleware retrouve le même identifiant sur le même
    objet. Deux exceptions DIFFÉRENTES décrivant le même incident n'ont, elles,
    aucun identifiant commun — elles restent deux erreurs, et c'est volontaire :
    on ne devine pas une égalité.
    """
    existant = getattr(exc, "_mip_rum_exception_id", None)
    if isinstance(existant, str) and existant:
        return existant
    identifiant = secrets.token_hex(16)
    try:
        exc._mip_rum_exception_id = identifiant  # type: ignore[attr-defined]
    except Exception:
        # Exception à ``__slots__`` sans ``__dict__`` : l'identité ne peut pas
        # être mémorisée. Elle reste unique, donc jamais dédupliquée — plutôt
        # deux lignes qu'une fusion arbitraire.
        pass
    return identifiant


def _exception_event(exc: BaseException, time_ns: int, handled: bool = False) -> dict:
    """Événement OTLP ``exception`` (conventions OpenTelemetry), stack comprise.

    ``exception.type`` est le nom de la classe, comme le SDK OpenTelemetry Python :
    une même exception garde donc la même empreinte, quel que soit l'émetteur.
    ``handled`` distingue la capture manuelle (le code l'a interceptée) de
    l'exception qui a traversé toute l'app.
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
            _kv("mip.exception_id", _exception_id(exc)),
            _kv("mip.error_handled", handled),
        ],
    }


# --- contexte de requête (P7.4) ------------------------------------------------
# Un ``ContextVar`` par requête : chaque tâche asyncio hérite du scope de celle
# qui l'a créée, et deux requêtes concurrentes ne partagent rien. Le scope
# précédent est TOUJOURS restauré dans un ``finally`` — y compris quand la
# requête lève — donc rien ne survit à la fin d'une requête.

_SCOPE: contextvars.ContextVar = contextvars.ContextVar("mip_rum_scope", default=None)


_REFUSE = object()  # sentinelle : « valeur non représentable », distincte de None


def _bounded_value(value):
    """Valeur de contexte conservée : chaîne bornée, nombre, booléen ou ``None``.

    ``None`` est une valeur — « inconnu » —, pas une absence : il ne devient
    jamais 0 ni "". Tout le reste est refusé plutôt que sérialisé au hasard.
    """
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, str):
        return value[:_CONTEXT_MAX_STRING]
    return _REFUSE


def _bounded_context(attributes) -> dict:
    if not isinstance(attributes, dict):
        return {}
    out = {}
    for key, value in attributes.items():
        if len(out) >= _CONTEXT_MAX_KEYS:
            break
        if not isinstance(key, str) or not key.strip() or len(key) > _CONTEXT_MAX_NAME:
            continue
        clean = _bounded_value(value)
        if clean is _REFUSE:
            continue
        out[key.strip()] = clean
    return out


class _Scope:
    """État partagé d'une requête : trace, identité et exceptions à émettre."""

    __slots__ = ("trace_id", "span_id", "parent_span_id", "session_id", "route",
                 "user_id", "account_id", "attributes", "events", "seen", "racine")

    def __init__(self, trace_id, span_id, parent_span_id, session_id):
        self.trace_id = trace_id
        self.span_id = span_id
        self.parent_span_id = parent_span_id
        self.session_id = session_id
        self.route = None
        self.user_id = None
        self.account_id = None
        self.attributes: dict = {}
        # Événements `exception` déjà retenus pour le span de CETTE requête, et
        # leurs identifiants : une même exception n'y entre qu'une fois.
        self.events: list = []
        self.seen: set = set()
        # Scope RACINE de la requête — celui dont le span sera émis. Un scope
        # imbriqué garde sa vue lexicale, mais ce qu'il DÉCLARE appartient à la
        # requête : sans ce lien, un `rum_context` posé dans une fonction
        # appelée n'arriverait jamais sur le span.
        self.racine = self

    def derive(self, **champs) -> "_Scope":
        """Copie du scope avec des champs remplacés. Exceptions, identifiants et
        racine restent PARTAGÉS : un scope imbriqué enrichit le contexte, il ne
        crée pas un second span pour la même requête."""
        clone = _Scope(self.trace_id, self.span_id, self.parent_span_id, self.session_id)
        clone.route = self.route
        clone.user_id = self.user_id
        clone.account_id = self.account_id
        clone.attributes = dict(self.attributes)
        clone.events = self.events
        clone.seen = self.seen
        clone.racine = self.racine
        for nom, valeur in champs.items():
            setattr(clone, nom, valeur)
        return clone


def current_context() -> dict | None:
    """Contexte de la requête courante (copie en lecture), ou ``None`` hors requête."""
    scope = _SCOPE.get()
    if scope is None:
        return None
    return {
        "trace_id": scope.trace_id,
        "span_id": scope.span_id,
        "session_id": scope.session_id,
        "route": scope.route,
        "user_id": scope.user_id,
        "account_id": scope.account_id,
        "attributes": dict(scope.attributes),
    }


@contextlib.contextmanager
def rum_context(**attributes):
    """Scope de contexte imbriqué, restauré à la sortie du bloc.

    Les clés ``session_id``, ``route``, ``user_id`` et ``account_id`` alimentent
    les champs correspondants du span ; les autres sont du contexte métier libre
    (``mip.context``). Les identifiants métier partent BRUTS : leur HMAC
    app-scopé est calculé au port d'ingestion, jamais ici — aucun secret de
    hachage ne vit dans une intégration cliente.

    Hors requête, le bloc s'exécute normalement et n'enregistre rien : une
    fonction instrumentée reste appelable depuis un script ou un test.
    """
    scope = _SCOPE.get()
    if scope is None:
        yield None
        return
    champs = {nom: attributes.pop(nom) for nom in _SCOPE_FIELDS if nom in attributes}
    if "session_id" in champs and not (
        isinstance(champs["session_id"], str) and _SESSION_ID.match(champs["session_id"])
    ):
        del champs["session_id"]  # une session invalide n'en remplace pas une valide
    for nom in ("route", "user_id", "account_id"):
        if nom in champs and not (isinstance(champs[nom], str) and champs[nom]):
            del champs[nom]
    enfant = scope.derive(**champs)
    contexte = _bounded_context(attributes)
    enfant.attributes.update(contexte)
    # Ce que le scope déclare remonte à la requête : c'est son span qui le porte.
    racine = scope.racine
    racine.attributes.update(contexte)
    for nom, valeur in champs.items():
        setattr(racine, nom, valeur)
    jeton = _SCOPE.set(enfant)
    try:
        yield enfant
    finally:
        # Restauration systématique : le scope parent revient même si le bloc lève.
        _SCOPE.reset(jeton)


def capture_exception(exc: BaseException, context: dict | None = None) -> bool:
    """Capture manuelle d'une exception, au contrat P5.3. ``True`` si elle est
    retenue pour le span de la requête courante.

    ``False`` — sans jamais lever — quand il n'y a pas de requête courante
    (script, tâche de fond : cette intégration n'ouvre pas de route hors requête)
    ou quand la MÊME exception a déjà été retenue. Relancer après capture ne
    produit donc pas deux erreurs : l'identifiant voyage avec l'objet.
    """
    if not isinstance(exc, BaseException):
        return False
    scope = _SCOPE.get()
    if scope is None:
        return False
    identifiant = _exception_id(exc)
    if identifiant in scope.seen:
        return False
    scope.seen.add(identifiant)
    if context:
        contexte = _bounded_context(context)
        scope.attributes.update(contexte)
        scope.racine.attributes.update(contexte)
    scope.events.append(_exception_event(exc, time.time_ns(), handled=True))
    return True


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

        # Le scope est ouvert AVANT l'application : `capture_exception` et
        # `rum_context` doivent être utilisables dès la première ligne du
        # gestionnaire, et l'identité du span doit être connue d'eux.
        rum_scope = self._scope_de(scope)
        jeton = _SCOPE.set(rum_scope)
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
            # Restauration systématique : aucune fuite de contexte vers la
            # requête suivante, même quand celle-ci lève ou est annulée.
            _SCOPE.reset(jeton)
            try:
                self._record(scope, state, t0, start_ns, failure, rum_scope)
            except Exception:  # le tracing ne casse JAMAIS la requête hôte
                pass

    def _scope_de(self, scope) -> "_Scope":
        """Trace, parent et session lus une seule fois, à l'entrée de la requête."""
        headers = {}
        for k, v in scope.get("headers") or []:
            if k in (b"traceparent", b"tracestate"):
                headers[k.decode("latin1")] = v.decode("latin1")
        m = _TRACEPARENT.match(headers.get("traceparent", ""))
        ms = _TRACESTATE_MIP.search(headers.get("tracestate", ""))
        return _Scope(
            trace_id=m.group(1) if m else secrets.token_hex(16),
            span_id=secrets.token_hex(8),
            parent_span_id=m.group(2) if m else None,
            session_id=ms.group(1) if ms else None,
        )

    # --- collecte ---------------------------------------------------------------
    def _record(self, scope, state: dict, t0: float, start_ns: int, failure=None, rum=None) -> None:
        path = scope.get("path", "/")
        if path in self.ignore or scope.get("method") == "OPTIONS":
            return  # préflights CORS : jamais de span
        duration_ms = round((time.perf_counter() - t0) * 1000, 1)

        rum = rum if rum is not None else self._scope_de(scope)
        trace_id = rum.trace_id
        parent_span_id = rum.parent_span_id
        span_id = rum.span_id
        session_id = rum.session_id

        # route template FastAPI si le routing l'a posée, sinon path normalisé ;
        # un `rum_context(route=…)` explicite prime sur les deux.
        route = scope.get("route")
        route_path = rum.route or getattr(route, "path_format", None) or getattr(route, "path", None)
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
        # Identités métier BRUTES : remplacées par leur HMAC app-scopé au port
        # d'ingestion. Aucun secret de hachage n'existe côté client.
        if rum.user_id:
            attrs.append(_kv("mip.identity.user_id", rum.user_id))
        if rum.account_id:
            attrs.append(_kv("mip.identity.account_id", rum.account_id))
        if rum.attributes:
            # Snapshot du contexte du scope : l'ingestion le lit sur le span
            # porteur pour en faire le contexte des exceptions dérivées.
            attrs.append(_kv("mip.context", json.dumps(rum.attributes, ensure_ascii=False)))
        if failure is not None:
            # Indicateur d'échec standard, indépendant du statut déjà envoyé.
            attrs.append(_kv("error.type", type(failure[0]).__name__))

        # Captures manuelles d'abord, puis l'exception qui a traversé l'app — et
        # seulement si elle n'a pas DÉJÀ été capturée à la main. C'est le même
        # identifiant porté par l'objet qui le dit ; deux exceptions distinctes
        # restent deux événements.
        events = list(rum.events)
        if failure is not None and _exception_id(failure[0]) not in rum.seen:
            events.append(_exception_event(*failure))

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
            # Seule une exception qui a TRAVERSÉ l'app fait échouer l'opération.
            # Une exception capturée puis traitée n'est pas un échec de la
            # requête : la réponse est partie normalement, le span garde son
            # statut — et l'erreur est tout de même remontée par son événement.
            span["status"] = {"code": 2}  # ERROR
        if events:
            span["events"] = events

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
