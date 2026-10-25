// "Zatraži procenu": the assessment request (ZatraziProcenuView of the app) — contact, where the car sleeps,
// the kit and the car, a referral code and a comment. Privacy consent is required; e-mail tips are optional and
// unticked. Sent to /functions/v1/installation-requests with the browser's anonymous x-install-id.
import { useState } from "preact/hooks";
import type { City, InstallationDraft, InstallationRequest, PackageId, Parking } from "../../api/types";
import { LINKS, siteUrl } from "../../app/contacts";
import { backendOrThrow, k } from "../../app/data";
import { invalidate } from "../../app/query";
import { errorMessage } from "../../app/texts";
import { contentLang, lang, siteText, t } from "../../i18n";
import { Button, Checkbox, SelectField, TextArea, TextField } from "../../ui/controls";
import { Icon } from "../../ui/Icon";
import { isValidEmail, isValidPhone, normalizeReferral } from "../../lib/forms";
import { ALL_PACKAGES, CITY_OPTIONS, PARKING_OPTIONS } from "./content";

type Problem = "missingName" | "missingContact" | "invalidPhone" | "invalidEmail" | "missingCity" | "missingParking"
  | "invalidReferralCode" | "missingConsent";

export function problems(d: InstallationDraft): Problem[] {
  const out: Problem[] = [];
  const phone = d.phone.trim();
  const email = d.email.trim();
  if (!d.name.trim()) out.push("missingName");
  if (!phone && !email) out.push("missingContact");
  if (phone && !isValidPhone(phone)) out.push("invalidPhone");
  if (email && !isValidEmail(email)) out.push("invalidEmail");
  if (!d.city) out.push("missingCity");
  if (!d.parking) out.push("missingParking");
  if (d.referralCode.trim() && !normalizeReferral(d.referralCode)) out.push("invalidReferralCode");
  if (!d.acceptsPrivacyPolicy) out.push("missingConsent");
  return out;
}

function problemText(p: Problem): string {
  switch (p) {
    case "missingName": return t("Upiši ime.");
    case "missingContact": return t("Upiši telefon ili e-mail.");
    case "invalidPhone": return t("Proveri broj — npr. +381 60 123 45 67.");
    case "invalidEmail": return t("Proveri e-mail adresu.");
    case "missingCity": return t("Izaberi grad.");
    case "missingParking": return t("Izaberi gde auto noći.");
    case "invalidReferralCode": return t("Kod izgleda ovako: EVO-XXXXX.");
    case "missingConsent": return t("Bez saglasnosti ne možemo da te kontaktiramo.");
  }
}

export function RequestForm({ initial, onSent }: {
  initial: Partial<InstallationDraft>;
  onSent: (request: InstallationRequest) => void;
}) {
  const [draft, setDraft] = useState<InstallationDraft>({
    name: "", phone: "", email: "", city: null, address: "", parking: null, package: null, car: "", comment: "",
    referralCode: "", acceptsPrivacyPolicy: false, ...initial,
  });
  const [marketing, setMarketing] = useState(false);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof InstallationDraft>(key: K, value: InstallationDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setError(null);
  };
  const list = shown ? problems(draft) : [];
  const of = (...ps: Problem[]) => {
    const p = list.find((x) => ps.includes(x));
    return p ? problemText(p) : null;
  };

  const submit = async () => {
    if (busy) return;
    const found = problems(draft);
    if (found.length > 0) {
      setShown(true);
      requestAnimationFrame(() => document.querySelector<HTMLElement>(".request-form [aria-invalid=\"true\"]")?.focus());
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const normalized: InstallationDraft = {
        ...draft,
        name: draft.name.trim(), phone: draft.phone.trim(), email: draft.email.trim(), address: draft.address.trim(),
        car: draft.car.trim(), comment: draft.comment.trim(), referralCode: normalizeReferral(draft.referralCode) ?? "",
      };
      const request = await backendOrThrow().createInstallationRequest(normalized, { lang: contentLang(lang.value), marketingOptIn: marketing });
      invalidate(k("installation"));
      onSent(request);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form class="card card--block form request-form" noValidate data-testid="request-form" onSubmit={(e) => {
      e.preventDefault();
      void submit();
    }}>
      <fieldset class="form__group">
        <legend class="form__legend">{t("Kontakt")}</legend>
        <TextField label={t("Ime")} value={draft.name} onValue={(v) => set("name", v)} placeholder={t("Kako da ti se obratimo")}
          autoComplete="name" error={of("missingName")} testId="request-name" />
        <div class="form__row">
          <TextField label={t("Telefon")} type="tel" value={draft.phone} onValue={(v) => set("phone", v)} placeholder="+381 60 123 45 67"
            autoComplete="tel" inputMode="tel" error={of("invalidPhone")} testId="request-phone" />
          <TextField label={t("E-mail")} type="email" value={draft.email} onValue={(v) => set("email", v)} placeholder="ime@primer.rs"
            autoComplete="email" inputMode="email" autoCapitalize="none" spellcheck={false} error={of("invalidEmail")}
            testId="request-email" />
        </div>
        <p class={of("missingContact") ? "field__error" : "field__hint"}>
          {of("missingContact") ? <Icon name="circleAlert" /> : null}
          <span>{of("missingContact") ?? t("Dovoljan je telefon ili e-mail.")}</span>
        </p>
      </fieldset>

      <fieldset class="form__group">
        <legend class="form__legend">{t("Gde")}</legend>
        <div class="form__row">
          <SelectField<City> label={t("Grad")} value={draft.city ?? ""} placeholder={t("Izaberi")}
            options={CITY_OPTIONS.map((o) => ({ value: o.id, label: siteText(o.title) }))}
            onValue={(v) => set("city", v || null)} error={of("missingCity")} testId="request-city" />
          <SelectField<Parking> label={t("Gde auto noći")} value={draft.parking ?? ""} placeholder={t("Izaberi")}
            options={PARKING_OPTIONS.map((o) => ({ value: o.id, label: siteText(o.title) }))}
            onValue={(v) => set("parking", v || null)} error={of("missingParking")} testId="request-parking" />
        </div>
        <TextField label={t("Adresa (nije obavezno)")} value={draft.address} onValue={(v) => set("address", v)}
          placeholder={t("Ulica i broj, garaža")} autoComplete="street-address" testId="request-address" />
      </fieldset>

      <fieldset class="form__group">
        <legend class="form__legend">{t("Paket i auto")}</legend>
        <div class="form__row">
          <SelectField<PackageId> label={t("Paket")} value={draft.package ?? ""} placeholder={t("Još ne znam")}
            options={ALL_PACKAGES.map((p) => ({ value: p.id, label: siteText(p.name) }))}
            onValue={(v) => set("package", v || null)} testId="request-package" />
          <TextField label={t("Auto")} value={draft.car} onValue={(v) => set("car", v)} placeholder={t("Marka i model")}
            testId="request-car" />
        </div>
      </fieldset>

      <fieldset class="form__group">
        <legend class="form__legend">{t("Još nešto")}</legend>
        <TextField label={t("Imam kod preporuke")} value={draft.referralCode} onValue={(v) => set("referralCode", v)}
          placeholder="EVO-XXXXX" autoCapitalize="characters" autoComplete="off" spellcheck={false}
          error={of("invalidReferralCode")} testId="request-referral" />
        <TextArea label={t("Komentar (nije obavezno)")} value={draft.comment} onValue={(v) => set("comment", v.slice(0, 500))}
          maxLength={500} rows={3} placeholder={t("Sprat garaže, pristup, kada da se javimo…")} testId="request-comment" />
      </fieldset>

      <div class="form__consents">
        <Checkbox checked={draft.acceptsPrivacyPolicy} onChange={(v) => set("acceptsPrivacyPolicy", v)}
          error={of("missingConsent")} testId="request-privacy">
          {t("Prihvatam politiku privatnosti — kontaktirajte me povodom mog upita.")}{" "}
          <a href={siteUrl(LINKS.privacy, lang.value)} target="_blank" rel="noopener noreferrer">{t("Politika privatnosti")}</a>
        </Checkbox>
        <Checkbox checked={marketing} onChange={setMarketing} testId="request-marketing">
          {t("Saveti o punjenju e-poštom")}
          <span class="check-row__hint">{t("Retko, bez reklama drugih firmi. Odjava je u svakom pismu.")}</span>
        </Checkbox>
      </div>

      {error ? <div class="inline-error" role="alert" data-testid="form-error"><Icon name="circleAlert" /><span>{error}</span></div> : null}
      <Button type="submit" block loading={busy} icon="send" testId="request-send">{t("Pošalji")}</Button>
      <p class="note"><Icon name="clock" /><span>{t("Javićemo se u roku od 48 h.")}</span></p>
    </form>
  );
}
