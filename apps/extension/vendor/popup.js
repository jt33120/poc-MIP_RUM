// src/popup.ts
var REASON_LABEL = {
  "domain-not-scoped": "Ce domaine n'est pas suivi par MIP RUM.",
  "sdk-already-present": "Ce site a d\xE9j\xE0 son propre SDK MIP RUM \u2014 l'extension n'intervient pas ici.",
  "permission-required": "Domaine reconnu \u2014 autorisation requise pour observer ce site.",
  ok: "MIP RUM observe ce domaine."
};
async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}
function originOf(url) {
  try {
    return `${new URL(url).origin}/*`;
  } catch {
    return null;
  }
}
async function render() {
  const root = document.getElementById("root");
  if (!root) return;
  const tab = await currentTab();
  if (!tab?.id || !tab.url) {
    root.textContent = "Aucun onglet actif.";
    return;
  }
  const key = `mip_rum_tab_${tab.id}`;
  const stored = await chrome.storage.session.get(key);
  const state = stored[key];
  if (!state?.decision) {
    root.innerHTML = `<p class="status">${REASON_LABEL["domain-not-scoped"]}</p>`;
    return;
  }
  const { host, decision } = state;
  const label = REASON_LABEL[decision.reason] ?? decision.reason;
  root.innerHTML = `
    <p class="domain">${host}</p>
    <p class="status status-${decision.reason}">${label}</p>
  `;
  if (decision.reason === "permission-required") {
    const btn = document.createElement("button");
    btn.textContent = "Activer sur ce domaine";
    btn.onclick = async () => {
      const origin = originOf(tab.url);
      if (!origin) return;
      btn.disabled = true;
      const granted = await chrome.permissions.request({ origins: [origin] });
      if (granted) {
        await chrome.tabs.reload(tab.id);
        window.close();
      } else {
        btn.disabled = false;
      }
    };
    root.appendChild(btn);
  }
  if (decision.reason === "ok" || decision.reason === "sdk-already-present") {
    const btn = document.createElement("button");
    btn.textContent = "Retirer l'autorisation pour ce domaine";
    btn.onclick = async () => {
      const origin = originOf(tab.url);
      if (!origin) return;
      await chrome.permissions.remove({ origins: [origin] });
      btn.textContent = "Autorisation retir\xE9e (effective \xE0 la prochaine visite)";
      btn.disabled = true;
    };
    root.appendChild(btn);
  }
}
void render();
