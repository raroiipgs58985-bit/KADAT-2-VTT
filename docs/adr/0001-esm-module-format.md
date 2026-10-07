# 0001 — ESM module format

## Status

Accepted — решение пользователя.

## Context

KADAT 2 разрабатывается как TypeScript workspace с браузерным frontend на
Vite и Node.js сервером. Пользователь утвердил ESM как постоянный основной
формат модулей. Требования совместимости с CommonJS сейчас нет.

## Decision

- ESM является основным module format проекта.
- Node packages используют ESM (`type: "module"`) и TypeScript NodeNext там,
  где это соответствует runtime.
- Frontend использует ESM через Vite с TypeScript ESNext/Bundler.
- Dual ESM/CommonJS сейчас не поддерживается.

## Consequences

Сборка Node packages и их imports/exports должны соответствовать Node ESM.
Внутренние относительные импорты собранного Node кода используют расширения
файлов, корректные для runtime. Отдельные CommonJS артефакты не создаются.
Решение может быть пересмотрено только при появлении реального требования
совместимости.
