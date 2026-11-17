# Шаблоны справок

Каталог шаблонов модуля экспорта (`GET /api/reports/:template?object_id=&format=`).
Шаблон = файл `<id>.<ext>`; **id** — имя файла, **format** — расширение:
`.xlsx` (ExcelJS), `.docx` (docx-templates), `.html` (handlebars → Chromium PDF).

Тестовые примеры: `spravka.*` — замените их на реальные формы (id сохраните
или добавьте новые; реестр строится автоматически по файлам каталога).

## Общие данные (все форматы)

| Токен | Значение |
|---|---|
| `{{object.name}}` | наименование объекта |
| `{{object.code_ds}}` / `{{object.uin}}` / `{{object.suid_id}}` | идентификаторы из выгрузки СУИД |
| `{{object.address}}` | адрес (если есть) |
| `{{generated_at}}` | дата генерации (ДД.ММ.ГГГГ ЧЧ:ММ) |
| `{{period}}` | выбранный период (`&period=` в URL; пусто = все) |
| `{{metrics_count}}` | количество метрик |

Метрики берутся из `v_metrics_unified` (победители по приоритетам источников).

## Повторяющийся блок метрик

**xlsx** — маркеры в ячейках строк (см. spravka.xlsx, строки 11–13):

```
A: {{#metrics}}
A: {{metric.key}}  B: {{metric.value}}  C: {{metric.unit}}  D: {{metric.period}}  E: {{metric.source}}
A: {{/metrics}}
```
Строки между маркерами (или сама строка, если оба маркера в ней) дублируются
на каждую метрику; стили строки-шаблона сохраняются.

**docx** (docx-templates, разделители `{{ }}`, выражения JavaScript):

```
{{FOR m IN metrics}}          ← отдельная строка таблицы
  {{$m.key}}  {{$m.value}}  {{$m.unit}}  {{$m.period}}  {{$m.source}}
{{END-FOR m}}                 ← отдельная строка таблицы
```

**html** (handlebars):

```
{{#each metrics}} {{this.key}} {{this.value}} … {{/each}}
```

## Формат вызова

```bash
curl -OJ "http://localhost:3000/api/reports/spravka?object_id=1&format=xlsx"
curl -OJ "http://localhost:3000/api/reports/spravka?object_id=1&format=pdf&period=2026-Q4"
```

Ошибки: `404` шаблон/объект не найден, `422` метрики пусты (сначала сбор),
`500` ошибка рендера.
