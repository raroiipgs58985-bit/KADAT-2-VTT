// Передача персонажа в KADAT VTT: досье записывается в общий localStorage как есть.
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm');
const { loadDomain, plain } = require('./helpers.cjs');
const { data, engine } = loadDomain();
let d = engine.createDraft();
d.name = 'Тестовый гвардеец';
d.mode = 'random';
d.rolls = Object.fromEntries(data.stats.map((s) => [s, 11]));
for (const choice of engine.origins(d).race.choices ?? [])
  d.raceChoices[choice.id] = choice.options.slice(0, choice.count ?? 1);
const character = engine.build(d);

const store = new Map();
const window = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  },
};
const context = vm.createContext({ window });
for (const f of ['services/exports', 'services/vtt-export'])
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', `src/${f}.js`), 'utf8'), context);
assert.deepEqual(plain([...window.KadatExports.list()]), ['kadat-vtt']);
window.KadatExports.download('kadat-vtt', character);
const outbox = JSON.parse(store.get(window.KadatVttExport.KEY));
assert.equal(outbox.length, 1);
const sent = outbox[0];
assert.equal(sent.format, 'kadat-generator-character');
assert.equal(sent.name, 'Тестовый гвардеец');
assert.deepEqual(sent.stats, plain(character.stats));
assert.equal(sent.wounds, character.wounds);
assert.deepEqual(
  sent.skills,
  plain([...character.skills].map(([name, bonus]) => ({ name, bonus: bonus ?? 0 }))),
);
assert.deepEqual(sent.talents, plain(character.talents));
assert(Array.isArray(sent.race.traits) && Array.isArray(sent.equipment));
// The same name replaces the earlier entry instead of piling up.
window.KadatExports.download('kadat-vtt', character);
assert.equal(JSON.parse(store.get(window.KadatVttExport.KEY)).length, 1);
console.log('VTT export: dossier, skills, talents and wounds handed over as is OK');
