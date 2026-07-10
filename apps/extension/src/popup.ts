// Popup — transparence + octroi de permission (Ext-C). C'est ICI, et seulement
// ici, qu'un domaine passe de "reconnu" à "observé" : l'octroi de permission
// (chrome.permissions.request) exige un geste utilisateur, satisfait par le clic
// sur l'icône de l'extension qui ouvre ce popup.
/// <reference types="chrome" />
import type { InjectDecision } from "../lib/scope";

interface TabState {
  host: string;
  decision: InjectDecision | null;
}

const REASON_LABEL: Record<string, string> = {
  "domain-not-scoped": "Ce domaine n'est pas suivi par MIP RUM.",
  "sdk-already-present": "Ce site a déjà son propre SDK MIP RUM — l'extension n'intervient pas ici.",
  "permission-required": "Domaine reconnu — autorisation requise pour observer ce site.",
  ok: "MIP RUM observe ce domaine.",
};

async function currentTab(): Promise<chrome.tabs.Tab | undefined> {
  // "activeTab" (manifest) donne l'URL réelle de l'onglet actif UNIQUEMENT parce
  // que ce popup est ouvert par un clic utilisateur sur l'icône — sans ce
  // privilège temporaire, tab.url serait vide pour un domaine non encore autorisé.
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function originOf(url: string): string | null {
  try {
    return `${new URL(url).origin}/*`;
  } catch {
    return null;
  }
}

async function render(): Promise<void> {
  const root = document.getElementById("root");
  if (!root) return;
  const tab = await currentTab();
  if (!tab?.id || !tab.url) {
    root.textContent = "Aucun onglet actif.";
    return;
  }

  const key = `mip_rum_tab_${tab.id}`;
  const stored = await chrome.storage.session.get(key);
  const state = stored[key] as TabState | undefined;

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
      const origin = originOf(tab.url!);
      if (!origin) return;
      btn.disabled = true;
      const granted = await chrome.permissions.request({ origins: [origin] });
      if (granted) {
        await chrome.tabs.reload(tab.id!); // relance la navigation -> réévaluation avec permission accordée
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
      const origin = originOf(tab.url!);
      if (!origin) return;
      await chrome.permissions.remove({ origins: [origin] });
      btn.textContent = "Autorisation retirée (effective à la prochaine visite)";
      btn.disabled = true;
    };
    root.appendChild(btn);
  }
}

void render();
