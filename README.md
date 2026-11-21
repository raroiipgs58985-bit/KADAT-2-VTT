# KADAT-2-VTT

KADAT 2 — разрабатываемая браузерная платформа виртуального игрового стола
(VTT) для собственной системы правил KADAT. В дальнейшем платформа должна
поддерживать совместные игровые сессии, интерактивную карту и игровые сущности.

## Статус

**Early development / tactical scene client — Phase 3A-1.**

Создан минимальный TypeScript workspace: техническая стартовая страница
клиента и сервер с `GET /health`. В общих пакетах реализован deterministic
rules kernel: характеристики, проверки, броски, инициатива, раунды и Stunned.
Поверх ядра добавлены действия, Wait, Overwatch и дистанционная атака с Dodge
до выдачи неразрешённых HitRecords. Добавлены melee action/reaction,
стойки, хваты, техники и Grapple. Добавлен protection/damage pipeline до
`finalDamage`: поля, выбор совместимой защиты, cover, BB и текущий bVN.
Добавлены source-linked последствия ранений, Injury, Bleeding/Blood, Fatigue,
Agony/Death и combat-facing stabilization.

**Phase 3A-1:** в `apps/client` работает локальная тактическая сцена: карта
20 × 20 м с сеткой и масштабом, перетаскиваемые токены, карточка персонажа,
перемещение и атака через принятый Combat Core, журнал и replay — см.
[тактическую сцену клиента](docs/tactical-scene-client.md). Realtime, сервер
боя, база данных, аутентификация и CI не подключены.

**Тактическая карта, этап 1:** редактор карты (размер до 200 × 200 клеток,
разметка пола, отмена/повтор, атомарное применение с проверкой расстановки) и
режимы «Редактор карты» / «Расстановка» / «Бой».

**Тактическая карта, этап 2:** подложка PNG/JPEG/WebP с калибровкой по двум
точкам, декорации с подписями и переносимый файл карты `*.kadat-map.json`.

**Тактическая карта, этап 3:** стены, двери, препятствия и зоны трудного
ландшафта; проверка позиции и прямого пути токена; replay v0.4 со снимком карты.

## Основные принципы

- KADAT 2 использует собственную систему правил.
- Источники механики — канонические таблицы проекта и явные решения
  пользователя. Их перечень и приоритет описаны в
  [источниках правил](docs/rules-sources.md).
- Rules Engine, Client и Server имеют отдельные обязанности. Ядро правил
  должно оставаться независимым от интерфейса, сетевого транспорта и хранения.
- Механика KADAT не заменяется правилами Dark Heresy, Only War, D&D,
  Pathfinder, Foundry или других систем. Выбор технических библиотек
  не определяет игровые правила.
- Неизвестные правила требуют уточнения; предложения не становятся
  утверждёнными решениями автоматически.
- Новый проект развивается с нуля. Использование старых реализаций как
  справочных материалов требует отдельного решения пользователя.

## Техническое направление

Утверждённое направление Phase 0.1: React + TypeScript + Vite для клиента,
Node.js LTS + Fastify для сервера и независимый Rules Engine. WebSocket layer
рассматривается как кандидат для realtime; pnpm workspace настроен.
Подробности и границы решений — в [архитектуре](docs/architecture.md).

## Структура

```text
apps/
  client/          React + TypeScript + Vite: тактическая сцена (src/game, src/ui)
  server/          Fastify bootstrap и health endpoint
packages/
  contracts/       независимые domain contracts kernel
  rules-engine/    deterministic resolvers и unit tests
docs/              документация проекта
```

У общих пакетов нет runtime зависимостей. Rules Engine использует contracts
как локальную type-only workspace зависимость, не зависит от приложений
и получает источник бросков через явный интерфейс. Сборка каждого пакета
создаёт JavaScript и объявления типов в его каталоге `dist/`.

## Окружение и установка

- Node.js **24.19.0**, установленный в рабочем окружении; линия 24 имеет
  [поддерживаемый LTS статус](https://nodejs.org/en/about/previous-releases).
  Точная версия зафиксирована в `.node-version`, поддерживаемая линия — в
  `engines.node` корневого `package.json`.
- pnpm **11.19.0**, зафиксированный в `packageManager`.
- `pnpm-lock.yaml` фиксирует зависимости. Для воспроизводимой установки:

```sh
pnpm install --frozen-lockfile
```

Если используется Corepack, команды можно запускать как `corepack pnpm ...`.

## Быстрый запуск на Windows

1. Установите [Node.js 24.19.0](https://nodejs.org/dist/v24.19.0/node-v24.19.0-x64.msi)
   (версии 25 и новее проект не поддерживает) и Git.
2. Дважды щёлкните `KADAT.cmd` в папке проекта. Файл проверит версию Node,
   установит зависимости по lockfile через Corepack (права администратора
   не нужны) и откроет тактическую сцену на http://127.0.0.1:5173.
3. Чтобы остановить, закройте окно командной строки.

## Команды из корня репозитория

| Команда             | Назначение                                               |
| ------------------- | -------------------------------------------------------- |
| `pnpm typecheck`    | Проверка типов всех четырёх workspace пакетов            |
| `pnpm lint`         | ESLint для исходников и конфигураций                     |
| `pnpm format`       | Форматирование Prettier                                  |
| `pnpm format:check` | Проверка форматирования                                  |
| `pnpm test`         | Запуск Vitest во всех workspace пакетах                  |
| `pnpm build`        | Production сборка клиента, сервера и обоих общих пакетов |
| `pnpm dev:client`   | Тактическая сцена на http://127.0.0.1:5173               |
| `pnpm dev:server`   | Локальный сервер с перезапуском при изменениях           |
| `pnpm start:server` | Запуск собранного сервера после `pnpm build`             |

Сервер по умолчанию слушает `127.0.0.1:3000`. `HOST` и `PORT` позволяют
переопределить адрес. `GET /health` возвращает `{"status":"ok"}`.

Есть технический тест health endpoint через Fastify injection и deterministic
unit tests Rules Engine. Отдельный запуск ядра:
`pnpm --filter @kadat/rules-engine test`. Отсутствие тестов в Rules Engine
больше не допускается. Клиент тестирует слой игры (`apps/client/src/game`); contracts пока
используют `--passWithNoTests`.
Typecheck Rules Engine также проверяет тесты и предварительно собирает
объявления contracts. Playwright отложен до браузерного функционала.

## Документация

- [Правила для coding agents](AGENTS.md).
- [Архитектура](docs/architecture.md).
- [Канонические источники правил](docs/rules-sources.md).
- [Границы и использование Infantry Rules Kernel](docs/infantry-combat-kernel.md).
- [Действия и дистанционные атаки Phase 2.2B-1](docs/infantry-ranged-actions.md).
- [Ближний бой и Grapple Phase 2.2B-2](docs/infantry-melee-actions.md).
- [Защита и урон Phase 2.2C-1](docs/infantry-protection-damage.md).
- [Последствия ранений Phase 2.2C-2](docs/infantry-wound-consequences.md).
- [Тактическая сцена клиента Phase 3A-1](docs/tactical-scene-client.md).
- [Назначение Architecture Decision Records](docs/adr/README.md).
