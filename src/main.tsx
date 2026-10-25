// Moj Evolako — entry. Styles in cascade order, then config and session, then the first render.
import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/layout.css";
import "./styles/screens.css";
import "./styles/print.css";
import { render } from "preact";
import { App } from "./App";
import { installDeepLinks } from "./app/links";
import { installRouter } from "./app/router";
import { installFx } from "./app/currency";
import { loadFeatures } from "./app/features";
import { boot } from "./app/session";
import { lang, loadLang } from "./i18n";
import { installTheme } from "./app/settings";
import { ErrorBoundary } from "./shell/ErrorBoundary";
import { installNetworkWatch, registerServiceWorker } from "./shell/Pwa";

installTheme();
installRouter();
installDeepLinks();
installNetworkWatch();
registerServiceWorker();

const root = document.getElementById("app")!;
// The boot splash stays until the config and the interface language are known (small same-origin requests).
const language = loadLang(lang.value).catch(() => {
  lang.value = "sr";
});
// The display currency's rate needs config.json (our apiBase); it never holds up the first render.
const booted = boot().finally(() => {
  installFx();
  void loadFeatures();
});
void Promise.all([booted, language]).finally(() => {
  root.textContent = "";
  render(<ErrorBoundary level="app"><App /></ErrorBoundary>, root);
});
