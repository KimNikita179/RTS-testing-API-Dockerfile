# Формат входных данных (JSON)

Входной JSON описывает **suite** (набор тестов) или **одиночный test**. Примеры лежат в `jsonInput/`.

## 1) Suite (рекомендуемый формат)

Это объект с ключами `defaults`, `variables`, `tests`.

Минимальный каркас:

```json
{
  "specVersion": "1.0",
  "project": "RTC",
  "defaults": {
    "baseUrl": "https://example.com",
    "timeoutsMs": { "step": 15000, "navigation": 30000 },
    "ui": { "browser": "chromium", "viewport": { "width": 1280, "height": 720 } }
  },
  "variables": {},
  "tests": []
}
```

### `defaults`
- **`baseUrl`**: базовый URL (используется и для UI-навигации, и для API-запросов).
- **`timeoutsMs.step`**: таймаут на шаг (по умолчанию 15000).
- **`timeoutsMs.navigation`**: таймаут на переходы/навигацию (по умолчанию 30000).
- **`ui.browser`**: `"chromium" | "firefox" | "webkit"`.
- **`ui.viewport`**: объект `{width,height}`.

### `variables`
Словарь переменных. В строках можно использовать подстановку `${varName}`.

Пример:

```json
{ "adminUser": "admin", "adminPass": "secret" }
```

### `tests[]`
Массив тестов. Каждый test:
- **`id`**: строка-идентификатор.
- **`name`**: человекочитаемое имя.
- **`type`**: `"ui"` или `"api"`.
- **`startUrl`**: (для UI) URL, который будет открыт **до шагов**, если задан.
- **`steps[]`**: массив шагов.

## 2) Одиночный test

Можно отправить JSON теста без `defaults` (как `jsonInput/uiExample.json` / `jsonInput/apiExample.json`), но тогда нужно передать `baseUrl` query-параметром при запуске:

`POST /runs?baseUrl=https://example.com`

## 3) Step (шаг)

Общий формат шага:

```json
{
  "id": "s1",
  "action": "click",
  "target": { "using": "css", "value": "#submit" },
  "value": null,
  "expect": null,
  "saveAs": null,
  "timeoutMs": 15000,
  "continueOnFail": false
}
```

### Поля шага
- **`id`**: идентификатор шага (уникален в рамках теста).
- **`action`**: действие (см. ниже).
- **`target`**: локатор (для UI-действий, где нужен элемент).
- **`value`**: значение для действия (строка/число/объект — зависит от action).
- **`expect`**: объект ожидания для `action="assert"`.
- **`saveAs`**: имя переменной, куда сохранить результат (например, ответ API).
- **`timeoutMs`**: таймаут шага (если не задан — используется `defaults.timeoutsMs.step`).
- **`continueOnFail`**: если `true`, тест продолжится после падения шага.

## 4) Локаторы (`target`)

```json
{ "using": "css", "value": "button[type='submit']" }
```

`using` поддерживает:
- `"css"`
- `"xpath"`
- `"text"` (по видимому тексту)
- `"testId"` (data-testid)

## 5) Поддерживаемые `action`

### UI
- **`navigate`**: `value="/path"` или абсолютный URL.
- **`click`**: требует `target`.
- **`fill`**: требует `target`, `value` — текст.
- **`press`**: требует `target`, `value` — например `"Enter"`.
- **`select`**: требует `target`, `value` — option value.
- **`hover`**: требует `target`.
- **`scrollIntoView`**: требует `target`.
- **`waitFor`**:
  - если есть `target` — ждёт элемент;
  - если `value` число — ждёт миллисекунды.
- **`screenshot`**:
  - если есть `target` — скриншот элемента;
  - иначе — fullPage скриншот страницы.
- **`assert`**: проверки UI (см. `expect`).
- **`setVar`**: положить `value` в переменную `saveAs`.

### API
- **`request`**: `value` — объект запроса, например:

```json
{
  "method": "GET",
  "url": "/api/health",
  "headers": { "Accept": "application/json" }
}
```

Если задан `saveAs`, то в переменную сохраняется объект:

```json
{
  "status": 200,
  "headers": { "...": "..." },
  "text": "...",
  "json": { "...": "..." },
  "url": "https://example.com/api/health"
}
```

- **`assert`**: проверки по ответу (см. `expect`).
- **`extract`**: извлечь значение jsonPath и сохранить в `saveAs`:

```json
{
  "id": "sX",
  "action": "extract",
  "value": { "from": "${healthResp}", "path": "$.ok" },
  "saveAs": "okValue"
}
```

## 6) `expect` (для `action="assert"`)

### UI
1) Проверка URL:

```json
{ "kind": "urlContains", "value": "/dashboard" }
```

2) Проверки по локатору:

```json
{
  "kind": "locator",
  "target": { "using": "css", "value": "h1" },
  "assert": "textContains",
  "value": "Welcome"
}
```

`assert` поддерживает:
- `visible` | `hidden`
- `exists` | `notExists`
- `enabled` | `disabled`
- `textEquals` | `textContains`
- `attrEquals` (формат `value`: `{ "name": "href", "value": "/home" }`)

### API
1) Статус-код:

```json
{ "kind": "status", "from": "${healthResp}", "equals": 200 }
```

2) Сравнение значения по JSONPath:

```json
{ "kind": "jsonPathEquals", "from": "${healthResp}", "path": "$.ok", "equals": true }
```

## 7) Правила подстановки переменных

- Подстановка выполняется в строках по шаблону `${varName}`.
- Если переменной нет — строка остаётся без изменений (например `${unknown}`).
- `saveAs` кладёт значения в `variables` и их можно использовать в следующих шагах.

