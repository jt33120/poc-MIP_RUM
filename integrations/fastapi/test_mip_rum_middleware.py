"""Tests stdlib du middleware (python3 -m unittest discover integrations/fastapi).

Pas de FastAPI requis : le middleware est ASGI pur, on le pilote avec des dicts.
L'envoi réseau est intercepté en monkeypatchant mip_rum_middleware._post.
"""

import asyncio
import unittest

import mip_rum_middleware as mrm

TRACEPARENT = "00-" + "ab" * 16 + "-" + "cd" * 8 + "-01"


class FakeRoute:
    path_format = "/items/{item_id}"


class FakeApp:
    """App ASGI minimale : pose scope['route'] comme le ferait le routing FastAPI."""

    async def __call__(self, scope, receive, send):
        scope["route"] = FakeRoute()
        await send({"type": "http.response.start", "status": 201, "headers": []})
        await send({"type": "http.response.body", "body": b"ok"})


def run_request(mw, path="/items/42", headers=None):
    scope = {
        "type": "http",
        "method": "GET",
        "path": path,
        "headers": headers or [],
    }
    sent = []

    async def main():
        async def send(msg):
            sent.append(msg)

        async def receive():
            return {"type": "http.request"}

        await mw(scope, receive, send)
        await asyncio.sleep(0.05)  # laisse l'ensure_future(_flush) tourner

    asyncio.run(main())
    return sent


class MiddlewareTest(unittest.TestCase):
    def setUp(self):
        self.posts = []
        self._orig_post = mrm._post
        mrm._post = lambda endpoint, payload: self.posts.append((endpoint, payload))

    def tearDown(self):
        mrm._post = self._orig_post

    def attrs(self, span):
        out = {}
        for kv in span["attributes"]:
            v = kv["value"]
            out[kv["key"]] = next(iter(v.values()))
        return out

    def test_passthrough_sans_env(self):
        mw = mrm.MIPRumMiddleware(FakeApp())  # ni endpoint ni app_id
        sent = run_request(mw)
        self.assertEqual(sent[0]["status"], 201)  # la réponse passe telle quelle
        self.assertEqual(self.posts, [])
        self.assertFalse(mw.enabled)

    def test_span_correle_au_traceparent(self):
        mw = mrm.MIPRumMiddleware(
            FakeApp(), endpoint="http://x/v1/traces", app_id="demo-app", batch_size=1
        )
        run_request(
            mw,
            headers=[
                (b"traceparent", TRACEPARENT.encode()),
                (b"tracestate", b"mip=s:sess-1234"),
            ],
        )
        self.assertEqual(len(self.posts), 1)
        endpoint, payload = self.posts[0]
        self.assertEqual(endpoint, "http://x/v1/traces")
        rs = payload["resourceSpans"][0]
        res_attrs = {kv["key"]: kv["value"]["stringValue"] for kv in rs["resource"]["attributes"]}
        self.assertEqual(res_attrs["mip.app_id"], "demo-app")
        span = rs["scopeSpans"][0]["spans"][0]
        self.assertEqual(span["name"], "http.server")
        self.assertEqual(span["traceId"], "ab" * 16)  # trace du front conservée
        self.assertEqual(span["parentSpanId"], "cd" * 8)
        a = self.attrs(span)
        self.assertEqual(a["mip.trace_id"], "ab" * 16)
        self.assertEqual(a["mip.parent_span_id"], "cd" * 8)
        self.assertEqual(a["mip.session_id"], "sess-1234")
        self.assertEqual(a["mip.route"], "/items/{item_id}")  # template, pas /items/42
        self.assertEqual(a["http.status_code"], "201")

    def test_span_sans_traceparent_trace_neuve(self):
        mw = mrm.MIPRumMiddleware(
            FakeApp(), endpoint="http://x/v1/traces", app_id="demo-app", batch_size=1
        )
        run_request(mw)
        span = self.posts[0][1]["resourceSpans"][0]["scopeSpans"][0]["spans"][0]
        self.assertEqual(len(span["traceId"]), 32)  # trace générée
        self.assertNotIn("parentSpanId", span)
        self.assertNotIn("mip.session_id", self.attrs(span))

    def test_routes_ignorees(self):
        mw = mrm.MIPRumMiddleware(
            FakeApp(), endpoint="http://x/v1/traces", app_id="demo-app", batch_size=1
        )
        run_request(mw, path="/health")
        self.assertEqual(self.posts, [])

    def test_normalisation_sans_template(self):
        class BareApp:  # ne pose pas scope['route'] (404, mounts…)
            async def __call__(self, scope, receive, send):
                await send({"type": "http.response.start", "status": 404, "headers": []})
                await send({"type": "http.response.body", "body": b""})

        mw = mrm.MIPRumMiddleware(
            BareApp(), endpoint="http://x/v1/traces", app_id="demo-app", batch_size=1
        )
        run_request(mw, path="/partners/42")
        a = self.attrs(self.posts[0][1]["resourceSpans"][0]["scopeSpans"][0]["spans"][0])
        self.assertEqual(a["mip.route"], "/partners/:id")

    def test_erreur_app_remonte_mais_span_emis(self):
        class BoomApp:
            async def __call__(self, scope, receive, send):
                raise RuntimeError("boom")

        mw = mrm.MIPRumMiddleware(
            BoomApp(), endpoint="http://x/v1/traces", app_id="demo-app", batch_size=1
        )
        with self.assertRaises(RuntimeError):
            run_request(mw)
        # le span est tout de même bufferisé (status 0) — flush pas encore parti
        self.assertEqual(len(mw._buf) + len(self.posts), 1)

    def test_file_saturee_compte_les_pertes(self):
        # batch_size élevé => pas de flush ; queue_max=2 => au 3e span on perd 1
        mw = mrm.MIPRumMiddleware(
            FakeApp(),
            endpoint="http://x/v1/traces",
            app_id="demo-app",
            batch_size=1000,
            queue_max=2,
        )
        scope = {"type": "http", "method": "GET", "path": "/x", "headers": []}

        async def main():
            t0 = mrm.time.perf_counter()
            for _ in range(5):
                mw._record(scope, {"code": 200, "started": True}, t0, mrm.time.time_ns())

        asyncio.run(main())
        self.assertEqual(len(mw._buf), 2)  # file bornée
        self.assertEqual(mw._dropped, 3)  # 3 spans perdus, comptés


def traceparent(n: int) -> bytes:
    return f"00-{n:032x}-{n:016x}-01".encode()


class ExceptionsTest(unittest.TestCase):
    """P5.3 : exception non gérée -> événement du span, jamais avalée."""

    def setUp(self):
        self.posts = []
        self._orig_post = mrm._post
        mrm._post = lambda endpoint, payload: self.posts.append((endpoint, payload))

    def tearDown(self):
        mrm._post = self._orig_post

    def attrs(self, record):
        return {kv["key"]: next(iter(kv["value"].values())) for kv in record["attributes"]}

    def middleware(self, app):
        # Lot jamais atteint : les spans restent lisibles dans le tampon.
        return mrm.MIPRumMiddleware(app, endpoint="http://x/v1/traces", app_id="demo-app", batch_size=1000)

    def assert_exception(self, span, exc_type, message):
        (event,) = span["events"]
        self.assertEqual(event["name"], "exception")
        self.assertRegex(event["timeUnixNano"], r"^\d+$")
        a = self.attrs(event)
        self.assertEqual(a["exception.type"], exc_type)
        self.assertEqual(a["exception.message"], message)
        self.assertIn("Traceback (most recent call last)", a["exception.stacktrace"])
        self.assertIn(f"{exc_type}: {message}", a["exception.stacktrace"])
        self.assertRegex(a["mip.exception_id"], r"^[0-9a-f]{32}$")
        self.assertIs(a["mip.error_handled"], False)

    def test_avant_les_en_tetes_500_exception_et_trace_sans_avaler(self):
        class BoomApp:
            async def __call__(self, scope, receive, send):
                raise ValueError("montant invalide")

        mw = self.middleware(BoomApp())
        try:
            run_request(mw, headers=[(b"traceparent", TRACEPARENT.encode())])
        except ValueError as exc:
            # Elle remonte avec SA traceback : la ligne de l'app y est toujours.
            lignes = [f.line for f in mrm.traceback.extract_tb(exc.__traceback__)]
            self.assertIn('raise ValueError("montant invalide")', lignes)
        else:
            self.fail("exception avalée par le middleware")

        (span,) = mw._buf
        a = self.attrs(span)
        self.assertEqual(span["traceId"], "ab" * 16)
        self.assertEqual(span["parentSpanId"], "cd" * 8)
        self.assertEqual(a["http.status_code"], "500")  # le serveur ASGI répondra 500
        self.assertEqual(span["status"], {"code": 2})
        self.assertEqual(a["error.type"], "ValueError")
        self.assert_exception(span, "ValueError", "montant invalide")

    def test_apres_les_en_tetes_statut_reel_et_echec_sans_500_invente(self):
        class StreamBoomApp:
            async def __call__(self, scope, receive, send):
                await send({"type": "http.response.start", "status": 200, "headers": []})
                await send({"type": "http.response.body", "body": b"debut", "more_body": True})
                raise RuntimeError("flux interrompu")

        mw = self.middleware(StreamBoomApp())
        sent = []

        async def main():
            async def send(msg):
                sent.append(msg)

            async def receive():
                return {"type": "http.request"}

            scope = {"type": "http", "method": "GET", "path": "/export", "headers": []}
            await mw(scope, receive, send)

        with self.assertRaises(RuntimeError):
            asyncio.run(main())
        self.assertEqual([m["type"] for m in sent], ["http.response.start", "http.response.body"])
        (span,) = mw._buf
        a = self.attrs(span)
        self.assertEqual(a["http.status_code"], "200")  # le statut réellement envoyé
        self.assertEqual(span["status"], {"code": 2})
        self.assertEqual(a["error.type"], "RuntimeError")
        self.assert_exception(span, "RuntimeError", "flux interrompu")

    def test_reponse_500_sans_exception_n_est_pas_une_exception(self):
        class HttpErrorApp:  # HTTPException rendue par FastAPI : réponse, pas exception
            async def __call__(self, scope, receive, send):
                await send({"type": "http.response.start", "status": 500, "headers": []})
                await send({"type": "http.response.body", "body": b"erreur"})

        mw = self.middleware(HttpErrorApp())
        run_request(mw)
        (span,) = mw._buf
        self.assertEqual(self.attrs(span)["http.status_code"], "500")
        self.assertNotIn("events", span)
        self.assertNotIn("error.type", self.attrs(span))

    def test_annulation_traverse_sans_etre_une_exception_applicative(self):
        class CancelledApp:
            async def __call__(self, scope, receive, send):
                raise asyncio.CancelledError()

        mw = self.middleware(CancelledApp())
        with self.assertRaises(asyncio.CancelledError):
            run_request(mw)
        (span,) = mw._buf
        self.assertNotIn("events", span)
        self.assertNotIn("status", span)

    def test_requetes_concurrentes_sans_melange_de_trace(self):
        class MixedApp:
            async def __call__(self, scope, receive, send):
                n = int(scope["path"].rsplit("/", 1)[1])
                await asyncio.sleep((n % 7) * 0.001)  # entrelace les requêtes
                if n % 3 == 0:
                    raise LookupError(f"introuvable {n}")
                await send({"type": "http.response.start", "status": 200, "headers": []})
                await asyncio.sleep((n % 5) * 0.001)
                if n % 3 == 1:
                    raise RuntimeError(f"flux {n}")
                await send({"type": "http.response.body", "body": b"ok"})

        mw = self.middleware(MixedApp())

        async def une(n):
            scope = {
                "type": "http",
                "method": "GET",
                "path": f"/items/{n}",
                "headers": [(b"traceparent", traceparent(n))],
            }

            async def send(msg):
                pass

            async def receive():
                return {"type": "http.request"}

            await mw(scope, receive, send)

        async def main():
            return await asyncio.gather(*(une(n) for n in range(1, 61)), return_exceptions=True)

        resultats = asyncio.run(main())
        for n, resultat in zip(range(1, 61), resultats):
            attendu = {0: LookupError, 1: RuntimeError, 2: type(None)}[n % 3]
            self.assertIsInstance(resultat, attendu, n)  # chaque exception remonte à SA requête

        self.assertEqual(len(mw._buf), 60)
        for span in mw._buf:
            n = int(span["traceId"], 16)
            a = self.attrs(span)
            self.assertEqual(a["http.url"], f"/items/{n}")
            self.assertEqual(span["parentSpanId"], f"{n:016x}")
            if n % 3 == 0:
                self.assertEqual(a["http.status_code"], "500")
                self.assert_exception(span, "LookupError", f"introuvable {n}")
            elif n % 3 == 1:
                self.assertEqual(a["http.status_code"], "200")
                self.assert_exception(span, "RuntimeError", f"flux {n}")
            else:
                self.assertEqual(a["http.status_code"], "200")
                self.assertNotIn("events", span)
        identifiants = [self.attrs(s["events"][0])["mip.exception_id"] for s in mw._buf if "events" in s]
        self.assertEqual(len(identifiants), len(set(identifiants)))


if __name__ == "__main__":
    unittest.main()
