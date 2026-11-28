// Rebuilds dataset/arsenal.json from the committed source snapshot (reproducible import).
import { readFileSync, writeFileSync } from 'node:fs';
import { importArsenal, type ArsenalSnapshot } from '../src/arsenal.js';

const SNAPSHOT = new URL('../sources/arsenal-2026-11-23.json', import.meta.url);
const OUT = new URL('../dataset/arsenal.json', import.meta.url);
const snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as ArsenalSnapshot;
const dataset = importArsenal(snapshot);
writeFileSync(OUT, `${JSON.stringify(dataset, null, 1)}\n`);
console.log(
  `weapons ${dataset.weapons.length}, armour ${dataset.armour.length}, fields ${dataset.fields.length}, properties ${dataset.properties.length}, issues ${dataset.issues.length}`,
);
