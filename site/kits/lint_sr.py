#!/usr/bin/env python3
"""Evolako Vodiči — линтер сербского текста (латиница, екавица, тон «vi»).

Проверяет: орфографию (Hunspell sr-Latn через spylls), хорватизмы и иекавицу,
штампы генерации, типографику, «пустые» абзацы, длину предложений, числа для
сверки с листом фактов. Вход: markdown или HTML (теги вырезаются).

Использование:  python3 lint_sr.py article.md [--facts facts.txt] [--json]
"""
import re, sys, json, html, argparse, collections

DICT_DIR = __file__.rsplit('/', 1)[0] if '/' in __file__ else '.'

# --- 1. Хорватизмы / иекавица / нехарактерные для сербского формы -> сербское
HR2SR = {
 # иекавица -> екавица
 'cijena':'cena','cijene':'cene','cijenu':'cenu','cijenom':'cenom','cijeni':'ceni',
 'vrijeme':'vreme','vremena':'vremena','mjesto':'mesto','mjesta':'mesta','mjesecu':'mesecu',
 'mjesec':'mesec','mjesečno':'mesečno','mjesečni':'mesečni','mjera':'mera','mjere':'mere',
 'mjeriti':'meriti','mjerenje':'merenje','mjerilo':'merilo','primjer':'primer','primjeri':'primeri',
 'primjerice':'na primer','rješenje':'rešenje','rješenja':'rešenja','riješiti':'rešiti',
 'prijedlog':'predlog','prijenos':'prenos','prijevoz':'prevoz','prijevoza':'prevoza',
 'vrijednost':'vrednost','vrijedi':'vredi','dvije':'dve','prije':'pre','poslije':'posle',
 'uvjet':'uslov','uvjeti':'uslovi','uvjeta':'uslova','savjet':'savet','savjeti':'saveti',
 'zahtjev':'zahtev','zahtjevi':'zahtevi','cijeli':'ceo','cijelu':'celu','cijelog':'celog',
 'dio':'deo','dijela':'dela','dijelovi':'delovi','dijelove':'delove','riječ':'reč','riječi':'reči',
 'svijet':'svet','svijetu':'svetu','snijeg':'sneg','lijep':'lep','lijepo':'lepo','uvijek':'uvek',
 'gdje':'gde','ovdje':'ovde','nigdje':'nigde','negdje':'negde','tjedan':'nedelja','tjedno':'nedeljno',
 'djelomično':'delimično','djelatnost':'delatnost','djelovanje':'delovanje','sljedeći':'sledeći',
 'sljedeće':'sledeće','posljednji':'poslednji','posljednje':'poslednje','vjerovatno':'verovatno',
 'vjerojatno':'verovatno','također':'takođe','tijekom':'tokom','unatoč':'uprkos','premda':'iako',
 'ljetni':'letnji','ljeto':'leto','zimske':'zimske','obitelj':'porodica','uvjeren':'uveren',
 'sigurnosni':'bezbednosni','sigurnosne':'bezbednosne','bijeli':'beli','mlijeko':'mleko',
 'ovlašten':'ovlašćen','ovlašteni':'ovlašćeni','ovlaštenog':'ovlašćenog','ovlaštenje':'ovlašćenje',
 'ovlaštenom':'ovlašćenom','ovlaštenih':'ovlašćenih',
 # лексика
 'tisuća':'hiljada','tisuće':'hiljade','tisuću':'hiljadu','točka':'tačka','točke':'tačke','točno':'tačno',
 'zrak':'vazduh','računalo':'računar','vlak':'voz','kolodvor':'stanica','tvrtka':'firma','tvrtke':'firme',
 'poduzeće':'preduzeće','sustav':'sistem','sustava':'sistema','sučelje':'interfejs','zaslon':'ekran',
 'tvornica':'fabrika','tlak':'pritisak','kat':'sprat','katu':'spratu','susjed':'komšija','susjedi':'komšije',
 'susjeda':'komšije','stubište':'stepenište','dizalo':'lift','postotak':'procenat','postotka':'procenta',
 'glazba':'muzika','povijest':'istorija','europski':'evropski','europske':'evropske','europa':'evropa',
 'općina':'opština','općine':'opštine','ured':'kancelarija','plaća':'plata','kabel':'kabl','kabela':'kabla',
 'kabelom':'kablom','kabeli':'kablovi','sklopka':'prekidač','kotač':'točak','kotači':'točkovi','doseg':'domet',
 'punionica':'stanica za punjenje','punionice':'stanice za punjenje','punionici':'stanici za punjenje',
 'pristojba':'taksa','zaposlenik':'zaposleni','djelatnik':'radnik','ljestvica':'skala','stupanj':'stepen',
 'stupnjeva':'stepeni','opseg':'obim','prometni':'saobraćajni','prometna':'saobraćajna','promet':'saobraćaj',
 'prometu':'saobraćaju','cesta':'put','ceste':'puta','cesti':'putu','autocesta':'autoput','autoceste':'autoputa',
 'kolnik':'kolovoz','osobni':'putnički','osobno':'lično','vlastiti':'sopstveni','vlastita':'sopstvena',
 'vlastite':'sopstvene','sudjelovati':'učestvovati','sudionik':'učesnik','natjecanje':'takmičenje',
 'kvaliteta':'kvalitet','kvalitete':'kvaliteta','kemija':'hemija','kirurg':'hirurg','tko':'ko','netko':'neko',
 'nitko':'niko','itko':'iko','zaklada':'fondacija','odvjetnik':'advokat','odvjetnika':'advokata',
 'siječanj':'januar','veljača':'februar','ožujak':'mart','travanj':'april','svibanj':'maj','lipanj':'jun',
 'srpanj':'jul','rujan':'septembar','listopad':'oktobar','studeni':'novembar','prosinac':'decembar',
 'siječnja':'januara','veljače':'februara','ožujka':'marta','travnja':'aprila','svibnja':'maja','lipnja':'juna',
 'srpnja':'jula','rujna':'septembra','listopada':'oktobra','studenog':'novembra','prosinca':'decembra',
 'hladnjak':'frižider','spremnik':'rezervoar','žlica':'kašika','kruh':'hleb','juha':'supa','tjedana':'nedelja',
 'sat':'sat','trenutačno':'trenutno','trenutačni':'trenutni','isključivo':'isključivo','tražilica':'pretraživač',
 'poveznica':'link','poveznicu':'link','pretinac':'sanduče','tipkovnica':'tastatura','pisač':'štampač',
 'redovito':'redovno','redoviti':'redovni','navečer':'uveče','ujutro':'ujutru','večer':'veče','tjelesni':'telesni',
 'lječnik':'lekar','liječnik':'lekar','bolnica':'bolnica','ljekarna':'apoteka','sigurno':'sigurno',
 'doma':'kod kuće',  # «doma» — разговорно/регионально; норма «kod kuće»
 'kupaonica':'kupatilo','vrt':'bašta','kino':'bioskop','kazalište':'pozorište','nogomet':'fudbal',
 'plin':'gas','plinski':'gasni','benzinska':'benzinska','crpka':'pumpa','vozačka':'vozačka',
 'mirovina':'penzija','umirovljenik':'penzioner','zajam':'kredit','čimbenik':'faktor','čimbenici':'faktori',
 'mogućnost':'mogućnost','zapravo':'zapravo','navodno':'navodno',
}
# Слова с двойным смыслом: флажок с пояснением, не автозамена
AMBIGUOUS = {
 'kolovoz':'месяц «kolovoz» = хорватский август; в сербском kolovoz = проезжая часть. Проверить смысл.',
 'što':'как вопросительное «что?» — сербское «šta»; «što» допустимо как относительное («ono što»).',
 'sat':'ок; но «sat» как «час» и «tjedan» рядом — проверить контекст.',
 'sigurnost':'сербская норма для безопасности — «bezbednost» (sigurnost = уверенность/надёжность).',
 'sigurnosni':'сербская норма — «bezbednosni».',
 'osoba':'ок в обоих; сербский чаще «lice» в правовом контексте.',
 'trenutno':'ок.',
}

# --- 2. Штампы генерации (регистронезависимо, по подстроке)
BLACKLIST = [
 'u današnjem svetu','u današnje vreme','u ovom članku','u ovom tekstu','u ovom vodiču','hajde da','zaronimo',
 'važno je napomenuti','važno je istaći','važno je naglasiti','treba napomenuti','vredi napomenuti','imajte na umu',
 'važno je imati na umu','igra ključnu ulogu','ključnu ulogu','ključna uloga','sveobuhvatan','sveobuhvatni',
 'bez sumnje','nesumnjivo','na kraju dana','zaključak','u zaključku','kao što smo videli','kao što je već pomenuto',
 'kao što je pomenuto','u svetu električnih','revoluci','od suštinskog značaja','od vitalnog značaja',
 'neophodno je naglasiti','pogledajmo','razmotrimo','istražimo','u nastavku ćemo','nadamo se da','srećno!',
 'uživajte u vožnji','besprekor','bez napora','jednostavno i lako','budućnost mobilnosti','eko-friendly',
 'prelazak na električn','putovanje ka','vaše ev putovanje','sve što treba da znate','sve što treba da znaš',
 'ultimativni','kompletan vodič','detaljan vodič','u nastavku teksta','dakle,','stoga,','na taj način',
 'u velikoj meri','značajno','izuzetno važno','veoma važno','ne zaboravite','zapamtite','naravno,',
]
# Паттерны
PATTERNS = [
 (r'\bne samo\b.{0,80}\b(već|nego) i\b', 'конструкция «ne samo … već i» — раз в статью максимум'),
 (r'\bbilo da\b.{0,60}\bili\b', 'конструкция «bilo da … ili …» — штамп'),
 (r'[\U0001F300-\U0001FAFF☀-➿]', 'эмодзи'),
 (r'!{1}', 'восклицательный знак — в вodiči не используем'),
 (r'\?\s*$', 'риторический вопрос в конце абзаца/заголовка — проверить'),
 (r'\b(\w+), (\w+) i (\w+)\b', 'тройка однородных — проверить, не декоративная ли (ок для перечисления фактов)'),
]

# --- 3. Типографика
TYPO = [
 (r'"[^"]{2,}"', 'прямые кавычки "…" — сербские „…“'),
 (r'\b\d{1,3},\d{3}\b(?!\s*(kWh|kW|A|V|%|RSD|€|EUR))', 'запятая как разделитель тысяч — в сербском точка (125.000)'),
 (r'\b\d+\.\d+\s*(kW|kWh|A|V|%)', 'десятичная точка в единицах — в сербском запятая (7,4 kW)'),
 (r'\b\d+kW\b|\b\d+kWh\b|\b\d+A\b(?![a-z])', 'нет пробела между числом и единицей (11 kW)'),
 (r'\b\d+\s?€', 'знак € перед/после — на сайте цены в RSD; евро только в скобках «(≈ 890 €)»'),
 (r'\bkwh\b|\bKWH\b|\bKwh\b', 'единица пишется kWh'),
 (r'\bEUR\b', 'на сайте евро как «€» в скобках, не EUR'),
 (r'\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b(?!\.)', 'дата цифрами — в тексте предпочтительно «1. oktobra 2025.»'),
 (r'\bti\b|\btvoj\w*\b|\btvoja\b|\btebi\b|\btebe\b', 'обращение на «ti» — сайт на «vi»'),
 (r'\bVi\b|\bVaš\w*\b(?<!\A)', 'заглавное Vi/Vaš — в сербском вежливое «vi» со строчной (кроме начала предложения)'),
 (r'\s[-]\s', 'дефис вместо тире « — »'),
 (r'\bEvolako\b', 'бренд в теле статьи — только в шаблоне/CTA/строке прозрачности'),
 (r'\bBlokVolt\b|\bblokvolt\b', 'старый бренд'),
]

WHITELIST = set('RSD kWh kW FID MID OCPP RFID EPS EDS AERS PDV MUP AMSS SRPS IEC ISO EV BEV PHEV AC DC Wh Type Typ Mennekes Tesla BYD Wallbox wallbox Webflow Evolako Zoe Leaf Ioniq Enyaq Elroq Atto Dolphin Seal Spring Supercharger app Aviloo LFP NMC SoH OBC Schuko schuko CEE granny Putevi charge GO Plugee MOL OMV NIS'.split())
STOP_SMALL = set('i u na za je su se od do sa o a ali ili da ne ni li po iz kao što šta koji koja koje kad kada ako jer pa te tu to ta taj ovo ovaj ova ono onaj ona mi vi oni one nas vas ih im ga mu joj je bi bio bila bilo biti ima nema može mogu moći će ćete ćemo neće nije nisu nisam nismo niste već još samo sve svi sva svaki svaka svako sad sada tada onda gde kako zašto koliko čemu čega'.split())

def strip_markup(t: str) -> str:
    t = re.sub(r'<script.*?</script>|<style.*?</style>', ' ', t, flags=re.S|re.I)
    t = re.sub(r'<[^>]+>', ' ', t)
    t = html.unescape(t)
    t = re.sub(r'!\[[^\]]*\]\([^)]*\)', ' ', t)          # md images
    t = re.sub(r'\[([^\]]+)\]\([^)]*\)', r'\1', t)        # md links
    t = re.sub(r'https?://\S+', ' ', t)
    t = re.sub(r'[#*_`>|]+', ' ', t)
    return t

def load_dict():
    try:
        from spylls.hunspell import Dictionary
        return Dictionary.from_files(f'{DICT_DIR}/sr-Latn')
    except Exception as e:
        print('!! словарь не загружен:', e, file=sys.stderr); return None

def lint(text: str, facts: str = '') -> dict:
    d = load_dict()
    plain = strip_markup(text)
    paras = [p.strip() for p in re.split(r'\n\s*\n', plain) if p.strip()]
    words = re.findall(r"[A-Za-zČĆĐŠŽčćđšž][A-Za-zČĆĐŠŽčćđšž'\-]*", plain)
    out = collections.OrderedDict()
    # орфография
    unknown = collections.Counter()
    if d:
        for w in words:
            lw = w.lower()
            if len(lw) < 3 or lw in STOP_SMALL: continue
            if w in WHITELIST or lw in {x.lower() for x in WHITELIST}: continue
            if w[0].isupper() and d.lookup(w): continue
            if not d.lookup(w) and not d.lookup(lw) and not d.lookup(w.capitalize()):
                unknown[w] += 1
    out['nepoznate_reci'] = [f'{w} ×{c}' for w, c in unknown.most_common()]
    # хорватизмы
    hr = []
    for w in words:
        lw = w.lower()
        if lw in HR2SR and HR2SR[lw] != lw: hr.append(f'{w} → {HR2SR[lw]}')
        if lw in AMBIGUOUS: hr.append(f'{w} ⚠ {AMBIGUOUS[lw]}')
    out['hrvatizmi_ijekavica'] = sorted(set(hr))
    # штампы
    low = plain.lower()
    bl = [f'«{b}» ×{low.count(b)}' for b in BLACKLIST if b in low]
    for pat, note in PATTERNS:
        for m in re.finditer(pat, plain, flags=re.I|re.M):
            bl.append(f'{note}: «{plain[max(0,m.start()-25):m.end()+25].strip()}»')
    out['stampovi'] = bl
    # типографика
    ty = []
    for pat, note in TYPO:
        for m in re.finditer(pat, plain):
            ty.append(f'{note}: «{plain[max(0,m.start()-20):m.end()+20].strip()}»')
    out['tipografija'] = ty
    # пустые абзацы: нет цифр, нет имён собственных (кроме начала), нет глаголов действия — грубая эвристика
    empty = []
    for p in paras:
        if len(p) < 120: continue
        has_digit = bool(re.search(r'\d', p))
        proper = len(re.findall(r'(?<![.!?]\s)(?<!^)\b[A-ZČĆĐŠŽ][a-zčćđšž]{2,}', p))
        if not has_digit and proper == 0:
            empty.append(p[:90] + '…')
    out['prazni_pasusi'] = empty
    # предложения
    sents = [s for s in re.split(r'(?<=[.!?])\s+', plain) if len(s.split()) > 2]
    lens = [len(s.split()) for s in sents]
    if lens:
        import statistics
        out['recenice'] = {'broj': len(lens), 'prosek_reci': round(statistics.mean(lens),1),
                           'std': round(statistics.pstdev(lens),1), 'najduza': max(lens),
                           'duze_od_30': sum(1 for l in lens if l > 30)}
    # числа для сверки
    nums = sorted(set(re.findall(r'\d[\d.,]*\s?(?:%|kWh|kW|mm²|A|V|RSD|€|km|mm|m|min|h|godin\w*|mesec\w*|dana)?', plain)))
    out['brojevi_za_proveru'] = nums
    if facts:
        f = facts
        missing = [n for n in nums if re.sub(r'\s','',n.split()[0]) not in re.sub(r'\s','',f)]
        out['brojevi_bez_izvora'] = missing
    out['statistika'] = {'reci': len(words), 'pasusa': len(paras), 'znakova': len(plain)}
    return out

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('file'); ap.add_argument('--facts'); ap.add_argument('--json', action='store_true')
    a = ap.parse_args()
    text = open(a.file, encoding='utf-8').read()
    facts = open(a.facts, encoding='utf-8').read() if a.facts else ''
    r = lint(text, facts)
    if a.json: print(json.dumps(r, ensure_ascii=False, indent=1))
    else:
        for k, v in r.items():
            print(f'\n## {k}')
            if isinstance(v, list):
                print('\n'.join(f' - {x}' for x in v) if v else ' (ništa)')
            else: print(' ', v)
