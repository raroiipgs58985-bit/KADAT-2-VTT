/**
 * Skill and talent names from «Профили персонажей» (sheets «Навыки», «Таланты (обновлены)»),
 * read from a committed snapshot (ADR 0005). Used only to suggest names in the character
 * editor; no rule is derived from the descriptions here.
 */
export type ListCell = string | number | boolean | null;
export interface ProfilesListsSnapshot {
  readonly source: {
    readonly file: string;
    readonly sha256: string;
    readonly extracted: string;
    readonly method: string;
    readonly sheets: readonly string[];
  };
  readonly sheets: Readonly<Record<string, readonly (readonly ListCell[])[]>>;
}
export interface ProfileSkill {
  /** Name without the characteristic: «Акробатика». */
  readonly name: string;
  /** As written in brackets: «Ловкость», «Сила Воли». */
  readonly characteristic: string;
  readonly row: number;
}
export interface ProfileTalent {
  readonly name: string;
  /** Marked «†» in the sheet (taken again with another specialisation). */
  readonly marked: boolean;
  /** 1, 2 or 3 — the column group «Таланты N-ого уровня». */
  readonly tier: number;
  readonly requirements: string;
  readonly description: string;
  readonly row: number;
}
export interface ProfilesLists {
  readonly format: 'kadat-profiles-lists';
  readonly version: 1;
  readonly source: ProfilesListsSnapshot['source'];
  readonly skills: readonly ProfileSkill[];
  readonly talents: readonly ProfileTalent[];
}

const SKILLS = 'Навыки';
const TALENTS = 'Таланты (обновлены)';
/** Rows after this one in «Навыки» list professions (crafts), not combat skills. */
const LAST_SKILL_ROW = 300;
const text = (c: ListCell | undefined) => (c === null || c === undefined ? '' : String(c)).trim();

export function importProfilesLists(snapshot: ProfilesListsSnapshot): ProfilesLists {
  const skillRows = snapshot.sheets[SKILLS];
  const talentRows = snapshot.sheets[TALENTS];
  if (!skillRows || !talentRows) throw new Error('Snapshot lacks the skill or talent sheet');
  const skills: ProfileSkill[] = [];
  skillRows.forEach((row, i) => {
    const head = text(row[0]);
    // «Акробатика (Ловкость)», «Технология (ТехЮЗ, Тех Пол) (Интеллект)»: the last bracket is
    // the characteristic.
    const m = /^([А-ЯЁ][^"]*?)\s*\(([^()]+)\)\s*$/.exec(head);
    // A skill heading has a long description next to it; table rows («+30») do not.
    if (i + 1 <= LAST_SKILL_ROW && m && text(row[1]).length > 80)
      skills.push({ name: m[1]!.trim(), characteristic: m[2]!.trim(), row: i + 1 });
  });
  const talents: ProfileTalent[] = [];
  const seen = new Set<string>();
  talentRows.forEach((row, i) => {
    for (let col = 0; col < row.length; col += 4) {
      const raw = text(row[col]).replace(/\s+/g, ' ');
      const marked = /†/.test(raw);
      const name = raw.replace(/\s*†\s*/g, ' ').trim();
      const description = text(row[col + 2]);
      if (!name || !description || name === 'Талант') continue;
      const tier = col / 4 + 1;
      const key = `${tier}:${name.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      talents.push({
        name,
        marked,
        tier,
        requirements: text(row[col + 1]),
        description,
        row: i + 1,
      });
    }
  });
  return { format: 'kadat-profiles-lists', version: 1, source: snapshot.source, skills, talents };
}
