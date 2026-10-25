// /prijava — the calm front door: what Moj Evolako is, sign-in with Google or by e-mail code, the demo and the way to the
// site.
import { useEffect, useRef, useState } from "preact/hooks";
import { LINKS, siteUrl } from "../app/contacts";
import { googleAvailable, googleNotice, startGoogleSignIn } from "../app/google";
import { prefillEmail } from "../app/links";
import { location, navigate, safeNext } from "../app/router";
import { demoAvailable, requestCode, sessionNotice, signInAvailable, verifyCode } from "../app/session";
import { errorMessage } from "../app/texts";
import { contentLang, lang, msg, t } from "../i18n";
import { Render } from "../ui/Render";
import { Brand } from "../ui/brand";
import { GoogleMark } from "../ui/google";
import { Button, TextField } from "../ui/controls";
import { Banner } from "../ui/display";
import { Icon, type IconName } from "../ui/Icon";
import { PublicControls } from "./public";

const RESEND_SECONDS = 60;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function SignInCard() {
  const [stage, setStage] = useState<"email" | "code">("email");
  // /prijava?email=… fills the address in (from a link in an e-mail); the code is sent only on a tap.
  const [email, setEmail] = useState(() => prefillEmail(location.value.query));
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const codeRef = useRef<HTMLDivElement>(null);
  const [leaving, setLeaving] = useState(false);
  const normalized = email.trim().toLowerCase();

  const google = () => {
    if (leaving) return;
    setLeaving(true);
    // The page leaves for Google; if it comes back from the browser's cache (Back), the button works again.
    void startGoogleSignIn(location.value.query.get("next")).finally(() => setTimeout(() => setLeaving(false), 3000));
  };

  useEffect(() => {
    if (stage !== "code") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    codeRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    return () => clearInterval(timer);
  }, [stage]);

  const left = Math.max(0, RESEND_SECONDS - Math.floor((now - sentAt) / 1000));

  const send = async () => {
    if (busy) return;
    if (!EMAIL.test(normalized)) {
      setError(t("Proveri adresu e-pošte."));
      return;
    }
    setBusy(true);
    setError(null);
    googleNotice.value = null;
    try {
      await requestCode(normalized, contentLang(lang.value));
      setSentAt(Date.now());
      setNow(Date.now());
      setCode("");
      setStage("code");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (value = code) => {
    if (busy) return;
    if (!/^\d{6}$/.test(value)) {
      setError(t("Kod nije tačan ili je istekao. Proveri pismo ili zatraži novi."));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await verifyCode(normalized, value);
      navigate(safeNext(location.value.query.get("next")) ?? "/", { replace: true });
    } catch (e) {
      setCode("");
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  if (!signInAvailable.value) {
    return (
      <div class="signin card card--block" data-testid="signin-soon">
        <h2 class="signin__title">{t("Prijava")}</h2>
        <p class="signin__text">{t("Prijava na webu stiže uskoro. Do tada pogledaj demo.")}</p>
        <Button block icon="playCircle" href="/demo" testId="landing-demo">{t("Pogledaj demo")}</Button>
        <p class="signin__note"><Icon name="info" />{t("Nalog otvaramo mi, posle ugradnje kompleta.")}</p>
      </div>
    );
  }

  return (
    <form class="signin card card--block" data-testid="signin" noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void (stage === "email" ? send() : verify());
      }}>
      <h2 class="signin__title">{t("Prijava")}</h2>
      {stage === "email" ? (
        <>
          <p class="signin__text" data-testid="signin-lead">
            {t("Prijavi se istom e-poštom kao u zahtevu za procenu. Ovde pratiš status procene i ugradnje, a kad je komplet ugrađen — obračune i punjenje.")}
          </p>
          {googleNotice.value ? (
            <Banner tone="fault" icon="alert" testId="google-error"
              title={googleNotice.value === "offline" ? t("Nema veze sa serverom. Proveri internet i pokušaj ponovo.")
                : googleNotice.value === "rateLimited" ? t("Previše pokušaja. Pokušaj ponovo za minut.")
                : t("Prijava preko Google naloga nije uspela. Pokušaj ponovo ili se prijavi kodom na e-poštu.")} />
          ) : null}
          {googleAvailable.value ? (
            <>
              <button type="button" class="btn btn--secondary btn--block btn--google" onClick={google}
                aria-busy={leaving ? "true" : undefined} data-testid="signin-google">
                <GoogleMark />
                <span>{t("Nastavi sa Google nalogom")}</span>
              </button>
              <p class="signin__or" aria-hidden="true"><span>{t("ili kodom na e-poštu")}</span></p>
            </>
          ) : null}
          <TextField label={t("E-pošta")} type="email" value={email} onValue={setEmail} autoComplete="email"
            inputMode="email" placeholder="ime@primer.rs" autoCapitalize="none" spellcheck={false}
            error={error} testId="signin-email" name="email" />
          <Button type="submit" block loading={busy} testId="signin-send">{t("Pošalji kod")}</Button>
        </>
      ) : (
        <>
          <p class="signin__text" aria-live="polite">{t("Poslali smo šestocifreni kod na %@.", normalized)}</p>
          <div ref={codeRef}>
            <TextField label={t("Šestocifreni kod")} value={code} inputClass="input--code" autoComplete="one-time-code"
              inputMode="numeric" pattern="[0-9]*" maxLength={6} placeholder="••••••" error={error} testId="signin-code"
              name="code"
              onValue={(raw) => {
                const digits = raw.replace(/\D/g, "").slice(0, 6);
                setCode(digits);
                // Autofill from the e-mail puts all six digits at once: send them without another tap.
                if (digits.length === 6) void verify(digits);
              }} />
          </div>
          <Button type="submit" block loading={busy} testId="signin-verify">{t("Potvrdi")}</Button>
          <div class="signin__row">
            <button type="button" class="link-btn" disabled={left > 0 || busy} onClick={() => void send()}
              data-testid="signin-resend">
              {left > 0 ? t("Pošalji ponovo za %@ s", String(left)) : t("Pošalji ponovo")}
            </button>
            <button type="button" class="link-btn" onClick={() => {
              setStage("email");
              setCode("");
              setError(null);
            }}>{t("Promeni e-poštu")}</button>
          </div>
        </>
      )}
      {stage === "email" ? (
        <p class="signin__note"><Icon name="lock" />
          {googleAvailable.value ? t("Bez lozinke — preko Google naloga ili kodom na e-poštu.") : t("Prijava kodom na e-poštu — bez lozinke.")}
        </p>
      ) : null}
    </form>
  );
}

const POINTS: Array<{ icon: IconName; title: string; text: string }> = [
  { icon: "qr", title: msg("Obračuni sa IPS QR kodom"), text: msg("Dokument sa iznosima i IPS QR kodom: skeniraš u banci i platiš.") },
  { icon: "chart", title: msg("Punjenje i potrošnja po danima"), text: msg("Noćna i dnevna energija, sesije i izvoz za Excel.") },
  { icon: "wrench", title: msg("Prijavi kvar i prati servis"), text: msg("Javićemo se u roku od 48 h.") },
  { icon: "users", title: msg("Pozovi komšiju — besplatni meseci"),
    text: msg("Za svaku ugradnju po tvojoj preporuci — besplatni meseci i tebi i prijatelju.") },
];

export default function Prijava() {
  useEffect(() => {
    document.title = `${t("Prijava")} · ${t("Moj Evolako")}`;
  }, [lang.value]);
  const siteLink = siteUrl(LINKS.kviz, lang.value);
  return (
    <div class="landing" data-testid="landing">
      <div class="landing__main">
        <div class="public__bar">
          <a href="/prijava" class="brand" aria-label="Evolako"><Brand size={24} /></a>
          <PublicControls />
        </div>
        <div class="landing__content">
          <div class="landing__photo-sm" aria-hidden="true">
            <Render name="paket-wallbox-closeup" sizes="(min-width: 640px) 90vw, 100vw" alt="" />
          </div>
          <p class="kicker">{t("Moj Evolako")}</p>
          <h1 class="landing__title" id="page-title" tabIndex={-1}>
            {t("Tvoja tačka punjenja, obračuni i pretplata na jednom mestu")}
          </h1>
          <p class="landing__lead">{t("Isti nalog kao u aplikaciji Evolako — na računaru, tabletu ili telefonu.")}</p>
          {sessionNotice.value === "expired" ? (
            <Banner tone="info" icon="clock" title={t("Sesija je istekla. Prijavi se ponovo.")} testId="session-expired" live />
          ) : sessionNotice.value === "deleted" ? (
            <Banner tone="info" icon="checkCircle" title={t("Nalog je obrisan.")}
              text={t("Ime, kontakt, zahtevi i fotografije su obrisani. Obračuni ostaju samo sa imenom platioca — čuvamo ih po zakonu.")}
              testId="account-deleted" live />
          ) : null}
          <div class="landing__actions">
            <SignInCard />
            {signInAvailable.value && demoAvailable.value ? (
              <Button variant="secondary" block icon="playCircle" href="/demo" testId="landing-demo">
                {t("Pogledaj demo")}
              </Button>
            ) : null}
            <a class="landing__site" href={siteLink} target="_blank" rel="noopener noreferrer" data-testid="landing-site">
              {t("Još nemaš Evolako? Proveri svoju garažu →")}
            </a>
          </div>
          <ul class="landing__points">
            {POINTS.map((p) => (
              <li key={p.title} class="landing__point">
                <span class="landing__point-icon"><Icon name={p.icon} /></span>
                <span>
                  <strong>{t(p.title)}</strong>
                  <span>{t(p.text)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div class="landing__visual" aria-hidden="true">
        {/* Lazy: the panel is hidden on phones, so they never download it. Cover on a tall panel draws the
            image about 1.8 × the viewport height wide. */}
        <Render name="paket-wallbox-closeup" sizes="180vh" alt="" class="render--day" />
        <Render name="paket-garage" sizes="240vh" alt="" class="render--night" />
        <div class="landing__glass">
          <span class="badge badge--charging"><span class="pulse-dot" />{t("Punjenje u toku")}</span>
          <div class="landing__glass-metric"><span>10,8</span><small>{t("kW")}</small></div>
          <div class="landing__glass-row">
            <span>{t("Noćna")}</span>
            <strong>7,3 {t("kWh")}</strong>
          </div>
        </div>
      </div>
    </div>
  );
}
