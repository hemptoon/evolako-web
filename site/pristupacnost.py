"""/pristupacnost on www.evolako.rs — the accessibility statement (09.11.2026, owner's word «да, давай аудит и все
остальные твои пункты»; the quiet footer link was left to Claude: one small link in the legal line, nothing in the menu).

What the page says must stay true: it lists what site/a11y.py and the build really do, what is still missing, and how to
report a problem. When the audit (site/tools/a11y_check.py) finds something new, fix it or add it to «Šta još nije
gotovo». Rendered by site/content.py on the guide template, like /sabloni-za-skupstinu.
"""
SLUG = 'pristupacnost'
COVER = 10                      # site/kits/evc.py IMG/ALT: neighbours in a building entrance looking at a phone
DATE = '2026-11-09'
SITE = 'https://www.evolako.rs'


def T(sr, en, ru):
    return {'sr': sr, 'en': en, 'ru': ru}


UPDATED = T('Ažurirano: 9. novembra 2026.', 'Updated: November 9, 2026', 'Обновлено: 9 ноября 2026 г.')


def texts():
    docs = [{}, {}, {}]
    seo = [T('Pristupačnost sajta | Evolako', 'Website accessibility | Evolako', 'Доступность сайта | Evolako'),
           T('Kako se evolako.rs koristi sa čitačem ekrana, tastaturom i uvećanim tekstom, šta još nije gotovo i kako '
             'da prijaviš problem.',
             'How evolako.rs works with a screen reader, a keyboard and enlarged text, what is not done yet and how to '
             'report a problem.',
             'Как evolako.rs работает с экранным диктором, клавиатурой и увеличенным текстом, что ещё не готово и как '
             'сообщить о проблеме.'),
           T('Pristupačnost sajta — Evolako', 'Website accessibility — Evolako', 'Доступность сайта — Evolako'),
           T('Šta je urađeno da sajt može da koristi svako, šta još nije gotovo i kako da nam javiš problem.',
             'What has been done so that everyone can use the site, what is not done yet and how to tell us about a '
             'problem.',
             'Что сделано, чтобы сайтом мог пользоваться каждый, что ещё не готово и как сообщить нам о проблеме.')]
    hero = [T('Pristupačnost', 'Accessibility', 'Доступность'),
            T('Pristupačnost sajta evolako.rs', 'Accessibility of evolako.rs', 'Доступность сайта evolako.rs'),
            T('Sajt treba da može da koristi svako: sa čitačem ekrana, samo tastaturom, sa uvećanim tekstom ili '
              'slabijim vidom. Ovde piše šta je urađeno, šta još nije gotovo i kako da nam javiš problem.',
              'Everyone should be able to use the site: with a screen reader, with a keyboard only, with enlarged text or '
              'with low vision. Here is what has been done, what is not done yet and how to tell us about a problem.',
              'Сайтом должен уметь пользоваться каждый: с экранным диктором, только с клавиатуры, с увеличенным текстом '
              'или при слабом зрении. Здесь написано, что сделано, что ещё не готово и как сообщить нам о проблеме.')]
    body = [
        ('h2', T('Šta je urađeno', 'What has been done', 'Что сделано')),
        ('ul', T(['Svaka stranica ima pravi jezik (srpski, engleski ili ruski), naslove po redu i oznaku glavnog dela '
                  'stranice, pa je čitač ekrana pravilno čita.',
                  'Prvi pritisak tastera Tab vodi na link „Preskoči na sadržaj“, a fokus tastature se vidi na svakom '
                  'linku, dugmetu i polju.',
                  'Tekst je dovoljno taman u odnosu na pozadinu, sa kontrastom koji traži WCAG 2.2 za nivo AA. Proveravamo ga '
                  'alatom axe kad menjamo sajt.',
                  'Stranica može da se uveća do 200 % i čita se na uskom ekranu bez pomeranja levo-desno.',
                  'Ako je na telefonu ili računaru uključeno smanjenje pokreta, sajt ne pokreće animacije.',
                  'Slike imaju opis za čitač ekrana, a dugmad i linkovi imaju naziv koji odgovara tekstu koji se vidi.',
                  'Ne moraš da zoveš: sve može porukom, preko forme na sajtu ili mejlom.'],
                 ['Every page has the right language (Serbian, English or Russian), headings in order and a marked main '
                  'area, so a screen reader reads it correctly.',
                  'The first press of Tab goes to a “Skip to content” link, and the keyboard focus is visible on every '
                  'link, button and field.',
                  'Text is dark enough against its background, with the contrast WCAG 2.2 requires for level AA. We '
                  'check it with the axe tool when we change the site.',
                  'Pages can be zoomed to 200% and read on a narrow screen without scrolling sideways.',
                  'If reduced motion is turned on on your phone or computer, the site doesn’t play animations.',
                  'Images have a description for screen readers, and buttons and links have a name that matches '
                  'their visible text.',
                  'You don’t have to call: everything can be done by message, through the form on the site or by '
                  'email.'],
                 ['У каждой страницы указан правильный язык (сербский, английский или русский), заголовки идут по '
                  'порядку, основная часть страницы размечена — экранный диктор читает её правильно.',
                  'Первое нажатие Tab ведёт на ссылку «Перейти к содержанию», а фокус клавиатуры виден на каждой '
                  'ссылке, кнопке и поле.',
                  'Текст достаточно тёмный относительно фона, с контрастом, которого требует WCAG 2.2 для уровня AA. '
                  'Мы проверяем его инструментом axe, когда меняем сайт.',
                  'Страницу можно увеличить до 200 % и читать на узком экране без прокрутки вбок.',
                  'Если на телефоне или компьютере включено уменьшение движения, сайт не показывает анимации.',
                  'У картинок есть описание для экранного диктора, а у кнопок и ссылок — название, совпадающее с '
                  'видимым текстом.',
                  'Звонить не обязательно: всё можно сделать сообщением — через форму на сайте или по почте.'])),
        ('h2', T('Šta još nije gotovo', 'What is not done yet', 'Что ещё не готово')),
        ('ul', T(['Karta na stranici Mapa punjača teško se koristi sa čitačem ekrana. Ako ti treba punjač u određenom '
                  'mestu, piši nam i poslaćemo ti spisak sa cenama.',
                  'PDF medija kit nije prilagođen čitačima ekrana. Isti podaci su na stranici Medija kit.'],
                 ['The map on the Charger map page is hard to use with a screen reader. If you need a charger in a '
                  'particular place, write to us and we’ll send you a list with prices.',
                  'The PDF media kit isn’t adapted for screen readers. The same information is on the Media kit page.'],
                 ['Карта на странице «Карта зарядок» неудобна с экранным диктором. Если нужна зарядка в конкретном '
                  'месте, напиши нам — пришлём список с ценами.',
                  'PDF медиакита не адаптирован для экранных дикторов. Те же данные есть на странице «Медиакит».'])),
        ('h2', T('Javi nam problem', 'Tell us about a problem', 'Сообщи нам о проблеме')),
        ('p', T('Ako nešto na sajtu ne možeš da pročitaš ili koristiš, piši na hello@evolako.com ili preko stranice '
                'Kontakt. Navedi stranicu i uređaj ili program koji koristiš. Odgovaramo u roku od 48 sati, a ispravku '
                'objavljujemo kad je gotova.',
                'If you can’t read or use something on the site, write to hello@evolako.com or use the Contact page. '
                'Tell us the page and the device or program you use. We reply within 48 hours and publish the fix when '
                'it’s ready.',
                'Если что-то на сайте не получается прочитать или использовать, напиши на hello@evolako.com или через '
                'страницу «Контакты». Укажи страницу и устройство или программу, которой пользуешься. Отвечаем в '
                'течение 48 часов, а исправление публикуем, когда оно готово.')),
        ('h2', T('Standard', 'Which standard', 'Стандарт')),
        ('p', T('Cilj je nivo AA smernica WCAG 2.2 (Web Content Accessibility Guidelines). Ovo je naša provera, a ne '
                'potvrda nezavisne organizacije.',
                'The goal is level AA of WCAG 2.2 (Web Content Accessibility Guidelines). This is our own check, not a '
                'certificate from an independent body.',
                'Цель — уровень AA рекомендаций WCAG 2.2 (Web Content Accessibility Guidelines). Это наша собственная '
                'проверка, а не сертификат независимой организации.')),
    ]
    links = [(('Kontakt', 'Contact', 'Контакты'),
              ('Poruka preko forme, odgovor u roku od 48 sati.', 'A message through the form, a reply within 48 hours.',
               'Сообщение через форму, ответ в течение 48 часов.'), '/kontakt'),
             (('Česta pitanja', 'FAQ', 'Частые вопросы'),
              ('Paketi, ugradnja, merenje struje i pretplata.', 'Packages, installation, metering and the subscription.',
               'Пакеты, установка, учёт электроэнергии и подписка.'), '/cesta-pitanja'),
             (('Politika privatnosti', 'Privacy policy', 'Политика конфиденциальности'),
              ('Koje podatke čuvamo i zašto.', 'What data we keep and why.', 'Какие данные мы храним и зачем.'),
              '/politika-privatnosti')]
    for i, lang in enumerate(('sr', 'en', 'ru')):
        d = docs[i]
        d['seo'] = {'title': seo[0][lang], 'description': seo[1][lang], 'og_title': seo[2][lang],
                    'og_description': seo[3][lang]}
        d['hero'] = {'kicker': hero[0][lang], 'h1': hero[1][lang], 'lead': hero[2][lang], 'updated': UPDATED[lang]}
        d['sections'] = [{'type': 'article', 'id': 'tekst', 'blocks': [{k: t[lang]} for k, t in body]},
                         {'type': 'links', 'id': 'srodni', 'h2': ('Pročitaj i ovo', 'Read next', 'Читай также')[i],
                          'items': [{'title': t[i], 'text': x[i], 'href': h} for t, x, h in links]}]
    ld_names = [(hero[1]['sr'], hero[1]['en'], hero[1]['ru']), ('Početna', 'Home', 'Главная'),
                ('Pristupačnost', 'Accessibility', 'Доступность')]
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
            {'@type': 'ListItem', 'position': 2, 'name': 'Pristupačnost'}]}]}
