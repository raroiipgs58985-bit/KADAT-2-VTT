// Rebuilds dataset/profiles-lists.json from the committed source snapshot (reproducible import).
import { readFileSync, writeFileSync } from 'node:fs';
import { importProfilesLists, type ProfilesListsSnapshot } from '../src/profiles-lists.js';

const SNAPSHOT = new URL('../sources/profiles-lists-2026-11-23.json', import.meta.url);
const OUT = new URL('../dataset/profiles-lists.json', import.meta.url);
const snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as ProfilesListsSnapshot;
const lists = importProfilesLists(snapshot);
writeFileSync(OUT, `${JSON.stringify(lists, null, 1)}\n`);
console.log(`skills ${lists.skills.length}, talents ${lists.talents.length}`);
