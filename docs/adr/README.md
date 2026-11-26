# Architecture Decision Records

ADR (Architecture Decision Records) — записи об архитектурных решениях
проекта. Они сохраняют контекст выбора и позволяют понять причины решения
при дальнейшем развитии KADAT 2.

Каждая запись должна описывать:

- контекст и проблему, требующую решения;
- статус: предложение, принятое, отклонённое или заменённое решение;
- само решение;
- рассмотренные варианты и причины выбора;
- последствия, ограничения и компромиссы.

Предложение агента не считается принятым решением. Статус записи должен
отражать фактическое решение пользователя. При пересмотре принятого решения
следует сохранять его историю и указывать связь с заменяющей записью.

Направление Phase 0.1 описано в [architecture.md](../architecture.md).

## Индекс

- [0001 — ESM module format](0001-esm-module-format.md) — Accepted.
- [0002 — Canonical Data Versioning Architecture](0002-canonical-data-versioning.md) — Accepted.
- [0003 — Client game layer and Rules Engine source bundling](0003-client-game-layer.md) — Proposed.
- [0004 — Own VTT for KADAT; reuse of external code under compatible licences](0004-own-vtt-and-code-reuse.md) — Accepted.
- [0006 — генератор персонажей в монорепо и связь с VTT](0006-character-generator-in-monorepo.md)
- [0007 — предварительный расчёт порога атаки d100](0007-attack-preview.md) — Accepted.
