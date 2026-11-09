# Очередь публикаций (outbox) — инструкция для плановых задач · с 09.11.2026

Для Claude. Читают все плановые задачи, которые публикуют на www.blokvolt.rs и www.evolako.rs (и письмо Evolako pismo).
Один и тот же файл лежит в `hemptoon/blokvolt-rs/docs/OUTBOX.md` и `hemptoon/evolako-web/docs/OUTBOX.md`. Код — RUNBOOK 3.39
в blokvolt-rs и `scripts/outbox.py`.

## Зачем

Сессии плановых задач не могут пушить в GitHub: git-прокси даёт им только чтение, `add_repo` там нет (27.10–08.11.2026 ни
одна задача сама не выложила). С 09.11.2026 **задача ничего не пушит**. Она готовит и проверяет материал как раньше, а
готовые файлы кладёт в очередь — таблицы D1. Каждый час GitHub Actions «Outbox» в обоих репозиториях забирает из очереди то,
у чего наступило `publish_after`, ещё раз гоняет проверки сайта, коммитит, выкладывает и пишет итог в очередь. Решение
владельца 09.11.2026: «да Давай сделаем такую схему с очередью ... и для блоквольт, и для эвалака».

`add_repo` и `git push` в плановых задачах не вызывать.

## Где очередь

Cloudflare-коннектор → `d1_database_query`, база `blokvolt`, `database_id` = `4714b7cb-6138-4ac8-ab32-0ceb80c40957` (одна
очередь на оба сайта; если инструмент отложенный — ToolSearch «select:mcp__Cloudflare_Developer_Platform__d1_database_query»).
Значения — только параметрами `?1, ?2…` (`params`), никогда не вставлять текст в SQL. Нет коннектора или запрос падает —
не публиковать, первой строкой отчёта «Не поставлено в очередь: нет доступа к D1 — <текст ошибки>», материал — в журнал
задачи («Отложено»), как раньше.

## Порядок (одна публикация = одна запись)

0. **Прошлые запуски.** `SELECT id, kind, slug, status, publish_after, commit_sha, substr(result, -400) AS r FROM outbox
   WHERE repo = ?1 AND created_by = ?2 ORDER BY id DESC LIMIT 5`. `failed` — первой строкой отчёта «Очередь: <slug> не
   вышел — <суть из r>»; причина в тексте — исправить и поставить новой записью; в коде или сборке — сообщить, не обходить.
   `published` — тема в журнале → `done` с `commit_sha`, если прошлый запуск этого не сделал.
1. **Нет дубля.** `SELECT id, status FROM outbox WHERE repo = ?1 AND slug = ?2 AND status IN ('draft','queued','taken','published')`
   — есть строка: тему не брать, взять следующую.
2. **Слот.** `SELECT max(publish_after) AS last FROM outbox WHERE repo = ?1 AND kind = ?2 AND status IN ('queued','taken','published')`.
   `publish_after` = позднее из «сейчас» и `last + интервал` (UTC, `YYYY-MM-DDTHH:MM:SSZ`; не «сейчас» — 08:30 UTC того дня).
   Интервалы: `vodic` (гайды одного сайта) — 3 дня; `b2b` — 7 дней; `vest`, `novost`, `gorivo`, `indeks`, `mesecno`,
   `sredina`, `kvartal`, `pismo`, `pregled` — сразу.
3. **Файлы готовы и проверены в контейнере** — все проверки своего конвейера пройдены, как перед коммитом. Даты в файлах —
   плейсхолдерами, чтобы стояла реальная дата выхода: `@PUBISO@` (2026-11-11), `@PUBDATE@` (11.11.2026), `@NEXT30@`
   (+30 дней, ДД.ММ.ГГГГ). Пример: `published: @PUBISO@`, `updated: @PUBDATE@`, `next_check: @NEXT30@`, `meta.json` =
   `{"date": "@PUBISO@"}`. Проверки гонять на копии с подставленной сегодняшней датой; в очередь — версия с плейсхолдерами;
   `sha256sum` — по ней.
4. **Запись:** `INSERT INTO outbox (repo, branch, kind, slug, title, publish_after, status, commit_msg, author, created_by)
   VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'draft', ?7, ?8, ?9) RETURNING id`.
   `repo`: `hemptoon/blokvolt-rs` / `hemptoon/evolako-web`; `branch`: blokvolt — `main`; сайт evolako — `site-migration`;
   Evolako pismo — `main`. `commit_msg` — по-английски, как коммит в конвейере, в конце строки атрибуции из инструкций
   сессии. `author`: `BlokVolt <hello@blokvolt.com>` / `Evolako <hello@evolako.com>`. `created_by` — имя задачи.
5. **Файлы** — по запросу на файл: `INSERT INTO outbox_files (item_id, path, op, enc, body, sha256) VALUES (?1, ?2, ?3, 'text', ?4, ?5)`.
   Тело — точное содержимое файла (из `cat`, ничего «по памяти»), длинный файл не сокращать.
6. **Сверка и запуск:** `SELECT path, op, length(body) AS n, sha256 FROM outbox_files WHERE item_id = ?1` — все файлы на
   месте, sha256 те же (`length` — в символах, не в байтах). Тогда `UPDATE outbox SET status = 'queued' WHERE id = ?1 AND
   status = 'draft'`. Ошибка на любом шаге — запись остаётся `draft` (её никто не публикует), в отчёт.
7. **Журнал задачи:** тема → `queued (outbox <id>, выйдет <дата по Белграду>)`. Следующий запуск переводит в `done` (шаг 0).

## Что и как кладётся (op)

**www.evolako.rs** (`hemptoon/evolako-web`, `site-migration`) — только `write`:
гайд жильцам `site/content/vodici/<page>/sr.json|en.json|ru.json|meta.json` (`kind` `vodic`); B2B-гайд
`site/content/b2b/<page>/…` те же 4 файла (`b2b`); новость `site/content/novosti/<id>.json` (`novost`).
Очередь гоняет `site/content.py check`, `site/build.py`, `content_selftest`, после push запускает «Site preview» (выкладка
в прод и смоук). QA (`qa_dist`) и осмотр картинок задача делает сама до постановки, как раньше.

**Evolako pismo** (`hemptoon/evolako-web`, `main`, `kind` `pismo`): запись 1 — `public/posta/<слаг>.json` +
`public/posta/index.json` (status `preview`), сразу; запись 2 — только `public/posta/index.json` (status `approved`,
`approved_hash`, `send_at`), `publish_after` = сейчас + 20 минут, slug `<слаг>-approve`. Очередь гоняет `npm test`,
запускает «Deploy».

**www.blokvolt.rs** (`hemptoon/blokvolt-rs`, `main`):
- `write` — новые и изменённые файлы в `content/**` (не `content/_drafts/`), картинки `static/assets/img/*.webp|jpg|png`
  (`enc` `base64`, только маленькие);
- `patch` — `build.py` (`VODICI_GROUPS`, `CARD_IMG`), `templates/*.html` или большой файл в `content/`: вывод
  `git diff -- <файл>` против свежего `origin/main` (применяется `git apply --3way`);
- `izmene` — одна строка списка для /izmene/, `path` = `content/podaci/izmene.md`; заголовок дня, его перевод и даты
  /izmene/ и `content/data/site.json` ставит очередь. Сами `izmene.md` и `site.json` через `write` не класть;
- `i18n-en`, `i18n-ru` (`path` = `content/i18n/en.json` / `ru.json`) — JSON для `scripts/i18n.py add`: ключи ровно как в
  `python3 scripts/i18n.py todo` после сборки с новыми файлами и новой строкой /izmene/. Сами `en.json`/`ru.json` не класть.
Очередь гоняет build, i18n todo = 0, check_links, check_images, app_layer --strict, lint_sr --all-news, gen_com, после
push запускает «Deploy» и «Site checks».

## Сроки

Обычно запись выходит в течение часа после `publish_after` (расписание GitHub иногда опаздывает на час-два). Ждать в той
же сессии не нужно: итог увидит следующий запуск (шаг 0) и утренний QA-разбор.

## Отчёт задачи

«В очереди: <заголовок> — выйдет <дата и примерное время по Белграду> (outbox <id>)». Плюс строка из шага 0, если прошлый
материал не вышел.

## Статус (основной чат, QA)

`SELECT id, repo, kind, slug, title, publish_after, status, commit_sha, done_at, substr(result, -300) FROM outbox ORDER BY id DESC LIMIT 30`.
