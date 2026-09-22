/* MIP RUM — widget de feedback (Expérience utilisateur / agent DEM web).
 *
 * Drop-in : à charger APRÈS mip-rum.js. Affiche un bouton flottant « Votre avis ? » ;
 * l'utilisateur note (1–5) et laisse un commentaire optionnel. Le retour part par
 * le canal d'événements custom DÉJÀ en place — MIPRum.track("feedback", {...}) —
 * donc aucune ingestion spécifique : il atterrit en rum_event(name='feedback'),
 * commentaire scrubbé PII côté serveur.
 *
 * Le FORMAT de l'événement est un contrat figé (la console le lit, et des avis
 * déjà ingérés doivent rester exploitables) : name='feedback', props = { score,
 * comment, route }. `score` peut valoir null — cf. « note absente » plus bas.
 *
 * Config optionnelle avant le chargement :
 *   window.MIPRumFeedback = {
 *     label: "Votre avis ?", accent: "#f89101",
 *     offset: 20,                          // marge au coin bas-droit, en px ;
 *                                          // à augmenter si l'app hôte y place
 *                                          // déjà une pastille flottante.
 *     onlyPaths: ["/app", "/dashboard"],   // n'affiche le widget QUE sur ces
 *                                          // préfixes de chemin ; ré-évalué à la
 *                                          // navigation (SPA comprise).
 *     cooldownDays: 60,                    // silence après un avis ENVOYÉ.
 *                                          // 0 = aucun silence.
 *     once: true,                          // avis unique (silence définitif) —
 *                                          // à n'utiliser qu'en connaissance
 *                                          // de cause, cf. plus bas.
 *     appId: "gip-plateforme",             // sinon lu via MIPRum.appId().
 *     compactBelow: 768,                   // sous cette largeur (px), lanceur
 *                                          // replié en pastille « 💬 ».
 *   };
 * (via le SDK : MIPRum.init({ feedback: { onlyPaths: [...] } }).)
 *
 * Zéro dépendance, styles inline scellés (n'impacte pas la CSS du site hôte).
 *
 * ── Correctifs du 11/08/2026 (constatés en production sur gip-plateforme) ──
 *
 * 1. COMMENTAIRE PERDU. L'avis partait avec comment:"" alors que l'utilisateur
 *    avait saisi un texte. Le commentaire ne vivait QUE dans la propriété `.value`
 *    d'un nœud DOM de longue durée de vie — que le widget détachait lui-même à
 *    l'envoi (`panel.innerHTML = ""`), et qu'un ré-rendu de l'application hôte
 *    pouvait remplacer à tout moment. On tient désormais un brouillon en mémoire,
 *    mis à jour à chaque frappe : la valeur envoyée ne dépend plus de la survie
 *    d'un nœud. Le panneau n'est par ailleurs plus jamais détruit.
 *
 * 2. ENVOI SANS ACCUSÉ DE RÉCEPTION. La confirmation s'effaçait toute seule au
 *    bout de 1,4 s et laissait un panneau vidé de son contenu : le widget était à
 *    usage unique, et l'utilisateur de gip-plateforme en a conclu qu'il ne
 *    fonctionnait pas. La confirmation reste maintenant à l'écran jusqu'à ce que
 *    l'utilisateur la ferme, et le formulaire est réutilisable ensuite.
 *
 * 3. LE WIDGET SE MESURAIT LUI-MÊME. Ses clics alimentaient le détecteur de
 *    frustration du SDK. Toutes ses racines portent désormais data-mip-rum-ui, que
 *    le détecteur ignore (cf. packages/rum-sdk/src/frustration.ts).
 *
 * ── Correctif du 14/08/2026 ───────────────────────────────────────────────────
 *
 * 4. AUCUNE MÉMOIRE DES AVIS DÉJÀ DONNÉS. Le lanceur revenait à chaque page, y
 *    compris juste après un envoi réussi. Un silence borné (cooldownDays, 60 par
 *    défaut) suit désormais chaque avis ENVOYÉ, cloisonné par appId. Voir le bloc
 *    « Période de silence » pour le raisonnement produit, et pourquoi le défaut
 *    n'est pas `once`.
 */
(function () {
  "use strict";
  if (window.__mipRumFeedbackMounted) return;
  window.__mipRumFeedbackMounted = true;

  var cfg = window.MIPRumFeedback || {};
  var ACCENT = cfg.accent || "#f89101";
  var LABEL = cfg.label || "Votre avis ?";
  var ONLY = Array.isArray(cfg.onlyPaths) ? cfg.onlyPaths : null; // null = partout
  var OFFSET = typeof cfg.offset === "number" && cfg.offset >= 0 ? cfg.offset : 20;
  var Z = 2147483000;
  var COMPACT = typeof cfg.compactBelow === "number" ? cfg.compactBelow : 0;

  // Marqueur lu par le détecteur de frustration du SDK : tout clic à l'intérieur
  // d'un élément qui le porte est ignoré. Doit rester identique à MIP_UI_ATTR
  // (packages/rum-sdk/src/frustration.ts) — verrouillé par un test unitaire.
  var UI_ATTR = "data-mip-rum-ui";

  // ── Période de silence après un avis envoyé ─────────────────────────────────
  //
  // Sans mémoire, le lanceur revient à chaque page : l'utilisateur de
  // gip-plateforme a donné son avis, puis a retrouvé le bouton orange partout.
  //
  // On ne masque PAS définitivement pour autant. Un CSAT mesure une satisfaction
  // DANS LE TEMPS : sur une application à onze utilisateurs, « une fois pour
  // toutes » plafonnerait à onze avis pour la vie du produit, et rendrait
  // impossible de mesurer l'effet d'une refonte. D'où un silence BORNÉ par
  // défaut, `once: true` restant disponible pour les intégrations qui veulent
  // réellement un avis unique.
  var COOLDOWN_DAYS =
    typeof cfg.cooldownDays === "number" &&
    isFinite(cfg.cooldownDays) &&
    cfg.cooldownDays >= 0
      ? cfg.cooldownDays
      : 60;
  var COOLDOWN_MS = COOLDOWN_DAYS * 86400000;
  var ONCE = cfg.once === true;
  var STORE_PREFIX = "mip_rum_feedback_last:";

  /**
   * appId de l'application hôte — cloisonne le silence APPLICATION PAR
   * APPLICATION : deux apps servies au même navigateur ne doivent pas se masquer
   * l'une l'autre. Résolu tardivement (et non à l'évaluation du script) car
   * MIPRum.init() peut ne pas encore avoir eu lieu quand ce fichier s'exécute.
   */
  function appId() {
    if (typeof cfg.appId === "string" && cfg.appId) return cfg.appId;
    try {
      if (window.MIPRum && typeof MIPRum.appId === "function") return MIPRum.appId() || "";
    } catch (_) {
      /* SDK absent, ou antérieur à l'ajout de appId() */
    }
    return "";
  }

  function storeKey() {
    return STORE_PREFIX + appId();
  }

  /**
   * Horodatage du dernier avis ENVOYÉ, ou 0 si inconnu.
   *
   * Toute anomalie renvoie 0 — navigation privée, localStorage désactivé par
   * politique, quota dépassé, valeur corrompue à la main. La règle est « dans le
   * doute, on affiche » : un widget qui réapparaît trop tôt est un désagrément,
   * un widget qui disparaît pour de bon est une perte de mesure silencieuse.
   */
  function lastSentAt() {
    try {
      var raw = window.localStorage.getItem(storeKey());
      if (!raw) return 0;
      var n = parseInt(raw, 10);
      return isFinite(n) && n > 0 ? n : 0;
    } catch (_) {
      return 0;
    }
  }

  /** Le widget doit-il se taire maintenant ? */
  function silenced() {
    var last = lastSentAt();
    if (!last) return false; // aucun avis envoyé (ou stockage illisible)
    if (ONCE) return true;
    if (COOLDOWN_MS <= 0) return false; // cooldownDays: 0 -> aucun silence
    var age = Date.now() - last;
    // Horodatage dans le FUTUR (horloge reculée, correction NTP, changement de
    // fuseau) : on ne se tait pas des années sur une donnée qu'on sait fausse.
    if (age < 0) return false;
    return age < COOLDOWN_MS;
  }

  /** Arme le silence. Appelé UNIQUEMENT après un envoi confirmé. */
  function rememberSent() {
    try {
      window.localStorage.setItem(storeKey(), String(Date.now()));
    } catch (_) {
      // Stockage plein ou indisponible : le widget redemandera un avis plus tôt
      // que prévu. C'est le bon compromis — mieux vaut redemander que faire
      // échouer l'avis qui vient de partir.
    }
  }

  /** Le chemin courant est-il autorisé ? (préfixe de onlyPaths ; true si non borné). */
  function pathAllowed() {
    if (!ONLY || !ONLY.length) return true;
    var p = location.pathname;
    for (var i = 0; i < ONLY.length; i++) {
      if (typeof ONLY[i] === "string" && p.indexOf(ONLY[i]) === 0) return true;
    }
    return false;
  }

  /**
   * Émet l'avis. `score` est un entier 1..5, ou null si l'utilisateur n'a laissé
   * qu'un commentaire (cf. « note absente »). Retourne true si l'événement est
   * bien parti — l'accusé de réception affiché à l'utilisateur en dépend, il ne
   * doit jamais annoncer un envoi qui n'a pas eu lieu.
   */
  function send(score, comment) {
    try {
      if (!window.MIPRum || typeof MIPRum.track !== "function") return false;
      var accepted = MIPRum.track("feedback", {
        score: score, // 1..5, ou null
        comment: (comment || "").slice(0, 500),
        route: location.pathname,
      });
      // track() renvoie false quand le SDK a JETÉ l'événement : opt-out DNT/GPC,
      // session non échantillonnée, ou mode « error-biased » (seules les erreurs
      // passent). Un SDK antérieur renvoie undefined — on le traite comme un
      // succès, sans quoi ce widget cesserait de fonctionner sur les
      // intégrations qui n'ont pas encore mis le SDK à jour.
      return accepted !== false;
    } catch (_) {
      return false; // le feedback ne doit jamais casser la page hôte
    }
  }

  function el(tag, style, text) {
    var e = document.createElement(tag);
    if (style) e.setAttribute("style", style);
    if (text != null) e.textContent = text;
    return e;
  }

  var base =
    "position:fixed;bottom:" + OFFSET + "px;right:" + OFFSET + "px;z-index:" + Z + ";" +
    "font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;";

  // --- bouton flottant ---
  var btn = el(
    "button",
    base +
      "display:flex;align-items:center;gap:8px;padding:10px 14px;border:0;border-radius:999px;" +
      "background:" + ACCENT + ";color:#0a1430;font-size:13px;font-weight:700;cursor:pointer;" +
      "box-shadow:0 4px 14px rgba(0,0,0,.18);transition:transform .12s ease;",
    "💬 " + LABEL
  );
  // type=button : sans lui, un widget monté dans un <form> hôte (applications
  // d'entreprise qui enveloppent toute la page) soumettrait ce formulaire à
  // chaque clic — l'avis serait perdu et la page rechargée.
  btn.type = "button";
  btn.setAttribute("aria-label", LABEL);
  btn.setAttribute("aria-expanded", "false");
  btn.setAttribute(UI_ATTR, "feedback-button");

  // Replié sur écran étroit : le libellé masquait le contenu du coin bas-droit.
  // Le nom accessible (aria-label) reste entier.
  if (COMPACT && window.matchMedia) {
    var mq = window.matchMedia("(max-width:" + (COMPACT - 1) + "px)");
    var plier = function () {
      btn.textContent = mq.matches ? "💬" : "💬 " + LABEL;
    };
    plier();
    if (mq.addEventListener) mq.addEventListener("change", plier);
  }

  // --- panneau ---
  // max-width : le coin bas-droit est partagé avec les pastilles flottantes de
  // l'app hôte, et sur un petit écran une largeur fixe déborderait de la fenêtre.
  var panel = el(
    "div",
    base +
      "display:none;width:280px;max-width:calc(100vw - " + (2 * OFFSET) + "px);" +
      "box-sizing:border-box;padding:16px;border-radius:14px;background:#fff;color:#111827;" +
      "box-shadow:0 12px 40px rgba(6,12,32,.22);border:1px solid #e4e8ee;"
  );
  panel.setAttribute(UI_ATTR, "feedback-panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", LABEL);
  panel.setAttribute("tabindex", "-1"); // focalisable par script, hors ordre de tabulation

  // ── partie « formulaire » ────────────────────────────────────────────────────
  var form = el("div", null);
  var title = el(
    "div",
    "font-size:14px;font-weight:700;margin-bottom:10px;color:#111827;",
    "Comment s'est passée votre visite ?"
  );
  form.appendChild(title);

  var chosen = 0;
  var starsWrap = el("div", "display:flex;gap:6px;margin-bottom:10px;");
  var stars = [];
  function paint() {
    for (var i = 0; i < 5; i++) {
      stars[i].style.opacity = i < chosen ? "1" : "0.3";
      stars[i].setAttribute("aria-pressed", i < chosen ? "true" : "false");
    }
  }
  for (var i = 0; i < 5; i++) {
    (function (idx) {
      var s = el(
        "button",
        // 32px de cible tactile : sur mobile, 24px de glyphe seul se rate.
        "background:none;border:0;font-size:24px;line-height:1;cursor:pointer;padding:0;" +
          "min-width:32px;min-height:32px;opacity:.3;",
        "★"
      );
      s.type = "button";
      s.style.color = ACCENT;
      s.setAttribute("aria-label", idx + 1 + " sur 5");
      s.onclick = function () {
        chosen = idx + 1;
        paint();
        title.textContent = "Comment s'est passée votre visite ?";
      };
      stars.push(s);
      starsWrap.appendChild(s);
    })(i);
  }
  form.appendChild(starsWrap);

  // Brouillon du commentaire, tenu EN MÉMOIRE et mis à jour à chaque frappe.
  // C'est le correctif du défaut nº 1 : la valeur envoyée ne dépend plus de la
  // survie du nœud <textarea> jusqu'au clic sur « Envoyer ».
  var draft = "";
  var ta = el(
    "textarea",
    "width:100%;box-sizing:border-box;min-height:60px;padding:8px;border:1px solid #e4e8ee;" +
      "border-radius:8px;font-size:16px;resize:vertical;color:#111827;background:#fff;"
    // font-size:16px et non 13px : en dessous de 16px, iOS Safari zoome
    // automatiquement à la prise de focus et l'utilisateur perd la page de vue.
  );
  ta.setAttribute("placeholder", "Un commentaire ? (optionnel)");
  ta.setAttribute("aria-label", "Votre commentaire (optionnel)");
  ta.addEventListener("input", function () {
    draft = ta.value;
  });
  form.appendChild(ta);

  /** La valeur du commentaire à envoyer : le champ vivant, sinon le brouillon. */
  function commentValue() {
    var live = ta && typeof ta.value === "string" ? ta.value : "";
    return live !== "" ? live : draft;
  }

  var row = el("div", "display:flex;justify-content:flex-end;gap:8px;margin-top:10px;");
  var cancel = el(
    "button",
    "background:none;border:0;color:#6b7280;font-size:12px;cursor:pointer;padding:6px;",
    "Fermer"
  );
  cancel.type = "button";
  // Deux boutons portent le texte « Fermer » (formulaire et confirmation) : sans
  // aria-label distinct, un lecteur d'écran annonce deux fois la même chose.
  cancel.setAttribute("aria-label", "Fermer sans envoyer");
  var submit = el(
    "button",
    "border:0;border-radius:8px;padding:7px 12px;background:" + ACCENT + ";color:#0a1430;" +
      "font-size:12px;font-weight:700;cursor:pointer;",
    "Envoyer"
  );
  submit.type = "button";
  row.appendChild(cancel);
  row.appendChild(submit);
  form.appendChild(row);
  panel.appendChild(form);

  // ── partie « accusé de réception » ───────────────────────────────────────────
  // Distincte du formulaire et simplement masquée/affichée : on ne détruit plus
  // le contenu du panneau, sans quoi le widget devient inutilisable après un envoi.
  var done = el("div", "display:none;");
  var doneMsg = el(
    "div",
    "font-size:14px;font-weight:700;color:#059669;margin-bottom:4px;",
    "Merci, votre avis a bien été envoyé 🙏"
  );
  // aria-live : l'accusé de réception doit être annoncé aussi aux lecteurs d'écran.
  done.setAttribute("role", "status");
  done.setAttribute("aria-live", "polite");
  done.appendChild(doneMsg);
  done.appendChild(
    el(
      "div",
      "font-size:12px;color:#6b7280;margin-bottom:10px;",
      "Il aide l'équipe à prioriser les correctifs."
    )
  );
  var doneRow = el("div", "display:flex;justify-content:flex-end;");
  var doneClose = el(
    "button",
    "border:0;border-radius:8px;padding:7px 12px;background:#f3f4f6;color:#111827;" +
      "font-size:12px;font-weight:700;cursor:pointer;",
    "Fermer"
  );
  doneClose.type = "button";
  doneClose.setAttribute("aria-label", "Fermer la confirmation");
  doneRow.appendChild(doneClose);
  done.appendChild(doneRow);
  panel.appendChild(done);

  function open() {
    form.style.display = "block";
    done.style.display = "none";
    panel.style.display = "block";
    btn.style.display = "none";
    btn.setAttribute("aria-expanded", "true");
    // Réaction perceptible ET immédiate au clic : le panneau prend le focus, donc
    // le clavier suit et un lecteur d'écran annonce l'ouverture. C'est le pendant
    // « ressenti » du défaut nº 2 — l'utilisateur ne doit jamais se demander si
    // son clic a été pris en compte.
    //
    // On focalise le PANNEAU et non le champ de texte : sur mobile, focaliser un
    // <textarea> ouvre le clavier virtuel, qui recouvre les étoiles avant même
    // que l'utilisateur ait pu noter.
    try {
      panel.focus({ preventScroll: true });
    } catch (_) {
      /* focus indisponible : sans conséquence, le panneau est déjà visible */
    }
  }

  /** Referme et remet le formulaire à zéro (abandon explicite de la saisie). */
  function shut() {
    panel.style.display = "none";
    btn.setAttribute("aria-expanded", "false");
    chosen = 0;
    paint();
    draft = "";
    ta.value = "";
    title.textContent = "Comment s'est passée votre visite ?";
    form.style.display = "block";
    done.style.display = "none";
    // Fermeture APRÈS un envoi : le silence est armé, on se retire de la page.
    // Fermeture sur ABANDON : rien n'a été armé, silenced() est faux, le lanceur
    // revient — un avis abandonné ne doit jamais faire taire le widget.
    if (silenced()) return unmount();
    btn.style.display = "flex";
  }

  /** Bascule sur l'accusé de réception. Ne se referme PAS tout seul. */
  function thanks() {
    form.style.display = "none";
    done.style.display = "block";
    panel.style.display = "block";
    btn.style.display = "none";
    try {
      doneClose.focus({ preventScroll: true });
    } catch (_) {
      /* sans conséquence */
    }
  }

  btn.onclick = open;
  cancel.onclick = shut;
  doneClose.onclick = shut;
  submit.onclick = function () {
    var comment = commentValue();
    // Note absente : on part quand même DÈS QU'IL Y A UN COMMENTAIRE, avec
    // score:null. Refuser l'envoi ferait perdre le verbatim — le signal le plus
    // riche — au motif qu'il manque un scalaire. Côté console, la lecture est
    // déjà `(nullif(props->>'score',''))::int`, donc un score null est exclu des
    // moyennes CSAT sans les fausser. Sans note NI commentaire, il n'y a rien à
    // envoyer : on le dit au lieu d'émettre un événement vide.
    if (!chosen && !comment) {
      title.textContent = "Choisissez une note, ou laissez un commentaire.";
      return;
    }
    if (!send(chosen || null, comment)) {
      // Le SDK n'est pas là (ou a refusé) : surtout ne pas afficher « envoyé ».
      title.textContent = "Envoi impossible pour le moment. Réessayez plus tard.";
      return;
    }
    // Le silence n'est armé QU'ICI : après un envoi confirmé, jamais sur un
    // abandon ni sur un envoi refusé par le SDK.
    rememberSent();
    // Vidé APRÈS un envoi confirmé, et jamais avant : la saisie reste disponible
    // tant que l'avis n'est pas parti.
    draft = "";
    ta.value = "";
    chosen = 0;
    paint();
    thanks();
  };

  // Visibilité selon le chemin autorisé — rétablit le bouton si autorisé (et le
  // panneau n'est pas ouvert), masque tout sinon. Appelée au montage et à chaque
  // navigation.
  function refreshGate() {
    if (!mounted) return; // démonté (silence armé) : rien à réafficher
    if (!pathAllowed()) {
      btn.style.display = "none";
      panel.style.display = "none";
    } else if (panel.style.display !== "block") {
      btn.style.display = "flex";
    }
  }

  var mounted = false;

  function mount() {
    // Période de silence : on ne monte RIEN. Pas de nœud invisible, pas
    // d'écouteur — le widget est absent de la page, pas simplement masqué.
    if (silenced()) return;
    document.body.appendChild(btn);
    document.body.appendChild(panel);
    mounted = true;
    refreshGate();
  }

  /** Retire le widget de la page (silence armé en cours de session). */
  function unmount() {
    mounted = false;
    try {
      if (btn.parentNode) btn.parentNode.removeChild(btn);
      if (panel.parentNode) panel.parentNode.removeChild(panel);
    } catch (_) {
      /* nœuds déjà retirés par l'application hôte : sans conséquence */
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }

  // SPA : ré-évaluer le garde à chaque changement de route (popstate + patch des
  // méthodes history). Sans onlyPaths, on ne touche à rien (widget partout).
  if (ONLY && ONLY.length) {
    var fire = function () { setTimeout(refreshGate, 0); };
    window.addEventListener("popstate", fire);
    ["pushState", "replaceState"].forEach(function (m) {
      var orig = history[m];
      if (typeof orig === "function") {
        history[m] = function () {
          var r = orig.apply(this, arguments);
          fire();
          return r;
        };
      }
    });
  }
})();
