// /profil/selim-se — moving the kit to a new address: the address (5–200 characters), the date (from the day
// after our 72-hour answer, up to a year ahead) and a comment. One open request at a time.
import { useState } from "preact/hooks";
import type { RelocationRequest } from "../../api/types";
import { activePoint, backendOrThrow, k, useRelocations, useUser } from "../../app/data";
import { invalidate } from "../../app/query";
import { errorMessage } from "../../app/texts";
import { lang, t } from "../../i18n";
import { fromBelgrade } from "../../lib/belgrade";
import { RELOCATION, relocationDates } from "../../lib/forms";
import { fullDate } from "../../lib/format";
import { Page } from "../../shell/Page";
import type { Mode } from "../../shell/Shell";
import { Button, Field, TextArea, TextField } from "../../ui/controls";
import { Banner, Card, ErrorState, Skeleton } from "../../ui/display";
import { Icon } from "../../ui/Icon";
import { isOpenRelocation, PageSkeleton, RelocationRequestCard } from "../common";

const ADDRESS_MIN = RELOCATION.addressMin;
const ADDRESS_MAX = RELOCATION.addressMax;
const COMMENT_LIMIT = RELOCATION.commentMax;

function Sent({ request }: { request: RelocationRequest }) {
  return (
    <div class="stack">
      <Card class="sent" data-testid="relocation-sent">
        <span class="state__icon"><Icon name="checkCircle" /></span>
        <h2 class="state__title">{t("Prijava selidbe je poslata")}</h2>
        <p class="state__text">{t("Javićemo se u roku od 72 h da dogovorimo termin.")}</p>
        <p class="card__sub">{t("Status pratiš u obaveštenjima i u profilu.")}</p>
        <Button href="/profil" icon="check">{t("Gotovo")}</Button>
      </Card>
      <RelocationRequestCard request={request} />
    </div>
  );
}

export default function SelimSe(_props: { params: Record<string, string>; mode: Mode }) {
  const user = useUser();
  const point = activePoint(user.data);
  const relocations = useRelocations(point?.id ?? null);
  const [dates] = useState(() => relocationDates(new Date()));
  const [address, setAddress] = useState("");
  const [date, setDate] = useState(dates.initial);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState<RelocationRequest | null>(null);
  const l = lang.value;
  if (!point) return <PageSkeleton />;

  const submit = async () => {
    if (busy) return;
    const trimmed = address.trim().slice(0, ADDRESS_MAX);
    if (trimmed.length < ADDRESS_MIN || !date || date < dates.earliest || date > dates.latest) {
      setProblem(t("Upiši novu adresu i izaberi datum."));
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const request = await backendOrThrow().createRelocationRequest(point.id, {
        newAddress: trimmed, desiredDate: date, comment: comment.trim().slice(0, COMMENT_LIMIT) || null,
      });
      invalidate(k("relocation"), k("alerts"));
      setSent(request);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setProblem(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const list = relocations.data ?? [];
  const open = list.find(isOpenRelocation);
  const [ey, em, ed] = dates.earliest.split("-").map(Number);
  const earliestText = fullDate(fromBelgrade(ey!, em!, ed!, 12), l);

  let main;
  if (sent) main = <Sent request={sent} />;
  else if (relocations.data === undefined) {
    main = relocations.error
      ? <Card><ErrorState message={errorMessage(relocations.error)} onRetry={relocations.reload} /></Card>
      : <Skeleton height={420} radius={28} />;
  } else if (open) {
    main = (
      <div class="stack">
        <Banner tone="info" icon="info" title={t("Prijava selidbe je već poslata.")}
          text={t("Javićemo se u roku od 72 h da dogovorimo termin.")} testId="relocation-open" />
        <RelocationRequestCard request={open} />
      </div>
    );
  } else {
    main = (
      <form class="card card--block form" noValidate data-testid="relocation-form" onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}>
        <p class="card__sub">
          {t("Prenos kompleta na novu adresu uključen je u pretplatu. Proverićemo da li nova garaža može da ga primi i dogovorićemo termin.")}
        </p>
        <TextField label={t("Nova adresa")} value={address} onValue={(v) => {
          setAddress(v.slice(0, ADDRESS_MAX));
          setProblem(null);
        }} placeholder={t("Ulica i broj, grad, garaža")} autoComplete="street-address" maxLength={ADDRESS_MAX}
          testId="relocation-address" />
        <Field label={t("Željeni datum")} hint={t("Najranije %@.", earliestText)}>
          {({ id, describedBy }) => (
            <input id={id} type="date" class="input input--date" value={date} min={dates.earliest} max={dates.latest}
              aria-describedby={describedBy} required
              onInput={(e) => {
                setDate((e.currentTarget as HTMLInputElement).value);
                setProblem(null);
              }} data-testid="relocation-date" />
          )}
        </Field>
        <TextArea label={t("Komentar (nije obavezno)")} value={comment} onValue={(v) => setComment(v.slice(0, COMMENT_LIMIT))}
          maxLength={COMMENT_LIMIT} placeholder={t("Sprat garaže, pristup, kome da se javimo…")} testId="relocation-comment" />
        {problem ? (
          <div class="inline-error" role="alert" data-testid="form-error"><Icon name="circleAlert" /><span>{problem}</span></div>
        ) : null}
        <Button type="submit" block loading={busy} icon="send" testId="relocation-send">{t("Pošalji")}</Button>
        <p class="note"><Icon name="clock" /><span>{t("Javićemo se u roku od 72 h da dogovorimo termin.")}</span></p>
      </form>
    );
  }

  const past = list.filter((r) => r.id !== open?.id && r.id !== sent?.id);
  return (
    <Page title={t("Selim se")} subtitle={t("Prenosimo komplet na novu adresu. Javićemo se u roku od 72 h.")} back="/profil"
      backLabel={t("Profil")} testId="selim-se">
      <div class="two-col two-col--form">
        {main}
        {past.length > 0 ? (
          <section aria-labelledby="moves-title" class="stack">
            <h2 class="section-title" id="moves-title">{t("Ranije selidbe")}</h2>
            {past.map((r) => <RelocationRequestCard key={r.id} request={r} />)}
          </section>
        ) : null}
      </div>
    </Page>
  );
}
