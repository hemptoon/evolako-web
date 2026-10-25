// The service worker (shell + static assets only, never API responses) and the "new version" prompt.
// A new worker waits until the person taps "Osveži": the page never reloads under someone's hands.
import { signal } from "@preact/signals";
import { t } from "../i18n";
import { Button } from "../ui/controls";
import { Icon } from "../ui/Icon";

const waiting = signal<ServiceWorker | null>(null);
/** Set when the person taps "Osveži": only then does a controller change reload the page (not on the first
 *  install, where clients.claim() also changes the controller). */
let accepted = false;
export const online = signal(typeof navigator === "undefined" ? true : navigator.onLine);

export function installNetworkWatch(): void {
  window.addEventListener("online", () => (online.value = true));
  window.addEventListener("offline", () => (online.value = false));
}

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  const local = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  if (location.protocol !== "https:" && !local) return;
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!accepted || reloading) return;
    reloading = true;
    location.reload();
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).then((registration) => {
      const offer = (worker: ServiceWorker | null) => {
        // Only an update is offered: the very first install has nothing to replace.
        if (worker && navigator.serviceWorker.controller) waiting.value = worker;
      };
      offer(registration.waiting);
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed") offer(worker);
        });
      });
      // A long-open tab still learns about deploys.
      setInterval(() => void registration.update().catch(() => undefined), 60 * 60 * 1000);
    }).catch(() => undefined);
  });
}

export function UpdatePrompt() {
  const worker = waiting.value;
  if (!worker) return null;
  return (
    <div class="update-card" role="status" data-testid="update-prompt">
      <Icon name="sparkles" />
      <span class="update-card__text">{t("Stigla je nova verzija")}</span>
      <Button size="sm" onClick={() => {
        accepted = true;
        worker.postMessage("skipWaiting");
      }} testId="update-reload">{t("Osveži")}</Button>
    </div>
  );
}

/** A quiet strip when the browser is offline: the screen keeps the last data it has. */
export function OfflineStrip() {
  if (online.value) return null;
  return (
    <div class="offline-strip" role="status" data-testid="offline-strip">
      <Icon name="wifiOff" />
      <span><strong>{t("Nema interneta.")}</strong> {t("Prikazujemo poslednje poznate podatke.")}</span>
    </div>
  );
}
