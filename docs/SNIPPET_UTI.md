# Prompt à coller — session Claude dédiée à `uti-platform`

> Copie tout le bloc ci-dessous dans une session Claude Code ouverte sur le repo
> **jt33120/uti-platform** (la plateforme déployée sur `https://plateforme.groupement-it.com`).
> Il installe / met à niveau le snippet RUM MIP. Le back OTel de la plateforme
> reste inchangé — on ne touche qu'au front.

---

## PROMPT

Tu travailles sur le repo **uti-platform** (déployé sur `https://plateforme.groupement-it.com`).
On le monitore avec notre outil RUM « MIP RUM ». Objectif : **garantir que le snippet
RUM front est présent, correctement configuré et actif sur toutes les pages**. Il se
peut qu'un ancien snippet existe déjà (des données front arrivent encore) — dans ce
cas, **mets-le à niveau** avec la config ci-dessous ; sinon, **ajoute-le**.

### 1. Détecte la stack et l'emplacement du `<head>` global

Cherche d'abord un snippet existant : `grep -rniE "miprum|mip-rum|v1-traces|groupement-it" --include=*.{ts,tsx,js,jsx,html,vue,svelte} .`
Puis identifie le point d'injection global selon la stack :

- **Next.js App Router** → `app/layout.tsx` (composant `<Script>` de `next/script`).
- **Next.js Pages Router** → `pages/_document.tsx` (`<Head>`), ou `_app.tsx`.
- **Angular** → `src/index.html` (`<head>`).
- **Vue/Nuxt** → `nuxt.config` (`app.head.script`) ou `index.html`.
- **HTML statique / autre** → le `<head>` du template de layout partagé (pas une seule page).

Le snippet doit se charger sur **toutes** les pages, le plus tôt possible dans le `<head>`.

### 2. Le snippet à installer (valeurs de prod, prêtes)

```html
<!-- MIP RUM — Real User Monitoring (front) -->
<script src="https://mip-rum-console.vercel.app/mip-rum.js"></script>
<script>
  MIPRum.init({
    endpoint: "https://nupxrdpsliqptqnjkmgw.supabase.co/functions/v1/v1-traces",
    appId: "gip-plateforme",
    clientId: "groupement-it",
    apiKey: "mip_live_gip_59ca708ce596d20a52d58ea976dc512c516b442a",
    env: "production",
    // release: "<git-sha-du-build>",   // optionnel mais recommandé : associe les erreurs aux source maps
    sampleRate: 1.0,     // 100% des sessions (POC)
    trace: true,         // tracing distribué : relie le front aux spans back déjà collectés
    replay: 0.1,         // 10% des sessions en session-replay (rrweb, maskAllInputs activé)
    frustration: true    // rage clicks / dead clicks
  });
</script>
```

**Adaptations par stack** (garde la même config d'`init`) :

- **Next.js** : n'utilise PAS deux `<script>` bruts. Mets le loader en `beforeInteractive`
  et l'init juste après :
  ```tsx
  import Script from "next/script";
  // dans <body> de app/layout.tsx (ou <Head>) :
  <Script src="https://mip-rum-console.vercel.app/mip-rum.js" strategy="beforeInteractive" />
  <Script id="mip-rum-init" strategy="beforeInteractive">{`
    MIPRum.init({ endpoint:"https://nupxrdpsliqptqnjkmgw.supabase.co/functions/v1/v1-traces",
      appId:"gip-plateforme", clientId:"groupement-it",
      apiKey:"mip_live_gip_59ca708ce596d20a52d58ea976dc512c516b442a",
      env:"production", sampleRate:1.0, trace:true, replay:0.1, frustration:true });
  `}</Script>
  ```
  Idéalement, mets la clé dans `NEXT_PUBLIC_MIP_API_KEY` (elle est de toute façon
  exposée côté navigateur — c'est un identifiant anti-usurpation, pas un secret fort).

- **Angular** : les deux `<script>` dans `src/index.html` `<head>` suffisent.

### 3. RGPD / consentement (important)

La collecte est **anonymisée** (empreinte `user_hash`, pas d'IP stockée, `maskAllInputs`
activé sur le replay). La prod actuelle tourne **sans gate de consentement** — garde ce
comportement (pas de `requireConsent`) pour ne pas couper le flux existant. **Si** la
plateforme a une bannière cookies, ajoute `requireConsent: true` à l'`init` puis appelle
`MIPRum.consent(true)` quand l'utilisateur accepte (et `MIPRum.consent(false)` s'il refuse).

### 4. Ne touche PAS au backend

Le back de la plateforme envoie déjà ~192k spans OTel (tracing serveur). **Ne modifie
aucune instrumentation backend** ni variable OTel serveur. Ce chantier est **front only**.

### 5. Vérifie

1. Build + lance la plateforme (ou ouvre la preview).
2. Ouvre les DevTools → onglet **Network**, filtre `v1-traces`. Navigue sur 2-3 pages :
   tu dois voir des `POST` vers
   `…supabase.co/functions/v1/v1-traces` répondant **200**.
3. En console navigateur, `window.MIPRum` doit être défini (fonctions `init`, `track`, `consent`).
4. Optionnel : `MIPRum.track("smoke_test", { ok: true })` doit partir dans un beacon.

Quand c'est déployé, **préviens** : côté RUM on vérifiera l'arrivée des données (nouvelles
lignes `rum_pageview` / `rum_metric` avec la clé) puis on activera l'enforcement de la clé API.

### 6. Livrable

Ouvre une PR (draft) qui ajoute/mets à niveau le snippet, avec en description : le fichier
modifié, la stack détectée, et une capture (ou description) des beacons `v1-traces` 200 observés.

---

*(La clé `mip_live_gip_…` ci-dessus est propre à `gip-plateforme`. Elle identifie l'app à
l'ingestion. L'enforcement `REQUIRE_API_KEY` sera activé côté RUM une fois ce snippet en prod.)*
