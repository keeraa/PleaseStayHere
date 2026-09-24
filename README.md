# PleaseStayHere MVP

Поисковик локальной аренды: Facebook groups → collector → Supabase → дедупликация → веб-интерфейс.

## Архитектура

- Facebook collector: Playwright, запускается локально.
- База: Supabase/Postgres.
- Web/API: Node.js, читает данные из Supabase.
- Интерфейс: поиск, фильтры, карточки, фото, исходный Facebook-пост.
- Дедупликация: permalink, нормализованный текст, телефон+цена+район, характеристики объекта и текстовая похожесть.

## Supabase

Проект уже подготовлен:

`https://ufzuupiyjwuhvjmmlvdn.supabase.co`

Созданы таблицы:

- `sources`
- `raw_posts`
- `listings`

RLS включён. Публичные роли `anon` и `authenticated` не имеют прямого доступа к таблицам. Collector и server используют серверный `SUPABASE_SECRET_KEY`.

SQL-схема сохранена в:

`supabase/schema.sql`

### Переменные окружения

Скопируй:

```bash
cp .env.example .env
```

В `.env`:

```env
SUPABASE_URL=https://ufzuupiyjwuhvjmmlvdn.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
PORT=4173
```

Secret key берётся в Supabase → Settings → API Keys → Secret keys.

Не добавляй `.env` или secret key в GitHub.

## Запуск

Требуется Node.js 22+.

```bash
npm install
npx playwright install chromium
npm test
```

Node можно запускать с env-файлом так:

```bash
node --env-file=.env src/cli.js stats
```

### Авторизация Facebook

Один раз:

```bash
npm run login
```

После входа сессия сохраняется только локально:

`playwright/.auth/facebook.json`

Она исключена из Git.

### Сбор объявлений

Если переменные экспортированы в shell:

```bash
npm run collect
```

Либо:

```bash
node --env-file=.env src/cli.js collect
```

Глубина:

```bash
node --env-file=.env src/cli.js collect --scrolls=25
```

Одна группа:

```bash
node --env-file=.env src/cli.js collect --source=canggu-community-housing --scrolls=20
```

### Тестовые объявления без Facebook

```bash
node --env-file=.env src/cli.js import-fixture tests/fixture-posts.json
```

### Интерфейс

```bash
node --env-file=.env src/server.js
```

Открой:

`http://localhost:4173`

## Дедупликация

Повтор связывается с оригиналом через `duplicate_of_listing_id`, но не удаляется. Поэтому можно проверять ошибки алгоритма.

Сильные сигналы:

- одинаковый Facebook permalink;
- идентичный нормализованный текст;
- телефон + почти одинаковая цена + район;
- телефон + сильно похожий текст;
- цена + район + тип + спальни + высокая похожесть текста;
- почти идентичный текст в разных группах.

UI по умолчанию скрывает дубли, но позволяет их показать.

## Facebook

Collector не использует обход CAPTCHA, stealth-механизмы или прокси-ротацию. Если Facebook требует повторный вход, нужно снова запустить `npm run login`.

Стартовые Bali-группы находятся в:

`config/sources.json`
