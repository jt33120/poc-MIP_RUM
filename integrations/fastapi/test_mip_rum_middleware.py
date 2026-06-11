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


if __name__ == "__main__":
    unittest.main()
