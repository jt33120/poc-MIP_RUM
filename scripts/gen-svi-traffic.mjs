// Générateur de trafic SVI — émet des appels au format OTLP vers l'ingestion.
//
// Sert à deux choses : rendre l'incrément I0 démontrable sans plateforme
// téléphonique, et exercer le chemin d'ingestion RÉEL (mêmes spans svi.*, même
// parser, mêmes writers) plutôt qu'un chargement direct en base qui ne prouverait
// rien du routage.
//
// Les appels produits portent `svi.platform = 'replay'` et `svi.is_test = true` :
// la console les affiche comme tels. Un jeu de démonstration qui se ferait passer
// pour du trafic réel serait exactement le genre de faux-semblant que ce dépôt
// s'attache à éliminer.
//
//   node scripts/gen-svi-traffic.mjs [nombre] [--endpoint http://localhost:4318/v1/traces]
import { createHash, randomUUID } from "node:crypto";

const args = process.argv.slice(2);
const COUNT = Number(args.find((a) => /^\d+$/.test(a)) ?? 40);
const ENDPOINT =
  args.find((a) => a.startsWith("--endpoint="))?.slice(11) ??
  process.env.MIP_INGEST_ENDPOINT ??
  "http://localhost:4318/v1/traces";
const APP_ID = process.env.MIP_APP_ID ?? "demo-app";
const ADAPTER = "gen-svi-traffic/0.1.0";

const sv = (v) =>
  typeof v === "number" ? { doubleValue: v }
  : typeof v === "boolean" ? { boolValue: v }
  : { stringValue: String(v) };
const attrs = (o) =>
  Object.entries(o).filter(([, v]) => v != null).map(([key, value]) => ({ key, value: sv(value) }));
const ns = (ms) => String(Math.round(ms) * 1_000_000);
const hex = (nb) => createHash("sha256").update(randomUUID()).digest("hex").slice(0, nb);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const between = (lo, hi) => Math.round(lo + Math.random() * (hi - lo));

// Arbre de menu réaliste : un SVI d'accueil à trois options.
const MENU = [
  { node: "n-facture", label: "Facturation", tache: "consulter_facture" },
  { node: "n-technique", label: "Assistance technique", tache: "diagnostic" },
  { node: "n-conseiller", label: "Parler à un conseiller", tache: null },
];

/** Un appel complet : entête + étapes, cohérents entre eux. */
function buildCall(now) {
  const callId = hex(32);
  const t0 = now - between(60_000, 6 * 3600_000);
  const choix = pick(MENU);
  const setup = between(400, 3500);

  // L'issue décide de la suite : on ne tire pas des champs indépendamment, sinon
  // on produirait des appels incohérents (transféré sans file d'attente, etc.).
  const r = Math.random();
  const outcome = r < 0.58 ? "contained" : r < 0.83 ? "transferred" : r < 0.96 ? "abandoned" : "failed";

  const ivr = between(8_000, 45_000);
  const wait = outcome === "contained" ? null : between(5_000, 120_000);
  const talk = outcome === "transferred" ? between(60_000, 600_000) : null;
  const duration = setup + ivr + (wait ?? 0) + (talk ?? 0);

  const spans = [];
  const step = (seq, kind, extra = {}, offset = 0, dur = null) => {
    spans.push({
      name: "svi.step",
      traceId: callId, spanId: hex(16),
      startTimeUnixNano: ns(t0 + offset),
      endTimeUnixNano: dur == null ? undefined : ns(t0 + offset + dur),
      attributes: attrs({
        "svi.call_id": callId, "svi.seq": seq, "svi.kind": kind, ...extra,
      }),
    });
  };

  let off = setup;
  step(1, "greeting", { "svi.node_id": "n-accueil", "svi.node_label": "Message d'accueil" }, off, 4000);
  off += 4000;
  step(2, "menu", {
    "svi.node_id": "n-menu", "svi.node_label": "Menu principal",
    "svi.menu_path": "/", "svi.depth": 1,
    "svi.input_class": "menu_choice", "svi.input_len": 1,
  }, off, between(3000, 12000));
  off += 9000;

  // Une saisie sensible sur le parcours facturation : la longueur ne doit JAMAIS
  // sortir. On l'émet volontairement avec input_len pour vérifier que le serveur
  // la retire — le test unitaire couvre le cas, celui-ci le montre en vrai.
  if (choix.node === "n-facture") {
    step(3, "input", {
      "svi.node_id": "n-ref-client", "svi.node_label": "Saisie référence client",
      "svi.input_class": "digits", "svi.input_len": 8, "svi.input_sensitive": true,
      "svi.menu_path": "/facturation", "svi.depth": 2,
    }, off, between(4000, 20000));
    off += 12000;
  }

  step(4, choix.node === "n-conseiller" || outcome !== "contained" ? "queue" : "lookup", {
    "svi.node_id": choix.node, "svi.node_label": choix.label,
    "svi.menu_path": `/${choix.label.toLowerCase()}`, "svi.depth": 2,
  }, off, wait ?? between(1000, 6000));
  off += wait ?? 3000;

  if (outcome === "transferred") step(5, "agent", { "svi.node_id": "n-agent", "svi.node_label": "Conseiller" }, off, talk);
  if (outcome === "abandoned") step(5, "disconnect", { "svi.node_id": "n-abandon", "svi.exit_reason": "caller_hangup" }, off, 0);
  if (outcome === "failed") step(5, "error", { "svi.node_id": "n-erreur", "svi.exit_reason": "sip_error" }, off, 0);

  spans.unshift({
    name: "svi.call",
    traceId: callId, spanId: hex(16),
    startTimeUnixNano: ns(t0), endTimeUnixNano: ns(t0 + duration),
    attributes: attrs({
      "svi.call_id": callId,
      "svi.platform": "replay",              // jamais confondu avec du trafic réel
      "svi.adapter_version": ADAPTER,
      "svi.is_test": true,
      "svi.provenance": "cdr,journey",
      "svi.status": "closed",
      "svi.outcome": outcome,
      "svi.outcome_detail":
        outcome === "abandoned" ? "caller_hangup"
        : outcome === "failed" ? "sip_error"
        : outcome === "transferred" ? "agent_answered" : "self_service",
      "svi.hangup_party": outcome === "abandoned" ? "caller" : "callee",
      "svi.direction": "inbound",
      "svi.entry_point": "Accueil général",
      "svi.flow_id": "svi-principal", "svi.flow_version": "3",
      // Empreinte d'appelant : ici pseudo-aléatoire, en production un HMAC posé
      // par l'adaptateur. Quelques doublons volontaires pour que le containment
      // NET (rappel sous 7 jours) ait de la matière.
      "svi.caller_hash": `h-${between(1, Math.max(2, Math.floor(COUNT * 0.7)))}`,
      "svi.caller_key_id": "k1",
      "svi.caller_country": pick(["FR", "FR", "FR", "BE", "CH"]),
      "svi.ended_at": new Date(t0 + duration).toISOString(),
      "svi.duration_ms": duration,
      "svi.setup_ms": setup, "svi.ivr_ms": ivr,
      "svi.queue_ms": wait, "svi.wait_ms": wait, "svi.talk_ms": talk,
      "svi.queue_name": wait == null ? null : "file-generale",
      "svi.menu_path_final": `/${choix.label.toLowerCase()}`,
      "svi.menu_depth": choix.node === "n-facture" ? 3 : 2,
      "svi.exit_node": choix.node,
      "svi.task_name": choix.tache,
      "svi.task_success": choix.tache ? outcome === "contained" : null,
    }),
  });

  // Tronçon voix : la méthode de mesure est obligatoire, jamais devinée.
  const mos = 2.8 + Math.random() * 1.7;
  spans.push({
    name: "svi.leg", traceId: callId, spanId: hex(16),
    startTimeUnixNano: ns(t0),
    attributes: attrs({
      "svi.call_id": callId, "svi.leg_ref": "A", "svi.dir": "rx",
      "svi.role": "sbc_edge", "svi.mos_method": "g107_e_model",
      "svi.codec": pick(["G.711", "G.722", "Opus"]),
      "svi.mos_avg": Number(mos.toFixed(2)),
      "svi.mos_min": Number((mos - Math.random() * 0.6).toFixed(2)),
      "svi.jitter_avg_ms": Number((Math.random() * 40).toFixed(1)),
      "svi.loss_avg_pct": Number((Math.random() * 4).toFixed(2)),
      "svi.rtt_avg_ms": between(20, 220),
    }),
  });
  return spans;
}

async function main() {
  const now = Date.now();
  const spans = [];
  for (let i = 0; i < COUNT; i++) spans.push(...buildCall(now));

  const payload = {
    resourceSpans: [{
      resource: { attributes: attrs({ "mip.app_id": APP_ID }) },
      scopeSpans: [{ scope: { name: "gen-svi-traffic", version: "0.1.0" }, spans }],
    }],
  };

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.text().catch(() => "");
  console.log(`${res.ok ? "✓" : "✗"} ${COUNT} appels (${spans.length} spans) -> ${ENDPOINT}`);
  console.log(`  HTTP ${res.status} ${body.slice(0, 200)}`);
  if (!res.ok) process.exitCode = 1;
}
main().catch((e) => { console.error("[gen-svi-traffic] échec:", e?.message ?? e); process.exit(2); });
