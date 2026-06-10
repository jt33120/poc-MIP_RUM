// Static server for the demo page + built SDK (port 8080).
import http from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.DEMO_PORT || 8080;

const ROUTES = {
  "/mip-rum.js": {
    file: join(__dirname, "../packages/rum-sdk/dist/mip-rum.js"),
    type: "application/javascript",
  },
  // v0.3 — bundle replay séparé, lazy-loadé par le cœur (même origine)
  "/mip-rum-replay.js": {
    file: join(__dirname, "../packages/rum-sdk/dist/mip-rum-replay.js"),
    type: "application/javascript",
  },
};

const server = http.createServer(async (req, res) => {
  const path = req.url.split("?")[0];
  try {
    // ressource volontairement lente (démo resource timings v0.2)
    if (path === "/slow") {
      await new Promise((resolve) => setTimeout(resolve, 800));
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ ok: true, delayMs: 800 }));
    }
    if (ROUTES[path]) {
      const body = await readFile(ROUTES[path].file);
      res.writeHead(200, { "content-type": ROUTES[path].type });
      return res.end(body);
    }
    // SPA: any other path serves index.html (routes /partners, /partners/42…)
    const body = await readFile(join(__dirname, "index.html"));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(body);
  } catch (err) {
    res.writeHead(500);
    res.end(String(err.message));
  }
});

server.listen(PORT, () =>
  console.log(`[demo] http://localhost:${PORT} (SDK at /mip-rum.js)`),
);
