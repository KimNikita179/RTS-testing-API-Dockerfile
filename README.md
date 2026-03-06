# RTC testing API (FastAPI + Playwright + Docker)

Сервис принимает JSON-описание теста (как в `jsonInput/`), запускает прогон и отдаёт **статус/результаты** по уникальной ссылке. Скриншоты сохраняются в этом же проекте и доступны по URL из результатов.

Подробное описание формата входных данных: `docs/FORMAT.md`.

## Эндпоинты

- **POST** ` /runs `
  - принимает JSON suite (как `jsonInput/fullExample.json`) **или** одиночный test (как `jsonInput/uiExample.json` / `jsonInput/apiExample.json`)
  - возвращает `runId` и ссылки на результаты
- **GET** ` /runs/{runId} `
  - пока идёт прогон: возвращает `status=queued|running` и `current` (текущий шаг)
  - после окончания: возвращает `status=completed` и `results`
- **GET** ` /artifacts/{runId}/artifacts/<file> `
  - раздача скриншотов/артефактов (ссылки приходят в `screenshotUrl`)

## Быстрый старт

1) Установить зависимости:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
python -m playwright install
```

2) Запустить API:

```bash
uvicorn app.main:app --reload --port 8000
```

Открыть Swagger: `http://localhost:8000/docs`

## Запуск через Docker

Требуется Docker Desktop (или Docker Engine + Docker Compose).

1) Собрать и запустить:

```bash
docker-compose up --build
```

2) Или отдельно — сборка и запуск:

```bash
docker build -t rtc-testing-api .
docker run -p 8000:8000 -v ./runs:/app/runs rtc-testing-api
```

3) API доступен по `http://localhost:8000`, Swagger — `http://localhost:8000/docs`

Папка `runs/` монтируется как volume, результаты прогонов сохраняются на хосте.

## Примеры запросов

### 1) Полный suite (рекомендуется)

```bash
curl -X POST "http://localhost:8000/runs" \
  -H "Content-Type: application/json" \
  --data-binary @jsonInput/fullExample.json
```

Тело запроса — **чистый текст JSON** (не multipart-файл). Сервис читает его как строку и сам парсит.

Пример ответа:

```json
{
  "runId": "2b9f7c0d-9a87-4d14-9e1d-1a1af3b2c4d5",
  "resultUrl": "http://localhost:8000/runs/2b9f7c0d-9a87-4d14-9e1d-1a1af3b2c4d5",
  "resultPath": "/runs/2b9f7c0d-9a87-4d14-9e1d-1a1af3b2c4d5",
  "artifactsBaseUrl": "http://localhost:8000/artifacts/2b9f7c0d-9a87-4d14-9e1d-1a1af3b2c4d5/artifacts/",
  "artifactsBasePath": "/artifacts/2b9f7c0d-9a87-4d14-9e1d-1a1af3b2c4d5/artifacts/"
}
```

Дальше можно опрашивать статус:

```bash
curl "http://localhost:8000/runs/<runId>"
```

Пример ответа во время выполнения:

```json
{
  "runId": "<runId>",
  "status": "running",
  "createdAt": "2026-03-05T10:00:00+00:00",
  "startedAt": "2026-03-05T10:00:01+00:00",
  "current": { "testId": "ui-login-001", "stepId": "s3", "stepIndex": 2, "testIndex": 0 },
  "suite": { "project": "RTC", "specVersion": "1.0" },
  "results": []
}
```

Пример ответа после завершения:

```json
{
  "runId": "<runId>",
  "status": "completed",
  "createdAt": "2026-03-05T10:00:00+00:00",
  "startedAt": "2026-03-05T10:00:01+00:00",
  "finishedAt": "2026-03-05T10:00:12+00:00",
  "current": null,
  "suite": { "project": "RTC", "specVersion": "1.0" },
  "results": [
    {
      "id": "ui-login-001",
      "name": "Login works",
      "type": "ui",
      "ok": true,
      "steps": [
        {
          "id": "s1",
          "action": "navigate",
          "ok": true,
          "startedAt": "2026-03-05T10:00:01+00:00",
          "finishedAt": "2026-03-05T10:00:02+00:00",
          "error": null,
          "screenshotUrl": null,
          "savedAs": null
        }
      ]
    }
  ]
}
```

### 2) Один тест (uiExample/apiExample)

Т.к. в одиночном тесте нет `defaults.baseUrl`, нужно передать `baseUrl` query-параметром:

```bash
curl -X POST "http://localhost:8000/runs?baseUrl=https://example.com" \
  -H "Content-Type: application/json" \
  --data-binary @jsonInput/uiExample.json
```

## Хранилище результатов

Для каждого запуска создаётся папка:

`runs/<runId>/`
- `request.json` — исходный JSON, который прислали
- `run.json` — текущее состояние/результаты
- `artifacts/` — скриншоты и прочие файлы (если есть)

## Правила и ограничения текущей версии

- **Фоновый запуск**: после `POST /runs` тест стартует в фоне, а `GET /runs/{runId}` можно опрашивать.
- **Параллельность**: прогоны запускаются независимо (по одному asyncio task на run).
- **Скриншоты на ошибке UI-шага**: если UI-шаг упал, сервис пытается автоматически снять fullPage screenshot и положить ссылку в `screenshotUrl`.
- **Подстановка `${var}`**: применяется к строковым полям (включая `value` и `expect.*`), переменные берутся из `suite.variables` и из результатов `saveAs`.
- **Suite vs одиночный test**: для одиночного test обязателен `baseUrl` через `?baseUrl=...`.
- **UI**: поддерживаются действия/ожидания, описанные в `docs/FORMAT.md`.
- **API**: поддерживаются `request`, `assert` (status/jsonPathEquals), `extract`.

## Архитектура проекта

- **`app/main.py`**: FastAPI-приложение, HTTP-эндпоинты, запуск фоновых задач.
- **`app/runner.py`**: реализация раннера, который исполняет шаги UI (Playwright) и API (`httpx`), формирует результаты.
- **`app/models.py`**: Pydantic-модели формата спецификации и результата прогона.
- **`app/storage.py`**: файловое хранилище `runs/<runId>/...`.
- **`app/utils.py`**: вспомогательные функции (`${var}`-подстановки, нормализация URL).
- **`docs/FORMAT.md`**: подробная спецификация входного JSON (suite, test, step, expect и т.д.).
- **`jsonInput/`**: примеры спецификаций (структура, шаги, UI и API тесты).

### Жизненный цикл прогона

1. Клиент отправляет **POST** ` /runs ` с телом — текстом JSON (suite или одиночный test).
2. Сервис:
   - парсит текст в JSON;
   - валидирует против `SuiteSpec` / `TestSpec` (Pydantic);
   - создаёт `runId`, папку `runs/<runId>/`;
   - сохраняет исходный JSON в `runs/<runId>/request.json`;
   - создаёт начальный `run.json` со статусом `queued`;
   - запускает фоновую задачу `run_suite(runId, suite)` (asyncio task).
3. Раннер:
   - последовательно выполняет тесты и шаги;
   - после каждого шага обновляет `runs/<runId>/run.json` (статус, текущий шаг, результаты шагов);
   - сохраняет скриншоты и другие артефакты в `runs/<runId>/artifacts/`;
   - по завершении прогона проставляет `status=completed` или `failed`.
4. Клиент опрашивает **GET** ` /runs/{runId} ` и видит:
   - статус (`queued` / `running` / `completed` / `failed`);
   - текущий шаг (`current`) во время выполнения;
   - конечные результаты (`results`) после завершения.
5. Скриншоты доступны по ссылкам из `screenshotUrl` в шагах результата.

## Кратко о формате входного JSON

Полная спецификация — в `docs/FORMAT.md`. Ниже — выжимка.

- **Suite**:
  - `project`: строка;
  - `defaults.baseUrl`: базовый URL;
  - `defaults.timeoutsMs.step` / `navigation`;
  - `defaults.ui.browser`: `chromium|firefox|webkit`;
  - `defaults.ui.viewport`: `{ "width": 1280, "height": 720 }`;
  - `variables`: словарь переменных для `${var}`-подстановок;
  - `tests[]`: список тестов.
- **Test**:
  - `id`, `name`, `type` (`ui`/`api`);
  - `startUrl` (для UI);
  - `steps[]`: шаги.
- **Step**:
  - `id`, `action`, `target?`, `value?`, `expect?`, `saveAs?`, `timeoutMs?`, `continueOnFail`.
- **`action` UI**: `navigate`, `click`, `fill`, `press`, `select`, `waitFor`, `scrollIntoView`, `hover`, `screenshot`, `assert`, `setVar`.
- **`action` API**: `request`, `assert`, `setVar`, `extract`.
- **`expect`**:
  - UI: `urlContains`, `locator` (`visible`, `hidden`, `exists`, `notExists`, `enabled`, `disabled`, `textEquals`, `textContains`, `attrEquals`).
  - API: `status`, `jsonPathEquals`.

## Подробные примеры



### UI-тест для `https://saratovvodokanal.ru` со скриншотами

```json
{
  "project": "RTC",
  "defaults": {
    "baseUrl": "https://saratovvodokanal.ru",
    "timeoutsMs": {
      "step": 15000,
      "navigation": 30000
    },
    "ui": {
      "browser": "chromium",
      "viewport": {
        "width": 1280,
        "height": 720
      }
    }
  },
  "variables": {},
  "tests": [
    {
      "id": "ui-debt-link-001",
      "name": "Переход на страницу 'Узнать задолженность' со скриншотами",
      "type": "ui",
      "startUrl": "/",
      "steps": [
        {
          "id": "s0",
          "action": "screenshot"
        },
        {
          "id": "s1",
          "action": "click",
          "target": {
            "using": "css",
            "value": "a.header_btn.fs18[href='/abonentam/uznat-zadolzhennost/']"
          }
        },
        {
          "id": "s2",
          "action": "screenshot"
        },
        {
          "id": "s3",
          "action": "assert",
          "expect": {
            "kind": "urlContains",
            "value": "/abonentam/uznat-zadolzhennost/"
          }
        }
      ]
    }
  ]
}
```



## Типичные ошибки и отладка

- **`400 Invalid JSON body`**:
  - тело запроса невалидный JSON;
  - или корневой элемент — не объект.
  - Проверьте, что отправляете **сырое JSON-тело** (не формат form-data).

- **`422 Unprocessable Entity` при `POST /runs`**:
  - структура JSON не соответствует ожидаемой:
    - либо вы отправили что-то, что не похоже ни на suite (нет `defaults`), ни на test (нет `steps`/`type`);
    - либо поля имеют неверные типы.
  - Смотрите точное описание ошибок в теле ответа и `docs/FORMAT.md`.

- **Падения шагов UI (ошибка в шаге)**:
  - `ok: false` в шаге, `error` содержит текст исключения;
  - если это UI-assert или действие, раннер пытается сделать auto-screenshot:
    - смотрите `screenshotUrl` в этом шаге;
    - откройте URL в браузере, чтобы увидеть состояние страницы в момент ошибки.

- **Проблемы с локаторами (`strict mode violation`, не найден элемент)**:
  - `strict mode violation` означает, что локатор неоднозначен (нашлось несколько элементов);
  - используйте более точный `css`/`xpath` или `testId`;
  - для `using: "text"` следите, чтобы текст был уникальным на странице.

- **Ошибки API-assert**:
  - сообщение `jsonPathEquals failed` или `status assert failed` подсказывает, какое значение ожидалось и что пришло;
  - можно временно добавить шаг `screenshot` (для UI) или `setVar`/`extract` (для API), чтобы проще отлаживать данные.

## Как расширять проект

- **Новые действия UI/API**:
  - добавить новые значения `action` в `app/models.py` (документально);
  - реализовать обработку в `_run_step_ui` / `_run_step_api` в `app/runner.py`;
  - обновить `docs/FORMAT.md` и этот `README`.

- **Новые виды проверок (`expect`)**:
  - расширить разбор `kind` в `_assert_ui` / `_assert_api`;
  - описать новые `kind` и параметры в `docs/FORMAT.md`.

- **Интеграция с CI/CD**:
  - поднимать сервис через `uvicorn` в пайплайне;
  - слать JSON-тесты (suite) из CI;
  - сохранять `run.json` и артефакты как артефакты сборки.
