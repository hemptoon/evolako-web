"""Free templates for the residents' assembly on www.evolako.rs: /sabloni-za-skupstinu (deploy 4; the owner's decision
28.10.2026: the templates are free for everyone). site/content.py renders this page on the guide template like the city
pages (head, hero, cover, sections, sources, call to action, related pages).

The page chrome is in Serbian «ti», American English and Russian «ты»; the five templates themselves stay Serbian on
every language version — they are documents a building in Serbia hands in. They are marked lang="sr", translate="no" and
data-no-i18n, so neither the build's prerender nor the i18n engine translates them, and site/tools/qa_dist.py lists their
Serbian apart on the /en/ and /ru/ pages.

Framing (decision 01.10.2026): the decision is the building's; Evolako does not call or run the assembly, negotiate or
file requests with EDS/EPS; the templates are not legal advice. Texts: claude/Evolako_Sabloni_Skupstina_Drafts_2026-10-11
(project docs; published without a lawyer by the owner's decision 12.10.2026), cleaned of prices and of PDV.

Each template has «Kopiraj tekst» (the document as plain text) and «Štampaj» (only that document; print CSS below).
"""
import html as H
import re

SLUG = 'sabloni-za-skupstinu'
COVER = 11                      # site/kits/evc.py IMG/ALT: a garage plan, a tablet and coffee on a manager's desk
DATE = '2026-10-29'
SITE = 'https://www.evolako.rs'


def T(sr, en, ru):
    return {'sr': sr, 'en': en, 'ru': ru}


e = lambda s: H.escape(s, quote=False)   # noqa: E731

# ------------------------------------------------------------------------------------------------ the templates
# light markup: «## » a heading, «[ ] » a box to tick, «- » a list line, «**x**» bold, a blank line ends a paragraph;
# lines of one paragraph keep their line breaks. Fields to fill in are in [square brackets].
DOCS = [
    ('sablon-1', 'zahtev', '''**[Ime i prezime podnosioca]**
Vlasnik posebnog dela: [stan br. ___ / garažno mesto br. ___ / garažni boks br. ___]
[Adresa zgrade], [ulaz]
Telefon: [broj telefona] · E-pošta: [adresa e-pošte]

**STAMBENA ZAJEDNICA [naziv ili adresa zgrade]**
n/r upravnika / profesionalnog upravnika: [ime i prezime, odnosno naziv organizatora profesionalnog upravljanja]

**Predmet: Zahtev za zakazivanje sednice skupštine stambene zajednice i uvrštavanje tačke u dnevni red**

Poštovani/a,

ja sam vlasnik posebnog dela [oznaka posebnog dela] u zgradi na adresi [adresa zgrade]. U skladu sa Zakonom o stanovanju i održavanju zgrada podnosim inicijativu za zakazivanje sednice skupštine stambene zajednice.

Predlažem da se u dnevni red uvrsti sledeća tačka:

**Tačka [__]: Odlučivanje o davanju saglasnosti vlasniku posebnog dela [oznaka posebnog dela] za postavljanje uređaja za punjenje električnog vozila na zajedničkom delu zgrade — [tačan opis lokacije, npr. zid garaže uz garažno mesto br. __] — o trošku vlasnika tog posebnog dela, i o visini naknade za korišćenje zajedničkog dela.**

Označite jednu opciju:
[ ] Opcija A: ako je sednica skupštine već zakazana za [datum], molim da razmotrite uvrštavanje navedene tačke u njen dnevni red.
[ ] Opcija B: molim da zakažete sednicu skupštine sa navedenom tačkom dnevnog reda.

Molim Vas da me pisanim putem obavestite o danu, času i mestu održavanja sednice. Ako upravnik ne zakaže sednicu na zahtev vlasnika posebnog dela u roku od deset dana, vlasnik posebnog dela može sam da je zakaže i o tome obavezno obaveštava upravnika.

## Obrazloženje
1. Predmet. Predlažem postavljanje [utičnice za punjenje / zidne stanice za punjenje (wallbox)] nazivne snage [__ kW], sa posebnim brojilom potrošnje [vrsta brojila, npr. MID brojilo]. Uređaj bi bio postavljen na [lokacija na zajedničkom delu zgrade]. Detaljan opis je u Prilogu 1.
2. Troškove snosi podnosilac. Nabavku, ugradnju, priključenje, održavanje i eventualno uklanjanje uređaja plaća podnosilac zahteva. Potrošnja električne energije meri se posebnim brojilom i obračunava se [način obračuna]. Način priključenja određuje ovlašćeni električar i opisan je u Prilogu 1.
3. Izvođenje radova. Radove izvodi [naziv izvođača], a električne radove obavlja ovlašćeni električar. Podnosilac se obavezuje da o terminu radova obavesti upravnika najmanje [__] dana unapred.
4. Nadležnost skupštine. Prema članu 42. stav 1. tačka 16. Zakona o stanovanju i održavanju zgrada, skupština odlučuje o postavljanju, odnosno ugradnji stvari na zajedničkim delovima zgrade i o visini naknade koju plaćaju vlasnici tih stvari; o tome se odlučuje običnom većinom. Ako bi odluka podrazumevala raspolaganje zajedničkim delom zgrade, a prema tumačenju Ministarstva i zakup, potrebna je većina koju čine 2/3 ukupnog broja glasova (član 44. stav 2. Zakona).

## Prilozi
1. Tehnički opis uređaja i načina priključenja
2. Predlog odluke skupštine stambene zajednice
3. [Dokaz o svojini na posebnom delu, npr. list nepokretnosti — po potrebi]

Način dostave: [lično, uz potpis o prijemu / preporučenom pošiljkom / elektronskom poštom na adresu upravnika]

U [mesto], dana [datum]

_____________________________
[Ime i prezime podnosioca], potpis

**Potvrda prijema (popunjava upravnik):**
Primljeno dana [datum] u [čas] · Potpis: ____________________'''),
    ('sablon-2', 'odluka', '''**STAMBENA ZAJEDNICA [naziv / adresa zgrade]**
Matični broj: [__________] · PIB: [__________]
[mesto], [datum]

Na osnovu člana 42. stav 1. tačka 16) i čl. 44. i 45. Zakona o stanovanju i održavanju zgrada, skupština Stambene zajednice [adresa zgrade] je na sednici održanoj [datum] donela sledeću

**ODLUKU o postavljanju punjača za električno vozilo na zajedničkom delu zgrade**

## Član 1 — Predmet odluke
Ovom odlukom skupština daje saglasnost da [ime i prezime], vlasnik posebnog dela [broj stana / garažnog mesta] (u daljem tekstu: vlasnik punjača), o svom trošku postavi jedan punjač za električno vozilo i pripadajuću instalaciju. Odluka uređuje i uslove pod kojima se to radi.

## Član 2 — Vlasnik punjača
Punjač, kablovi i merni uređaj u vlasništvu su vlasnika punjača. Stambena zajednica ne snosi troškove nabavke, ugradnje, korišćenja ni uklanjanja, osim ako ovom odlukom nije drugačije određeno: [nije drugačije određeno / opis].

## Član 3 — Mesto postavljanja
Punjač se postavlja na: [garažno mesto br. __ / zid u zajedničkoj garaži, osa __ / parking mesto na zemljištu za redovnu upotrebu zgrade].
Trasa kabla prolazi kroz: [opis zajedničkih delova kroz koje prolazi kabl, prema Prilogu 2].

Postavljanje ne sme da sužava prolaze, otežava pristup instalacijama ni ometa korišćenje drugih delova zgrade.

## Član 4 — Tehničke karakteristike
Vrsta uređaja: [pojačana utičnica / zidni punjač (wallbox)]
Najveća snaga punjenja: [__ kW], [monofazno / trofazno]
Zaštitni uređaji i način povezivanja: prema tehničkom opisu u Prilogu 2, koji izrađuje izvođač.

Snaga ne može biti povećana bez nove odluke skupštine.

## Član 5 — Priključenje na električnu mrežu
Punjač se napaja: [preko mernog mesta stana br. __ vlasnika punjača / preko mernog mesta zajedničke potrošnje zgrade].

Ako je potrebna promena odobrene snage, zahtev operatoru distributivnog sistema podnosi lice na čije ime glasi odobrenje za priključenje. Troškove snosi vlasnik punjača.

## Član 6 — Merenje potrošnje
Potrošnja električne energije punjača meri se posebnim brojilom usaglašenim sa MID direktivom, ugrađenim uz punjač.
Upravnik ili lice koje on ovlasti ima pravo uvida u stanje brojila uz prethodnu najavu od [__] dana.

## Član 7 — Plaćanje električne energije i naknade
Varijanta A — napajanje preko mernog mesta stana: električnu energiju plaća vlasnik punjača kroz svoj račun za struju. Stambena zajednica ne vodi obračun.

Varijanta B — napajanje preko mernog mesta zajedničke potrošnje: vlasnik punjača mesečno nadoknađuje stambenoj zajednici iznos dobijen kao proizvod potrošnje očitane na MID brojilu i prosečne cene kWh sa računa zajedničke potrošnje za isti period, bez ikakvog uvećanja. Upravnik dostavlja obračun do [__]. u mesecu, a rok za uplatu je [__] dana.

Naknada za korišćenje zajedničkog dela: [ne plaća se / __ RSD mesečno], na račun stambene zajednice br. [__________].

## Član 8 — Izvođenje radova
Radove izvodi ovlašćeni električar ili registrovani izvođač po izboru vlasnika punjača: [naziv izvođača].
Vlasnik punjača obaveštava upravnika o datumu radova najmanje [__] dana unapred. Posle završetka radova upravniku dostavlja izjavu izvođača o izvedenim radovima i rezultate ispitivanja instalacije.
Oštećenja zajedničkih delova nastala tokom radova vlasnik punjača otklanja o svom trošku u roku od [__] dana.

## Član 9 — Održavanje
Vlasnik punjača održava punjač, kabl i brojilo o svom trošku, u skladu sa uputstvom proizvođača. Redovne preglede obavlja ovlašćeni električar.
U hitnim slučajevima upravnik može da isključi napajanje punjača i o tome bez odlaganja obaveštava vlasnika punjača.

## Član 10 — Odgovornost za štetu
Vlasnik punjača odgovara za štetu koju punjač ili instalacija prouzrokuju zajedničkim delovima, drugim posebnim delovima ili trećim licima.
Vlasnik punjača [jeste / nije] dužan da pribavi osiguranje od odgovornosti sa pokrićem od najmanje [__] RSD i da kopiju polise dostavi upravniku.

## Član 11 — Pravo drugih vlasnika
Drugi vlasnici posebnih delova mogu zahtevati postavljanje punjača pod istim uslovima. Skupština o tome odlučuje posebnom odlukom.
Ako ukupna snaga punjača u zgradi pređe [__ kW], skupština može tražiti zajedničko tehničko rešenje (upravljanje opterećenjem).

## Član 12 — Prenos i uklanjanje
Ako vlasnik punjača otuđi poseban deo, prava i obaveze iz ove odluke prelaze na novog vlasnika ako on to pisano prihvati u roku od [__] dana. U suprotnom vlasnik punjača uklanja punjač.
Prilikom uklanjanja vlasnik punjača o svom trošku vraća zajedničke delove u prvobitno stanje.
Skupština može staviti ovu odluku van snage ako vlasnik punjača ne izvršava obaveze iz člana 7, 9 ili 10 ni posle pisane opomene sa rokom od [__] dana.

## Član 13 — Izvršenje
Za izvršenje ove odluke zadužuje se upravnik stambene zajednice. Odluka se unosi u zapisnik sa sednice i stupa na snagu danom donošenja.

**Upravnik stambene zajednice**
[ime i prezime] — potpis: ____________

## Prilog 1 — Evidencija glasanja (unosi se u zapisnik)
- Ukupan broj glasova članova skupštine: [__]
- Broj nedostupnih vlasnika (ne računaju se): [__]
- Prisutni na sednici, uključujući glasove dostavljene pisanim ili elektronskim putem: [__]
- ZA: [__] · PROTIV: [__] · UZDRŽANI: [__]
- Sednica: [redovna / ponovljena]

Potrebna većina: [obična većina glasova prisutnih, uz kvorum većine ukupnog broja glasova (čl. 44. i 45.) — za postavljanje odnosno ugradnju stvari na zajedničkim delovima i visinu naknade vlasnika tih stvari (čl. 42. st. 1. tač. 16) / 2/3 ukupnog broja glasova (čl. 44. st. 2.) — ako se odluka odnosi na raspolaganje zajedničkim delovima, uključujući zakup / većina utvrđena pravilima vlasnika, ako ih zgrada ima]

## Prilog 2 — Tehnički opis (popunjava izvođač)
Vrsta i model uređaja: [__] · Snaga: [__ kW] · Merno mesto sa kog se napaja: [__]
Trasa i dužina kabla: [__] · Zaštita: [__] · Tip i serijski broj MID brojila: [__]
Skica rasporeda: [prilog] · Izvođač, kontakt i broj licence ili registracije: [__]'''),
    ('sablon-3', 'saglasnost', '''**IZJAVA O SAGLASNOSTI VLASNIKA GARAŽE ZA UGRADNJU PUNJAČA ZA ELEKTRIČNO VOZILO**

**Vlasnik / zakupodavac:** [ime i prezime, odnosno naziv pravnog lica], JMBG / matični broj [__], adresa [__], kontakt [telefon, e-pošta]
**Zakupac:** [ime i prezime], JMBG [__], adresa [__], kontakt [telefon, e-pošta]
**Predmet zakupa:** [garaža / garažno mesto / garažni boks] br. [__], u zgradi na adresi [adresa zgrade], list nepokretnosti br. [__], KO [__]
**Osnov:** Ugovor o zakupu zaključen [datum] između gore navedenih strana (u daljem tekstu: Ugovor o zakupu).

## Član 1 — Predmet saglasnosti
Vlasnik daje saglasnost zakupcu da u predmetu zakupa, o trošku zakupca, ugradi punjač za električno vozilo sa pripadajućom instalacijom. Opis je dat u Članu 2 i Prilogu 1. Saglasnost se odnosi isključivo na radove opisane u Prilogu 1.

Saglasnost se daje u skladu sa Ugovorom o zakupu i Zakonom o obligacionim odnosima.

## Član 2 — Opis radova
Radovi obuhvataju: [punjač: tip uređaja i snaga — npr. pojačana utičnica 2,3–3,7 kW ili wallbox 11 kW], [MID brojilo za merenje potrošnje], [zaštitnu opremu prema projektu izvođača], [kablovsku trasu od mesta napajanja do mesta montaže].

Radove izvodi [naziv izvođača], a priključenje obavlja ovlašćeni električar. Planirani datum radova: [datum].

## Član 3 — Napajanje i merenje potrošnje
Punjač se napaja sa (označiti):
[ ] A) mernog mesta vlasnika, ED broj [__]
[ ] B) mernog mesta zakupca, ED broj [__]
[ ] C) zajedničkog mernog mesta zgrade — samo uz odluku skupštine stambene zajednice (Član 5)

Strane konstatuju da delovi elektroenergetske mreže u zgradi do merila, uključujući merilo, pripadaju operatoru distributivnog sistema, u skladu sa Zakonom o stanovanju i održavanju zgrada. Punjač se priključuje isključivo iza merila.

Ako je potrebno povećanje odobrene snage, zahtev operatoru distributivnog sistema podnosi [vlasnik / zakupac uz ovlašćenje vlasnika], uz dokumentaciju koju operator distributivnog sistema zatraži.

## Član 4 — Troškovi
Troškove opreme i ugradnje snosi [zakupac / vlasnik / podeljeno: __].

Potrošnja punjača obračunava se prema očitavanju MID brojila. U varijanti A zakupac plaća vlasniku utrošene kWh po ceni sa računa snabdevača za to merno mesto, bez uvećanja, do [dan] u mesecu za prethodni mesec. Obračun i dokaz o uplati čuvaju obe strane.

## Član 5 — Zajednički delovi zgrade
Ako kablovska trasa ili mesto napajanja prelazi preko zajedničkih delova zgrade, strane će pre početka radova pribaviti odluku skupštine stambene zajednice. Vlasnik posebnog dela radove na zajedničkim delovima zgrade izvodi samo po dobijenom ovlašćenju (Zakon o stanovanju i održavanju zgrada, čl. 12 st. 1 tač. 3).

O postavljanju, odnosno ugradnji stvari na zajedničkim delovima zgrade skupština odlučuje običnom većinom glasova prisutnih (čl. 42 st. 1 tač. 16). Kvorum čini većina ukupnog broja glasova, a na ponovljenoj sednici jedna trećina (čl. 44 i 45). Za raspolaganje zajedničkim delovima, a prema tumačenju Ministarstva i za njihov zakup, potrebne su dve trećine ukupnog broja glasova (čl. 44 st. 2).

Zahtev upravniku podnosi [vlasnik / zakupac].

## Član 6 — Prestanak zakupa
Po prestanku zakupa (označiti):
[ ] A) zakupac uklanja punjač i instalaciju o svom trošku i vraća predmet zakupa u prvobitno stanje u roku od [__] dana;
[ ] B) vlasnik zadržava punjač i instalaciju i zakupcu isplaćuje naknadu od [iznos] RSD, odnosno vrednost utvrđenu na sledeći način: [__];
[ ] C) vlasnik zadržava instalaciju bez naknade, a zakupac uklanja uređaj [punjač / MID brojilo].

Na pitanja koja ovaj član ne uređuje primenjuje se Zakon o obligacionim odnosima.

## Član 7 — Održavanje i odgovornost
Zakupac održava punjač u ispravnom stanju dok traje zakup. Za štetu na predmetu zakupa nastalu ugradnjom ili korišćenjem punjača odgovara [zakupac / izvođač po ugovoru sa zakupcem].

## Član 8 — Pristup
Vlasnik omogućava pristup predmetu zakupa zakupcu i izvođaču radi procene, ugradnje i servisa, uz prethodnu najavu od najmanje [__] dana.

## Član 9 — Završne odredbe
Izjava je sačinjena u [__] istovetnih primeraka, od kojih svaka strana zadržava po [__]. Izjava proizvodi dejstvo danom potpisivanja.

U [mesto], dana [datum]

Vlasnik / zakupodavac: ______________________

Zakupac: ______________________

## Prilog 1 — Tehnički opis (popunjava izvođač)
- Izvođač: [naziv, PIB, kontakt]
- Uređaj: [tip, proizvođač, model, snaga u kW, struja u A, monofazno / trofazno]
- Merenje: [MID brojilo — model, serijski broj, početno stanje]
- Mesto napajanja: [razvodni orman / merno mesto — opis]
- Kablovska trasa: [dužina u m, način polaganja, da li prelazi preko zajedničkih delova: da / ne]
- Zaštita: [prema projektu izvođača]
- Procenjeno trajanje radova: [__]
- Ovlašćeni električar: [ime i prezime, broj licence]
- Skica ili fotografija mesta montaže: [prilog]'''),
    ('sablon-4', 'odgovori', '''**STAMBENA ZAJEDNICA [naziv i adresa zgrade]**
**Prilog uz tačku [broj] dnevnog reda sednice skupštine zakazane za [datum]**

**Predmet:** Odgovori na pitanja vlasnika posebnih delova o ugradnji priključnog mesta za punjenje električnog vozila na garažnom mestu [broj]

**Podnosilac:** [ime i prezime], vlasnik posebnog dela [stan broj / garažno mesto broj]
**Kontakt:** [telefon ili e-pošta]

Poštovani vlasnici posebnih delova,

u nastavku su odgovori na pitanja postavljena pre sednice. Tehnički podaci u odeljcima 3 i 4 preuzeti su iz procene izvođača od [datum procene].

## 1. Šta se predlaže
Predlaže se ugradnja [pojačane utičnice / zidnog punjača] snage [x] kW na garažnom mestu [broj]. Prema Zakonu o stanovanju i održavanju zgrada, poseban deo zgrade je posebna funkcionalna celina u zgradi koja može da predstavlja stan, poslovni prostor, garažu, garažno mesto ili garažni boks.

Garažno mesto [broj] [upisano je kao poseban deo zgrade / koristi se po drugom osnovu: (navesti osnov)].

Kabl se vodi od [mesto napajanja: stanska tabla / razvodni orman] do garažnog mesta, preko sledećih zajedničkih delova: [opis trase].

## 2. Ko plaća struju
Troškove opreme, ugradnje i održavanja u celosti snosi podnosilac. Za struju važi jedna od sledeće dve varijante (označiti):

[ ] Varijanta A — napajanje sa brojila stana [broj]. Potrošnja se obračunava na računu podnosioca. Stambena zajednica nema trošak za struju.
[ ] Varijanta B — napajanje iz zajedničke instalacije. Potrošnju meri posebno MID brojilo. Upravnik ga očitava [dana u mesecu]. Podnosilac stambenoj zajednici nadoknađuje izmereni iznos po ceni sa računa za zajedničku potrošnju, bez uvećanja. Nadoknada se evidentira na sledeći način: [način evidentiranja, prema uputstvu upravnika].

Napomena uz varijantu B: računi za domaćinstva rade po zonama — zelena zona do 350 kWh mesečno, plava od 351 do 1200 kWh i crvena preko 1200 kWh — a i struja potrošena u nižoj tarifi računa se u ukupnu mesečnu potrošnju po kojoj se određuje zona. Zato se u obračunu koristi [prosečna cena kWh sa računa / druga metoda].

## 3. Bezbednost
Radove izvodi ovlašćeni električar: [ime i prezime / naziv firme, broj licence]. Priključno mesto dobija zaseban strujni krug sa sopstvenom zaštitom.

Predviđena je zaštita uređajem diferencijalne struje. Po standardu SRPS IEC 60364-4-41, dopunska zaštita se obezbeđuje zaštitnim uređajem diferencijalne struje (RCD) sa naznačenom diferencijalnom strujom delovanja koja ne prelazi 30 mA. Tip uređaja određuje izvođač prema uputstvu proizvođača odabrane opreme: [tip].

Za električni deo instalacije za punjenje važe opšti propisi i standardi, među kojima su SRPS HD 60364-7-722 (strujna kola namenjena napajanju električnih vozila) i SRPS EN IEC 61851-1 (oprema za napajanje električnih vozila).

Po završetku radova izvođač upravniku predaje izveštaj o ispitivanju instalacije broj [broj].

## 4. Opterećenje instalacije
Snaga koju jedan priključak sme da koristi zove se odobrena snaga i iskazana je na računu za struju. Odobrena snaga za brojilo [broj]: [x] kW.

Predviđena snaga punjenja je [x] kW. Za orijentaciju: pri 230 V i 10 A snaga je 2,3 kW. Izvođač je u proceni utvrdio sledeće: [nalaz o rezervi snage].

Ako potrošnja pređe odobrenu snagu, nastaje prekomerna snaga. Odobrena snaga se može smanjiti ili povećati (ako za to postoje tehničke mogućnosti) podnošenjem zahteva u distribuciji na teritoriji gde se merno mesto nalazi.

Ako je povećanje potrebno, zahtev distribuciji podnosi [podnosilac / upravnik za zajedničko brojilo]. Punjenje je podešeno na [vremenski raspored / ograničenje snage].

## 5. Ko odgovara
**Podnosilac.** Po Zakonu o stanovanju i održavanju zgrada (član 14 stav 1 tačka 1), vlasnik posebnog dela svoj poseban, odnosno samostalni deo zgrade održava u stanju kojim se ne otežava, ne onemogućava i ne remeti uobičajena upotreba ostalih delova zgrade. Podnosilac snosi troškove održavanja priključnog mesta. Ako proda posebni deo ili odustane od korišćenja, o svom trošku uklanja opremu i vraća zajednički deo u prethodno stanje.

**Stambena zajednica.** Prema Zakonu o stanovanju i održavanju zgrada, stambena zajednica odgovara za štetu koja proistekne usled neizvršenja ili nepravilnog izvršenja poslova koji su u njenoj nadležnosti. Ako se ne može utvrditi odakle šteta potiče, zajedno sa stambenom zajednicom za štetu odgovaraju solidarno i svi vlasnici posebnih, odnosno samostalnih delova.

**Osiguranje.** Stambena zajednica može da zaključi ugovor o osiguranju od odgovornosti za štete pričinjene trećim licima usled neodržavanja ili nepravilnog održavanja zgrade. Podnosilac prilaže polisu [broj polise / „nema polise“]. Pokriće opreme za punjenje: [da / ne / prema potvrdi osiguravača].

**Izvođač.** Rokovi i obim odgovornosti izvođača utvrđeni su ugovorom broj [broj] od [datum].

## 6. Na osnovu čega skupština odlučuje
Odredbe navedene u ovom dokumentu odnose se na Zakon o stanovanju i održavanju zgrada („Sl. glasnik RS“, br. 104/2016 i 9/2020 - dr. zakon). Pre sednice proverite da li je zakon u međuvremenu menjan.

Po članu 42 stav 1 tačka 16 skupština donosi odluku o postavljanju, odnosno ugradnji stvari na zajedničkim delovima zgrade i zemljištu koje služi za redovnu upotrebu zgrade i o visini naknade koju plaćaju vlasnici tih stvari. Predložena naknada: [iznos u RSD mesečno / „bez naknade“].

Vlasnik posebnog dela ima jedan glas u skupštini stambene zajednice. Skupština donosi odluke običnom većinom glasova prisutnih članova koji imaju pravo glasa po određenom pitanju (članovi 44 i 45); o postavljanju stvari na zajedničkim delovima i visini naknade odlučuje se običnom većinom, što navode i odgovori Ministarstva. Za odluke o raspolaganju zajedničkim delovima zgrade, a prema Ministarstvu i za njihov zakup, potrebna je većina od 2/3 ukupnog broja glasova (član 44 stav 2).

Ako je zgrada donela pravila vlasnika, proverite da li ona drugačije uređuju potrebnu većinu. Pravila vlasnika: [postoje / ne postoje].

Kvorum za održavanje i rad sednice čini obična većina od ukupnog broja glasova članova koji imaju pravo glasa po određenom pitanju. Svaka odluka skupštine unosi se u zapisnik koji vodi upravnik, odnosno zapisničar koga imenuje upravnik.

## 7. Pitanja bez odgovora na sednici
[pitanje — ko odgovara pisanim putem — rok]

Mesto i datum: [mesto, datum]
Podnosilac: ____________________ [ime i prezime]'''),
    ('sablon-5', 'ceklista', '''## 1. Priprema pre inicijative
[ ] Utvrdite status svog mesta: garažno mesto br. [broj], upisano kao poseban deo: [da / ne]. Poseban deo zgrade može da bude stan, poslovni prostor, garaža, garažno mesto ili garažni boks; delovi koji nisu posebni ili samostalni smatraju se zajedničkim.
[ ] Zatražite od upravnika pravila vlasnika — njihov sastavni deo je evidencija posebnih i zajedničkih delova zgrade.
[ ] Proverite da li pravila vlasnika menjaju potrebnu većinu; ako je menjaju, većina se utvrđuje tim aktom.
[ ] Zatražite tehničku procenu: instalaciju i razvodni orman pregleda ovlašćeni električar. Odobrena snaga mernog mesta je snaga koju je operator distributivnog sistema odobrio; povećanje se traži zahtevom u distribuciji, ako za to postoje tehničke mogućnosti.
[ ] Pripremite tehnički opis kao prilog: lokacija, snaga uređaja [kW], način merenja [MID brojilo], trasa kabla i ko snosi troškove.

## 2. Zahtev i sazivanje sednice
[ ] Predajte pisani zahtev upravniku (šablon 1). Inicijativu za sednicu može podneti svaki vlasnik posebnog dela; ako upravnik ne zakaže sednicu u roku od deset dana, vlasnik je može sam zakazati i o tome obaveštava upravnika.
[ ] Obaveštenje o sednici istaknite najmanje tri dana pre sednice.
[ ] Proverite sadržinu obaveštenja: dan, čas i mesto sednice, predloženi dnevni red i način odlučivanja.
[ ] Uz obaveštenje priložite predlog odluke (šablon 2) i tehnički opis, da vlasnici dođu na sednicu sa istim podacima.

## 3. Kvorum, glasanje i većina
[ ] Izračunajte kvorum: obična većina od ukupnog broja glasova članova koji imaju pravo glasa po tom pitanju (čl. 45); vlasnik posebnog dela ima jedan glas.
[ ] Ako nema kvoruma, zakažite ponovljenu sednicu sa istim dnevnim redom; tada kvorum čini 1/3 ukupnog broja glasova.
[ ] Omogućite glasanje van sednice: vlasnik može glasati pisanim ili elektronskim putem i tada se smatra prisutnim za kvorum (čl. 44 st. 8).
[ ] Sačuvajte punomoćja — izdaju se u pisanom obliku i čuvaju uz zapisnik.
[ ] Evidentirajte nedostupne vlasnike: vlasnik koji se tri puta uzastopno ne odazove na uredno zakazanu sednicu ne računa se u kvorum ni u ukupan broj glasova.
[ ] Utvrdite potrebnu većinu pre glasanja: o postavljanju stvari na zajedničkim delovima i visini naknade odlučuje se običnom većinom (čl. 42 st. 1 tač. 16); ako odluka znači raspolaganje zajedničkim delovima, a prema Ministarstvu i njihov zakup, potrebne su 2/3 ukupnog broja glasova (čl. 44 st. 2).

## 4. Zapisnik i koraci posle odluke
[ ] Proverite zapisnik: svaka odluka skupštine unosi se u zapisnik koji vodi upravnik, odnosno zapisničar koga on imenuje.
[ ] Proverite obavezne elemente: mesto i dan sednice, ime lica koje je vodilo zapisnik i sažet prikaz rasprave po svakoj tački dnevnog reda.
[ ] Zatražite pisani izvod odluke i predajte ga izvođaču pre početka radova.
[ ] Ako je potrebna veća snaga, zahtev se podnosi operatoru distributivnog sistema; koja dokumenta se prilažu, proverite kod njega.'''),
]


def doc_html(src):
    """The light markup of a template as HTML (headings, paragraphs with line breaks, lists, boxes to tick)."""
    out, para, items = [], [], []

    def inline(s):
        s = e(s)
        return re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', s)

    def flush():
        if para:
            out.append('<p>%s</p>' % '<br/>'.join(inline(x) for x in para))
            para.clear()
        if items:
            out.append('<ul>%s</ul>' % ''.join(items))
            items.clear()
    for line in src.split('\n'):
        s = line.rstrip()
        if not s:
            flush()
        elif s.startswith('## '):
            flush()
            out.append('<h3>%s</h3>' % inline(s[3:]))
        elif s.startswith('[ ] '):
            if para:
                out.append('<p>%s</p>' % '<br/>'.join(inline(x) for x in para))
                para.clear()
            items.append('<li class="evs-cb">☐ %s</li>' % inline(s[4:]))
        elif s.startswith('- '):
            if para:
                out.append('<p>%s</p>' % '<br/>'.join(inline(x) for x in para))
                para.clear()
            items.append('<li>– %s</li>' % inline(s[2:]))
        else:
            if items:
                out.append('<ul>%s</ul>' % ''.join(items))
                items.clear()
            para.append(s)
    flush()
    return ''.join(out)


# ------------------------------------------------------------------------------------------------ page texts
UPDATED = T('Ažurirano: 29. oktobra 2026.', 'Updated: October 29, 2026', 'Обновлено: 29 октября 2026 г.')
BTN_COPY = T('Kopiraj tekst', 'Copy text', 'Скопировать текст')
BTN_PRINT = T('Štampaj', 'Print', 'Распечатать')
COPIED = T('Kopirano ✓', 'Copied ✓', 'Скопировано ✓')
HEADS = {
    'sablon-1': (T('1. Zahtev upravniku: sednica i tačka dnevnog reda',
                   '1. Request to the building manager: a meeting and the agenda item',
                   '1. Заявление управляющему: собрание и пункт повестки'),
                 T('Njime pismeno tražiš od upravnika da zakaže sednicu skupštine i na dnevni red stavi tačku o punjaču. '
                   'Uz zahtev predaj predlog odluke (šablon 2) i tehnički opis.',
                   'Use it to ask the building manager in writing to call an assembly meeting and put the charger item '
                   'on the agenda. Hand it in together with the draft decision (template 2) and the technical description.',
                   'С ним ты письменно просишь управляющего созвать собрание и включить в повестку пункт о зарядке. '
                   'Подавай его вместе с проектом решения (шаблон 2) и техническим описанием.')),
    'sablon-2': (T('2. Predlog odluke skupštine stambene zajednice', '2. Draft decision of the residents’ assembly',
                   '2. Проект решения собрания жильцов'),
                 T('Tekst o kome skupština glasa: ko postavlja punjač i gde, kako se meri i plaća struja, ko održava '
                   'opremu i šta biva kad se stan proda. Zvaničan obrazac odluke o punjačima ne postoji — ovo je predlog '
                   'teksta.',
                   'The text the assembly votes on: who installs the charger and where, how electricity is metered and '
                   'paid, who maintains the equipment and what happens when the apartment is sold. There is no official '
                   'form for a charger decision — this is a suggested text.',
                   'Текст, за который голосует собрание: кто ставит зарядку и где, как учитывается и оплачивается '
                   'электричество, кто обслуживает оборудование и что происходит при продаже квартиры. Официальной '
                   'формы решения о зарядках нет — это предлагаемый текст.')),
    'sablon-3': (T('3. Saglasnost vlasnika iznajmljene garaže', '3. Consent of the owner of a rented garage',
                   '3. Согласие владельца арендованного гаража'),
                 T('Za garažu ili mesto koje iznajmljuješ: vlasnik pismeno odobrava ugradnju, a u istom dokumentu '
                   'dogovarate struju, troškove i šta biva sa opremom kad zakup prestane.',
                   'For a garage or space you rent: the owner approves the installation in writing, and in the same '
                   'document you agree on electricity, costs and what happens to the equipment when the lease ends.',
                   'Для гаража или места, которое ты арендуешь: владелец письменно разрешает установку, а в том же '
                   'документе стороны договариваются об электричестве, расходах и о том, что будет с оборудованием '
                   'после окончания аренды.')),
    'sablon-4': (T('4. Odgovori na pitanja stanara', '4. Answers to residents’ questions', '4. Ответы на вопросы жильцов'),
                 T('Pisani odgovori na četiri pitanja koja se uvek postave: ko plaća struju, da li je punjač bezbedan, '
                   'da li instalacija može da izdrži i ko odgovara za štetu. Podeli ih komšijama pre sednice.',
                   'Written answers to the four questions that always come up: who pays for the electricity, whether the '
                   'charger is safe, whether the wiring can take it and who is liable for damage. Share them with your '
                   'neighbors before the meeting.',
                   'Письменные ответы на четыре вопроса, которые задают всегда: кто платит за электричество, безопасна ли '
                   'зарядка, выдержит ли проводка и кто отвечает за ущерб. Раздай их соседям до собрания.')),
    'sablon-5': (T('5. Čeklista: od ideje do odluke skupštine', '5. Checklist: from the idea to the assembly decision',
                   '5. Чек-лист: от идеи до решения собрания'),
                 T('Redosled koraka za vlasnika ili upravnika: priprema, zahtev, sednica, glasanje i zapisnik.',
                   'The order of steps for an owner or a building manager: preparation, the request, the meeting, the '
                   'vote and the minutes.',
                   'Порядок шагов для собственника или управляющего: подготовка, заявление, собрание, голосование и '
                   'протокол.')),
}
SRC = [('Zakon o stanovanju i održavanju zgrada — prečišćen tekst (Paragraf)',
        'https://www.paragraf.rs/propisi/zakon_o_stanovanju_i_odrzavanju_zgrada.html'),
       ('Zakon o stanovanju i održavanju zgrada — Pravno-informacioni sistem Republike Srbije',
        'https://pravno-informacioni-sistem.rs/SlGlasnikPortal/eli/rep/sgrs/skupstina/zakon/2016/104/2/reg'),
       ('Ministarstvo građevinarstva, saobraćaja i infrastrukture — Pitanja i odgovori o stanovanju',
        'https://stanovanje.gov.rs/latinica/pitanja-i-odgovori.php'),
       ('Zakon o obligacionim odnosima — prečišćen tekst (Paragraf)',
        'https://www.paragraf.rs/propisi/zakon_o_obligacionim_odnosima.html'),
       ('EPS — Osnovni pojmovi (odobrena snaga)', 'https://www.eps.rs/lat/snabdevanje/Stranice/osnovni-pojmovi.aspx')]


def texts():
    """docs [sr, en, ru] in the guide schema, plus the JSON-LD names (sr, en, ru) of the breadcrumb."""
    docs = [{}, {}, {}]
    seo = [T('Šabloni za skupštinu stanara: punjač u garaži | Evolako',
             'Residents’ assembly templates for a charger | Evolako',
             'Шаблоны для собрания жильцов: зарядка | Evolako'),
           T('Besplatni šabloni za skupštinu: zahtev upravniku, predlog odluke, saglasnost vlasnika garaže, odgovori '
             'stanarima i čeklista za punjač u garaži.',
             'Free templates for the residents’ assembly: a request to the manager, a draft decision, a garage owner’s '
             'consent, answers for residents and a checklist.',
             'Бесплатные шаблоны для собрания жильцов: заявление управляющему, проект решения, согласие владельца '
             'гаража, ответы жильцам и чек-лист.'),
           T('Besplatni šabloni za skupštinu stanara — Evolako', 'Free residents’ assembly templates — Evolako',
             'Бесплатные шаблоны для собрания жильцов — Evolako'),
           T('Zahtev upravniku, predlog odluke, saglasnost vlasnika, odgovori stanarima i čeklista — za punjač u garaži '
             'zgrade. Besplatno za sve.',
             'A request to the manager, a draft decision, an owner’s consent, answers for residents and a checklist — '
             'for a charger in a building garage. Free for everyone.',
             'Заявление управляющему, проект решения, согласие владельца, ответы жильцам и чек-лист — для зарядки в '
             'гараже дома. Бесплатно для всех.')]
    hero = [T('Besplatno za sve', 'Free for everyone', 'Бесплатно для всех'),
            T('Šabloni za skupštinu stanara: punjač za električni auto u garaži zgrade',
              'Residents’ assembly templates: an EV charger in a building garage',
              'Шаблоны для собрания жильцов: зарядка для электромобиля в гараже дома'),
            T('Pet šablona za vlasnike i upravnike: zahtev upravniku sa tačkom dnevnog reda, predlog odluke, saglasnost '
              'vlasnika iznajmljene garaže, odgovori na pitanja stanara i čeklista. Besplatni su za sve — koristi ih i ako '
              'punjač ne ugrađuje Evolako.',
              'Five templates for owners and building managers: a request to the manager with the agenda item, a draft '
              'decision, the consent of a rented garage’s owner, answers to residents’ questions and a checklist. They’re '
              'free for everyone — use them even if Evolako isn’t installing your charger.',
              'Пять шаблонов для собственников и управляющих: заявление управляющему с пунктом повестки, проект решения, '
              'согласие владельца арендованного гаража, ответы на вопросы жильцов и чек-лист. Они бесплатны для всех — '
              'пользуйся, даже если зарядку ставит не Evolako.')]
    intro = [('h2', T('Kako da koristiš šablone', 'How to use the templates', 'Как пользоваться шаблонами')),
             ('ul', T(['Popuni polja u uglastim zagradama i obriši opcije koje se ne odnose na tvoju zgradu.',
                       'Zahtev upravniku (šablon 1) predaj zajedno sa predlogom odluke (šablon 2) i tehničkim opisom kao '
                       'prilogom.',
                       'Odgovore na pitanja stanara (šablon 4) podeli komšijama pre sednice, a čeklistu (šablon 5) prati '
                       'korak po korak.',
                       'Sačuvaj kopije zahteva, obaveštenja, punomoćja i zapisnika.',
                       'Šabloni su na srpskom, latinicom — tako ih predaješ upravniku i skupštini.'],
                      ['Fill in the fields in square brackets and delete the options that don’t apply to your building.',
                       'Hand in the request to the manager (template 1) together with the draft decision (template 2) and '
                       'the technical description as an attachment.',
                       'Share the answers to residents’ questions (template 4) with your neighbors before the meeting, and '
                       'follow the checklist (template 5) step by step.',
                       'Keep copies of the request, the notice, the proxies and the minutes.',
                       'The templates are in Serbian, in the Latin script — that’s how you hand them to the manager and '
                       'the assembly.'],
                      ['Заполни поля в квадратных скобках и удали варианты, которые не подходят твоему дому.',
                       'Подай заявление управляющему (шаблон 1) вместе с проектом решения (шаблон 2) и техническим '
                       'описанием в приложении.',
                       'Ответы на вопросы жильцов (шаблон 4) раздай соседям до собрания, а по чек-листу (шаблон 5) иди шаг '
                       'за шагом.',
                       'Сохрани копии заявления, объявления, доверенностей и протокола.',
                       'Шаблоны — на сербском, латиницей: в таком виде их подают управляющему и собранию.'])),
             ('p', T('Odluku donosi skupština tvoje zgrade. Evolako ne saziva i ne vodi skupštinu, ne pregovara sa '
                     'upravnikom, komšijama ni vlasnicima i ne podnosi zahteve Elektrodistribuciji ni EPS-u. Šabloni nisu '
                     'pravni savet: prilagodi ih svojoj zgradi i pre sednice proveri važeću redakciju zakona.',
                     'The decision is for your building’s assembly to make. Evolako doesn’t call or run the assembly, '
                     'doesn’t negotiate with the manager, neighbors or owners, and doesn’t file requests with the grid '
                     'operator (EDS) or EPS. The templates are not legal advice: adapt them to your building and check '
                     'the current text of the law before the meeting.',
                     'Решение принимает собрание твоего дома. Evolako не созывает и не ведёт собрание, не ведёт '
                     'переговоров с управляющим, соседями или владельцами и не подаёт заявлений в Elektrodistribucija '
                     '(EDS) или EPS. Шаблоны — не юридическая консультация: адаптируй их под свой дом и перед собранием '
                     'проверь действующую редакцию закона.')),
             ('p', T('Tehnički opis (prilog uz zahtev i odluku) priprema izvođač. Ako punjač ugrađuje Evolako, tehnički '
                     'opis dobijaš uz ponudu, posle procene na licu mesta.',
                     'The technical description (attached to the request and the decision) is prepared by the '
                     'contractor. If Evolako installs the charger, you get the technical description with the quote, '
                     'after the on-site assessment.',
                     'Техническое описание (приложение к заявлению и решению) готовит исполнитель. Если зарядку ставит '
                     'Evolako, техническое описание ты получаешь вместе с предложением, после оценки на месте.')),
             ('h2', T('Šabloni na ovoj stranici', 'Templates on this page', 'Шаблоны на этой странице')),
             ('ul', T([[{'a': HEADS[i][0]['sr'][3:], 'href': '#' + i}] for i, _, _ in DOCS],
                      [[{'a': HEADS[i][0]['en'][3:], 'href': '#' + i}] for i, _, _ in DOCS],
                      [[{'a': HEADS[i][0]['ru'][3:], 'href': '#' + i}] for i, _, _ in DOCS]))]
    law = [('h2', T('Šta kaže Zakon o stanovanju i održavanju zgrada', 'What the Law on Housing and Building Maintenance '
                    'says', 'Что говорит Закон о жилье и содержании зданий')),
           ('ul', T(['O postavljanju, odnosno ugradnji stvari na zajedničkim delovima zgrade i o visini naknade odlučuje se '
                     'običnom većinom glasova prisutnih (čl. 42 st. 1 tač. 16).',
                     'Kvorum čini većina ukupnog broja glasova; na ponovljenoj sednici jedna trećina (čl. 44 i 45).',
                     'Za raspolaganje zajedničkim delovima, a prema odgovorima Ministarstva i za njihov zakup, potrebne su '
                     '2/3 ukupnog broja glasova (čl. 44 st. 2).',
                     'Vlasnik koji ima samo garažu ili garažno mesto glasa o odlukama koje se tiču dela zgrade sa garažom '
                     '(čl. 43 st. 3).',
                     'Ako upravnik ne zakaže sednicu na zahtev vlasnika posebnog dela u roku od deset dana, vlasnik je može '
                     'sam zakazati i o tome obaveštava upravnika.',
                     'Obaveštenje o sednici ističe se najmanje tri dana pre sednice.',
                     'Pravila vlasnika zgrade mogu drugačije urediti potrebnu većinu — proveri ih pre sednice.'],
                    ['Installing things on common parts of the building, and the fee for them, is decided by a simple '
                     'majority of the members present (Art. 42(1)(16)).',
                     'The quorum is a majority of all votes; at a repeated meeting, one third (Art. 44 and 45).',
                     'Disposing of common parts — and, per the Ministry’s answers, leasing them — needs 2/3 of all votes '
                     '(Art. 44(2)).',
                     'An owner who has only a garage or a parking space votes on decisions about the garage part of the '
                     'building (Art. 43(3)).',
                     'If the manager doesn’t call a meeting within ten days of an owner’s request, the owner can call it '
                     'and must inform the manager.',
                     'The meeting notice is posted at least three days before the meeting.',
                     'The building’s owners’ rules can set a different majority — check them before the meeting.'],
                    ['Об установке вещей на общих частях здания и о размере платы решают простым большинством '
                     'присутствующих (ст. 42 ч. 1 п. 16).',
                     'Кворум — большинство от общего числа голосов; на повторном собрании — треть (ст. 44 и 45).',
                     'Для распоряжения общими частями, а по разъяснениям министерства — и для их аренды, нужно 2/3 от '
                     'общего числа голосов (ст. 44 ч. 2).',
                     'Собственник, у которого есть только гараж или машино-место, голосует по решениям, касающимся '
                     'гаражной части здания (ст. 43 ч. 3).',
                     'Если управляющий не созовёт собрание в течение десяти дней по запросу собственника, собственник '
                     'может созвать его сам и обязан сообщить об этом управляющему.',
                     'Объявление о собрании вывешивают не менее чем за три дня.',
                     'Правила собственников дома могут устанавливать другое большинство — проверь их до собрания.']))]
    for i, lang in enumerate(('sr', 'en', 'ru')):
        d = docs[i]
        d['seo'] = {'title': seo[0][lang], 'description': seo[1][lang], 'og_title': seo[2][lang],
                    'og_description': seo[3][lang]}
        d['hero'] = {'kicker': hero[0][lang], 'h1': hero[1][lang], 'lead': hero[2][lang], 'updated': UPDATED[lang]}
        d['sections'] = [{'type': 'article', 'id': 'tekst', 'blocks': [{k: t[lang]} for k, t in intro]}]
        for sid, _, _ in DOCS:
            h2, intro_t = HEADS[sid]
            d['sections'].append({'type': 'doc', 'id': sid, 'h2': h2[lang], 'intro': intro_t[lang],
                                  'copy': BTN_COPY[lang], 'print': BTN_PRINT[lang], 'ok': COPIED[lang]})
        d['sections'].append({'type': 'article', 'id': 'zakon', 'blocks': [{k: t[lang]} for k, t in law]})
        d['sections'].append({'type': 'sources', 'id': 'izvori', 'h2': ('Izvori', 'Sources', 'Источники')[i],
                              'items': [{'title': t, 'url': u} for t, u in SRC]})
        d['sections'].append({'type': 'callout', 'id': 'cta',
                              'h2': ('Punjač u garaži zgrade', 'A charger in a building garage', 'Зарядка в гараже дома')[i],
                              'text': ('Pošalji fotografije razvodne table i mesta za punjač — okvirna procena po '
                                       'fotografijama je besplatna, a odgovaramo u roku od 48 sati.',
                                       'Send photos of the distribution board and the spot for the charger — a rough '
                                       'estimate from photos is free, and we reply within 48 hours.',
                                       'Пришли фото электрощита и места для зарядки — предварительная оценка по фото '
                                       'бесплатна, а отвечаем мы в течение 48 часов.')[i],
                              'button': {'label': ('Pošalji upit', 'Send a request', 'Отправить заявку')[i],
                                         'href': '/kontakt'}})
        d['sections'].append({'type': 'links', 'id': 'srodni', 'h2': ('Pročitaj i ovo', 'Read next', 'Читай также')[i],
                              'items': [
                                  {'title': ('Punjači za stambene zgrade', 'Chargers for apartment buildings',
                                             'Зарядки для жилых домов')[i],
                                   'text': ('Skupština, zajednička linija i obračun po mestu.',
                                            'The assembly, the shared line and billing per spot.',
                                            'Собрание, общая линия и расчёт по каждому месту.')[i],
                                   'href': '/punjaci-za-stambene-zgrade'},
                                  {'title': ('Prijavi zgradu', 'Sign up your building', 'Записать дом')[i],
                                   'text': ('Kad se prijavi pet stanara — procena garaže.',
                                            'Once five residents sign up — a garage assessment.',
                                            'Когда запишутся пять жильцов — оценка гаража.')[i],
                                   'href': '/prijavi-zgradu'},
                                  {'title': ('Paketi i cene', 'Packages and prices', 'Пакеты и цены')[i],
                                   'text': ('Svi paketi, šta je u ceni i pretplata.',
                                            'All packages, what’s included and the subscription.',
                                            'Все пакеты, что входит в цену, и подписка.')[i],
                                   'href': '/paketi-i-cene'}]})
    ld_names = [(hero[1]['sr'], hero[1]['en'], hero[1]['ru']), ('Početna', 'Home', 'Главная'),
                ('Šabloni za skupštinu', 'Assembly templates', 'Шаблоны для собрания')]
    return docs, ld_names


def jsonld(docs, same_as):
    url = SITE + '/' + SLUG
    return {'@context': 'https://schema.org', '@graph': [
        {'@type': 'Organization', '@id': SITE + '/#org', 'name': 'Evolako', 'url': SITE + '/', 'email': 'hello@evolako.com',
         'sameAs': same_as, 'areaServed': [{'@type': 'Country', 'name': 'Srbija'}], 'knowsLanguage': ['sr', 'ru', 'en']},
        {'@type': 'WebPage', '@id': url + '#webpage', 'url': url, 'name': docs[0]['hero']['h1'],
         'description': docs[0]['seo']['description'], 'inLanguage': 'sr', 'dateModified': DATE,
         'publisher': {'@id': SITE + '/#org'}},
        {'@type': 'BreadcrumbList', '@id': url + '#breadcrumb', 'itemListElement': [
            {'@type': 'ListItem', 'position': 1, 'name': 'Početna', 'item': SITE + '/'},
            {'@type': 'ListItem', 'position': 2, 'name': 'Šabloni za skupštinu'}]}]}


# ------------------------------------------------------------------------------------------------ rendering
CSS = ('<style>'
       '.evs-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:14px 0 12px}'
       '.evs-btn{font:600 15px/1 Onest,system-ui,sans-serif;border:0;border-radius:999px;padding:11px 18px;cursor:pointer;'
       'background:#2E6BFF;color:#fff}'
       '.evs-btn2{background:#E6EBF3;color:#0B1220}'
       '.evs-btn:focus-visible{outline:2px solid #2E6BFF;outline-offset:2px}'
       '.evs-ok{font:600 14px Onest,system-ui,sans-serif;color:#1a7f37}'
       '.evs-doc{background:#fff;border:1px solid rgba(11,18,32,.14);border-radius:16px;padding:22px 24px;margin:0 0 8px;'
       'color:#0B1220;font:15px/1.6 Onest,system-ui,sans-serif}'
       '.evs-doc h3{font:700 16px/1.35 Onest,system-ui,sans-serif;margin:20px 0 8px}'
       '.evs-doc h3:first-child{margin-top:0}'
       '.evs-doc p{margin:0 0 10px}'
       '.evs-doc ul{margin:0 0 10px;padding:0;list-style:none}'
       '.evs-doc li{margin:0 0 6px}'
       '@media(max-width:640px){.evs-doc{padding:16px 14px;font-size:14px}}'
       '@media print{.mega-nav,.v3-foot,#evo-ck,.evs-bar,.evb2-cvsec,#cta,#srodni{display:none!important}'
       'body{background:#fff!important}'
       '.evs-doc{border:0!important;padding:0!important;font-size:11pt}'
       '.evs-doc h3{break-after:avoid}.evs-doc li,.evs-doc p{break-inside:avoid}'
       'body[data-evs-print] *:not(:has(.evs-on)):not(.evs-on):not(.evs-on *){display:none!important}}'
       '</style>')
JS = ('<script>/* Evolako · /sabloni-za-skupstinu: «Kopiraj tekst» and «Štampaj» of each template */'
      '(function(d){function txt(x){return(x.innerText||x.textContent).replace(/\\n{3,}/g,"\\n\\n").trim()+"\\n"}'
      'function shown(b){var o=b.parentNode.querySelector(".evs-ok");if(o){o.hidden=false;'
      'setTimeout(function(){o.hidden=true},2500)}}'
      'd.addEventListener("click",function(e){var b=e.target.closest&&e.target.closest("[data-evs]");if(!b)return;'
      'var x=d.getElementById(b.getAttribute("data-doc"));if(!x)return;'
      'if(b.getAttribute("data-evs")==="print"){var on=d.querySelectorAll(".evs-on");for(var i=0;i<on.length;i++)'
      'on[i].classList.remove("evs-on");x.classList.add("evs-on");d.body.setAttribute("data-evs-print","1");'
      'var done=function(){x.classList.remove("evs-on");d.body.removeAttribute("data-evs-print");'
      'window.removeEventListener("afterprint",done)};window.addEventListener("afterprint",done);window.print();return}'
      'var t=txt(x);function fb(){var r=d.createRange();r.selectNodeContents(x);var s=window.getSelection();'
      's.removeAllRanges();s.addRange(r);try{if(d.execCommand("copy"))shown(b)}catch(err){}}'
      'if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(function(){shown(b)},fb)}'
      'else fb()})})(document);</script>')


def render_doc(p, si, s):
    """A template section: heading, what it is for, the buttons and the document (Serbian on every language)."""
    P = ['sections', si]
    sid = s['id']
    src = [x for x in DOCS if x[0] == sid][0][2]
    doc_id = 'evs-' + sid
    body = ('<h2 class="evb-ah2">%s</h2><p class="evb-ap">%s</p>'
            '<div class="evs-bar"><button type="button" class="evs-btn" data-evs="copy" data-doc="%s">%s</button>'
            '<button type="button" class="evs-btn evs-btn2" data-evs="print" data-doc="%s">%s</button>'
            '<span class="evs-ok" role="status" hidden>%s</span></div>'
            '<div id="%s" class="evs-doc" lang="sr" translate="no" data-no-i18n="">%s</div>'
            % (p.t(P + ['h2']), p.t(P + ['intro']), doc_id, p.t(P + ['copy']), doc_id, p.t(P + ['print']),
               p.t(P + ['ok']), doc_id, doc_html(src)))
    return '<section class="evb-sec-art" id="%s"><div class="w3"><div class="evb-art">%s</div></div></section>' % (sid, body)


def check_docs():
    """Errors of the templates themselves (a list): no prices of Evolako, no PDV, no promises, no paperwork wording."""
    errs = []
    for sid, _, src in DOCS:
        for rx in (r'\bPDV', r'Evolako', r'\b72\s*h', r'popust', r'\batest', r'24/7', r'\bodmah\b'):
            if re.search(rx, src, re.I):
                errs.append('%s: /%s/ in the template' % (sid, rx))
        if src.count('**') % 2:
            errs.append('%s: unbalanced **' % sid)
    return errs
