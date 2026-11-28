// Передача готового персонажа в боевую VTT KADAT 2 (тот же адрес — общий localStorage).
// Генератор только записывает досье как есть; перевод в боевой лист и подбор оружия
// и брони по Арсеналу делает VTT (apps/client, characterFromGenerator).
(function (root) {
  'use strict';
  const KEY = 'kadat.generator-outbox.v1';
  const LIMIT = 20;
  function plain(character) {
    return {
      format: 'kadat-generator-character',
      version: 1,
      exportedAt: new Date().toISOString(),
      name: character.name,
      gender: character.gender ?? null,
      race: {
        id: character.race.id ?? null,
        name: character.race.name,
        traits: [...(character.race.traits ?? [])],
      },
      world: { id: character.world.id ?? null, name: character.world.name },
      specialty: {
        id: character.specialty.id ?? null,
        name: character.specialty.name,
      },
      stats: { ...character.stats },
      skills: [...character.skills].map(([name, bonus]) => ({
        name,
        bonus: bonus ?? 0,
      })),
      talents: [...character.talents],
      wounds: character.wounds,
      equipment: [...(character.specialtyEquipment ?? [])].map(String),
      traits: [...(character.specialtyTraits ?? [])].map(String),
      rules: [...(character.specialtyRules ?? [])].map((r) =>
        typeof r === 'string' ? r : JSON.stringify(r),
      ),
    };
  }
  function read() {
    try {
      const list = JSON.parse(root.localStorage.getItem(KEY) ?? '[]');
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }
  root.KadatVttExport = {
    KEY,
    plain,
    send(character) {
      const entry = plain(character);
      const list = read().filter((e) => e && e.name !== entry.name);
      list.unshift(entry);
      root.localStorage.setItem(KEY, JSON.stringify(list.slice(0, LIMIT)));
      return entry;
    },
  };
  // «← В KADAT VTT»: go back to the VTT page the generator was opened from; the link address
  // is only a fallback (a hosted page may not live at «../»).
  if (root.document)
    root.document.addEventListener('click', (e) => {
      const link = e.target && e.target.closest && e.target.closest('#back-to-vtt');
      if (!link) return;
      const sameSite =
        root.document.referrer && new URL(root.document.referrer).origin === root.location.origin;
      if (sameSite && root.history.length > 1) {
        e.preventDefault();
        root.history.back();
      }
    });
  if (root.KadatExports)
    root.KadatExports.register('kadat-vtt', {
      download: (c) => root.KadatVttExport.send(c),
    });
})(window);
