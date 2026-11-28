import dataset from '../../../../packages/canonical-data/dataset/profiles-lists.json';
import type { ProfilesLists } from '../../../../packages/canonical-data/src/profiles-lists';

/** Skill and talent names of «Профили персонажей» (only to suggest names in the editor). */
export const profilesLists = dataset as unknown as ProfilesLists;
export const skillNames = profilesLists.skills.map((s) => s.name);
export const skillCharacteristic = (name: string) =>
  profilesLists.skills.find((s) => s.name.toLowerCase() === name.trim().toLowerCase())
    ?.characteristic ?? null;
/** Talents in the shape the Arsenal search takes. */
export const talentEntries = profilesLists.talents.map((t) => ({
  id: `talent-${t.row}-${t.tier}`,
  name: t.name,
  sheet: `Таланты ${t.tier} ур.${t.legacy ? ' (старый лист)' : ''}`,
  group: t.requirements || null,
  description: t.description,
}));
export type TalentEntry = (typeof talentEntries)[number];
const base = (s: string) =>
  s
    .replace(/\s*\(.*\)\s*$/, '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е');
const talentBases = new Set(profilesLists.talents.map((t) => base(t.name)));
/**
 * Whether the talent is in the talent sheets (a specialisation in brackets may differ: «Владение
 * оружием (Лаз)» is «Владение оружием»). Others are not counted in the fight.
 */
export const talentInSheets = (name: string) => talentBases.has(base(name));
export const talentSummary = (t: TalentEntry) =>
  [t.group ? `треб.: ${t.group.replace(/\s*\n\s*/g, ', ')}` : null, t.description.slice(0, 120)]
    .filter(Boolean)
    .join(' · ');
