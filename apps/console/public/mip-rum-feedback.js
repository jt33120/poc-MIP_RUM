/* MIP RUM — widget de feedback (Expérience utilisateur / agent DEM web).
 *
 * Drop-in : à charger APRÈS mip-rum.js. Affiche un bouton flottant « Votre avis ? » ;
 * l'utilisateur note (1–5) et laisse un commentaire optionnel. Le retour part par
 * le canal d'événements custom DÉJÀ en place — MIPRum.track("feedback", {...}) —
 * donc aucune ingestion spécifique : il atterrit en rum_event(name='feedback'),
 * commentaire scrubbé PII côté serveur.
 *
 * Config optionnelle avant le chargement :
 *   window.MIPRumFeedback = { label: "Votre avis ?", accent: "#f89101" };
 *
 * Zéro dépendance, styles inline scellés (n'impacte pas la CSS du site hôte).
 */
(function () {
  "use strict";
  if (window.__mipRumFeedbackMounted) return;
  window.__mipRumFeedbackMounted = true;

  var cfg = window.MIPRumFeedback || {};
  var ACCENT = cfg.accent || "#f89101";
  var LABEL = cfg.label || "Votre avis ?";
  var Z = 2147483000;

  function send(score, comment) {
    try {
      if (window.MIPRum && typeof MIPRum.track === "function") {
        MIPRum.track("feedback", {
          score: score, // 1..5
          comment: (comment || "").slice(0, 500),
          route: location.pathname,
        });
      }
    } catch (_) {
      /* le feedback ne doit jamais casser la page hôte */
    }
  }

  function el(tag, style, text) {
    var e = document.createElement(tag);
    if (style) e.setAttribute("style", style);
    if (text != null) e.textContent = text;
    return e;
  }

  var base =
    "position:fixed;bottom:20px;right:20px;z-index:" + Z + ";" +
    "font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;";

  // --- bouton flottant ---
  var btn = el(
    "button",
    base +
      "display:flex;align-items:center;gap:8px;padding:10px 14px;border:0;border-radius:999px;" +
      "background:" + ACCENT + ";color:#0a1430;font-size:13px;font-weight:700;cursor:pointer;" +
      "box-shadow:0 4px 14px rgba(0,0,0,.18);",
    "💬 " + LABEL
  );
  btn.setAttribute("aria-label", LABEL);

  // --- panneau ---
  var panel = el(
    "div",
    base +
      "display:none;width:280px;padding:16px;border-radius:14px;background:#fff;color:#111827;" +
      "box-shadow:0 12px 40px rgba(6,12,32,.22);border:1px solid #e4e8ee;"
  );

  var title = el("div", "font-size:14px;font-weight:700;margin-bottom:10px;color:#111827;", "Comment s'est passée votre visite ?");
  panel.appendChild(title);

  var chosen = 0;
  var starsWrap = el("div", "display:flex;gap:6px;margin-bottom:10px;");
  var stars = [];
  function paint() {
    for (var i = 0; i < 5; i++) stars[i].style.opacity = i < chosen ? "1" : "0.3";
  }
  for (var i = 0; i < 5; i++) {
    (function (idx) {
      var s = el(
        "button",
        "background:none;border:0;font-size:24px;line-height:1;cursor:pointer;padding:0;opacity:.3;",
        "★"
      );
      s.style.color = ACCENT;
      s.setAttribute("aria-label", idx + 1 + " sur 5");
      s.onclick = function () {
        chosen = idx + 1;
        paint();
      };
      stars.push(s);
      starsWrap.appendChild(s);
    })(i);
  }
  panel.appendChild(starsWrap);

  var ta = el(
    "textarea",
    "width:100%;box-sizing:border-box;min-height:60px;padding:8px;border:1px solid #e4e8ee;" +
      "border-radius:8px;font-size:13px;resize:vertical;color:#111827;background:#fff;"
  );
  ta.setAttribute("placeholder", "Un commentaire ? (optionnel)");
  panel.appendChild(ta);

  var row = el("div", "display:flex;justify-content:flex-end;gap:8px;margin-top:10px;");
  var cancel = el(
    "button",
    "background:none;border:0;color:#6b7280;font-size:12px;cursor:pointer;",
    "Fermer"
  );
  var submit = el(
    "button",
    "border:0;border-radius:8px;padding:7px 12px;background:" + ACCENT + ";color:#0a1430;" +
      "font-size:12px;font-weight:700;cursor:pointer;",
    "Envoyer"
  );
  row.appendChild(cancel);
  row.appendChild(submit);
  panel.appendChild(row);

  function open() {
    panel.style.display = "block";
    btn.style.display = "none";
  }
  function shut() {
    panel.style.display = "none";
    btn.style.display = "flex";
    chosen = 0;
    paint();
    ta.value = "";
  }
  function thanks() {
    panel.innerHTML = "";
    panel.appendChild(el("div", "font-size:14px;font-weight:700;color:#059669;", "Merci pour votre retour 🙏"));
    setTimeout(function () {
      location.reload ? null : null; // no-op
      panel.style.display = "none";
      btn.style.display = "flex";
    }, 1400);
  }

  btn.onclick = open;
  cancel.onclick = shut;
  submit.onclick = function () {
    if (!chosen) {
      starsWrap.style.animation = "";
      title.textContent = "Choisissez une note d'abord :";
      return;
    }
    send(chosen, ta.value);
    thanks();
  };

  function mount() {
    document.body.appendChild(btn);
    document.body.appendChild(panel);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
