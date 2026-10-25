// "Obriši nalog": the button and its confirmation — the same on /profil/nalog and on the public page /obrisi-nalog.
// One request, never repeated by itself (an answer lost on the way may still mean the server did it); a problem is
// said in words and leaves the dialog open for another try.
import { useState } from "preact/hooks";
import { backendOrThrow } from "../../app/data";
import { afterAccountDeleted, isDemo } from "../../app/session";
import { errorMessage } from "../../app/texts";
import { t } from "../../i18n";
import { Button } from "../../ui/controls";
import { Icon } from "../../ui/Icon";
import { Dialog } from "../../ui/overlay";

interface DeleteAccountProps {
  /** Stay on the current page after the deletion (/obrisi-nalog says "Nalog je obrisan." itself) instead of the landing. */
  stay?: boolean;
  /** Called once the server has deleted the account, right before the session is forgotten here. */
  onDeleted?: () => void;
}

export function DeleteAccount({ stay = false, onDeleted }: DeleteAccountProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (!isDemo.value) await backendOrThrow().deleteAccount();
      setOpen(false);
      onDeleted?.();
      await afterAccountDeleted({ stay });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button variant="danger" icon="userX" block onClick={() => setOpen(true)} testId="delete-account">
        {t("Obriši nalog")}
      </Button>
      {open ? (
        <Dialog role="alertdialog" title={t("Obrisati nalog?")} onClose={() => !busy && setOpen(false)} testId="delete-dialog"
          actions={
            <>
              <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy} testId="delete-cancel">{t("Otkaži")}</Button>
              <Button variant="danger" icon="trash" loading={busy} onClick={() => void remove()} testId="delete-confirm">
                {busy ? t("Brišemo nalog…") : t("Obriši nalog")}
              </Button>
            </>
          }>
          <p>{t("Brišemo ime, kontakt, zahteve i fotografije. Obračuni ostaju samo sa imenom platioca — čuvamo ih po zakonu. Ovo ne može da se poništi.")}</p>
          {isDemo.value ? <p class="dialog__demo">{t("U demou se ništa ne briše — samo izlaziš iz demoa.")}</p> : null}
          {error ? <div class="inline-error" role="alert" data-testid="delete-error"><Icon name="circleAlert" /><span>{error}</span></div> : null}
        </Dialog>
      ) : null}
    </>
  );
}
