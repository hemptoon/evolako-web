// Routes and guards. Three situations: nobody (the landing), a customer with a charging point (Danas ·
// Statistika · Obračuni · Profil) and a signed-in lead without a point yet (Moja prijava · Paketi · Profil).
// The demo accounts go through exactly the same screens. The pages of Evolako pismo (/pismo, /pismo/<slug>, /odjava)
// and the account deletion page (/obrisi-nalog) are the same for everyone, whatever the session.
import type { ComponentType } from "preact";
import { lazy, Suspense } from "preact/compat";
import { useEffect } from "preact/hooks";
import { useCurrencySync } from "./app/currency";
import { finishGoogleSignIn } from "./app/google";
import { useUser } from "./app/data";
import { location, match, navigate } from "./app/router";
import { demoAvailable, session, signOut } from "./app/session";
import { errorMessage, isOfflineError } from "./app/texts";
import { lang, t } from "./i18n";
import Prijava from "./screens/Prijava";
import { ErrorBoundary } from "./shell/ErrorBoundary";
import { OfflineStrip, UpdatePrompt } from "./shell/Pwa";
import { Shell, type Mode } from "./shell/Shell";
import { LoadingScreen } from "./ui/brand";
import { Button } from "./ui/controls";
import { EmptyState, Toasts } from "./ui/display";

const Demo = lazy(() => import("./screens/Demo"));
const Danas = lazy(() => import("./screens/Danas"));
const Statistika = lazy(() => import("./screens/Statistika"));
const Obracuni = lazy(() => import("./screens/Obracuni"));
const Obracun = lazy(() => import("./screens/Obracun"));
const Ocitavanje = lazy(() => import("./screens/Ocitavanje"));
const Profil = lazy(() => import("./screens/profil/Profil"));
const Tacka = lazy(() => import("./screens/profil/Tacka"));
const Pretplata = lazy(() => import("./screens/profil/Pretplata"));
const PozoviKomsiju = lazy(() => import("./screens/profil/PozoviKomsiju"));
const PrijaviKvar = lazy(() => import("./screens/profil/PrijaviKvar"));
const SelimSe = lazy(() => import("./screens/profil/SelimSe"));
const CeneStruje = lazy(() => import("./screens/profil/CeneStruje"));
const Nalog = lazy(() => import("./screens/profil/Nalog"));
const Pitanja = lazy(() => import("./screens/profil/Pitanja"));
const Podrska = lazy(() => import("./screens/profil/Podrska"));
const OAplikaciji = lazy(() => import("./screens/profil/OAplikaciji"));
const MojaPrijava = lazy(() => import("./screens/lead/MojaPrijava"));
const ZatraziProcenu = lazy(() => import("./screens/lead/ZatraziProcenu"));
const Paketi = lazy(() => import("./screens/lead/Paketi"));
const Paket = lazy(() => import("./screens/lead/Paket"));
const NotFound = lazy(() => import("./screens/NotFound"));
const Potvrda = lazy(() => import("./screens/pismo/Potvrda"));
const Odjava = lazy(() => import("./screens/pismo/Odjava"));
const Pismo = lazy(() => import("./screens/pismo/Pismo"));
const ObrisiNalog = lazy(() => import("./screens/ObrisiNalog"));

type Screen = ComponentType<{ params: Record<string, string>; mode: Mode }>;
type Access = "customer" | "lead" | "both";

/**
 * Pages for anyone — signed in, in the demo or nobody: the ones e-mails link to (Evolako pismo) and the account
 * deletion page that Google Play links to (/obrisi-nalog). The same page whatever the session, without the account's
 * navigation; signed out, they are NOT sent through sign-in first.
 */
const PUBLIC_ROUTES: Array<{ pattern: string; screen: ComponentType<{ params: Record<string, string> }> }> = [
  { pattern: "/pismo", screen: Potvrda },
  { pattern: "/pismo/:slug", screen: Pismo },
  { pattern: "/odjava", screen: Odjava },
  { pattern: "/obrisi-nalog", screen: ObrisiNalog },
];

function publicPage(path: string) {
  for (const route of PUBLIC_ROUTES) {
    const params = match(route.pattern, path);
    if (params) return { Screen: route.screen, params };
  }
  // Anything else under /pismo/ (/pismo/a/b, a malformed escape) is an issue that does not exist, not an account page.
  if (path.startsWith("/pismo/")) return { Screen: Pismo, params: { slug: "" } };
  return null;
}

const ROUTES: Array<{ pattern: string; screen: Screen; access: Access }> = [
  { pattern: "/danas", screen: Danas, access: "customer" },
  { pattern: "/statistika", screen: Statistika, access: "customer" },
  { pattern: "/obracuni", screen: Obracuni, access: "customer" },
  { pattern: "/obracuni/:month", screen: Obracun, access: "customer" },
  { pattern: "/ocitavanje", screen: Ocitavanje, access: "customer" },
  { pattern: "/profil", screen: Profil, access: "both" },
  { pattern: "/profil/tacka", screen: Tacka, access: "customer" },
  { pattern: "/profil/pretplata", screen: Pretplata, access: "customer" },
  { pattern: "/profil/pozovi-komsiju", screen: PozoviKomsiju, access: "customer" },
  { pattern: "/profil/prijavi-kvar", screen: PrijaviKvar, access: "customer" },
  { pattern: "/profil/selim-se", screen: SelimSe, access: "customer" },
  { pattern: "/profil/cene-struje", screen: CeneStruje, access: "customer" },
  { pattern: "/profil/nalog", screen: Nalog, access: "both" },
  { pattern: "/profil/pitanja", screen: Pitanja, access: "both" },
  { pattern: "/profil/podrska", screen: Podrska, access: "both" },
  { pattern: "/profil/o-aplikaciji", screen: OAplikaciji, access: "both" },
  { pattern: "/moja-prijava", screen: MojaPrijava, access: "lead" },
  { pattern: "/zatrazi-procenu", screen: ZatraziProcenu, access: "both" },
  { pattern: "/paketi", screen: Paketi, access: "both" },
  { pattern: "/paketi/:id", screen: Paket, access: "both" },
];

/** /auth/google: the return from Google's account chooser (app/google.ts) — a moment of loading, then the account. */
function GoogleReturn() {
  useEffect(() => {
    void finishGoogleSignIn();
  }, []);
  return <LoadingScreen />;
}

/** Replace the location after render (never navigate while rendering). */
function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, { replace: true }), [to]);
  return <LoadingScreen />;
}

function home(mode: Mode): string {
  return mode === "customer" ? "/danas" : "/moja-prijava";
}

function Account() {
  const user = useUser();
  useCurrencySync(user.data);
  const path = location.value.path;
  if (!user.data) {
    if (user.loading) return <LoadingScreen />;
    return (
      <div class="public public--center">
        <EmptyState
          icon={isOfflineError(user.error) ? "wifiOff" : "alert"}
          tone={isOfflineError(user.error) ? "accent" : "fault"}
          title={t("Nešto nije u redu")}
          message={errorMessage(user.error)}
          testId="error-state"
          action={
            <div class="state__actions">
              <Button icon="refresh" onClick={() => void user.reload()}>{t("Pokušaj ponovo")}</Button>
              <Button variant="ghost" icon="logout" onClick={() => void signOut()}>{t("Odjavi se")}</Button>
            </div>
          }
        />
      </div>
    );
  }
  const mode: Mode = user.data.chargePoints.length > 0 ? "customer" : "lead";
  if (path === "/" || path === "/prijava" || path === "/demo") return <Redirect to={home(mode)} />;
  let content = <NotFound params={{}} mode={mode} />;
  for (const route of ROUTES) {
    const params = match(route.pattern, path);
    if (!params) continue;
    if (route.access !== "both" && route.access !== mode) return <Redirect to={home(mode)} />;
    const Screen = route.screen;
    // Keyed by path: a new screen starts fresh (its own state, its own focus target).
    content = <Screen key={path} params={params} mode={mode} />;
    break;
  }
  return (
    <Shell mode={mode} user={user.data}>
      <OfflineStrip />
      <ErrorBoundary level="page" resetKey={path}>
        <Suspense fallback={<LoadingScreen />}>{content}</Suspense>
      </ErrorBoundary>
    </Shell>
  );
}

export function App() {
  const s = session.value;
  const path = location.value.path;
  // The whole tree re-renders on a language switch (every t() call reads the signal).
  void lang.value;
  const open = publicPage(path);
  let body;
  if (s.kind === "booting") body = <LoadingScreen />;
  else if (path === "/auth/google") body = <GoogleReturn />;
  else if (open) {
    // Keyed by path: another issue is another page.
    body = <Suspense fallback={<LoadingScreen />}><open.Screen key={path} params={open.params} /></Suspense>;
  } else if (path === "/demo" && s.kind !== "in" && demoAvailable.value) {
    body = <Suspense fallback={<LoadingScreen />}><Demo params={{}} mode="customer" /></Suspense>;
  }
  else if (path === "/demo" && s.kind === "out") body = <Redirect to="/prijava" />;
  else if (s.kind === "out") {
    if (path === "/prijava") body = <Prijava />;
    else {
      const next = path === "/" ? "" : `?next=${encodeURIComponent(path + window.location.search)}`;
      body = <Redirect to={`/prijava${next}`} />;
    }
  } else body = <Account />;
  return (
    <>
      {body}
      <Toasts />
      <UpdatePrompt />
    </>
  );
}
