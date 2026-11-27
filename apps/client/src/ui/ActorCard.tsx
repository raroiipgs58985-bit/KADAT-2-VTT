import { actorStatus, weaponSupport } from '../game/engine';
import { armourZoneName, ARMOUR_ZONES } from '../game/character';
import { area, footprintPresets, sameFootprint, type Footprint } from '../game/grid';
import { locationName } from '../game/journal';
import { battleWeapons, combatant, fpOf, type ActorId, type Battle } from '../game/model';

const lifeLabel: Record<string, string> = {
  ALIVE: 'В строю',
  AGONY: 'Агония',
  STABILIZED: 'Стабилизирован',
  DEAD: 'Мёртв',
};
const postureLabel = { standing: 'стоит', kneeling: 'на колене', prone: 'лёжа' } as const;
const conditionLabel: Record<string, string> = {
  Stunned: 'Оглушён',
  Helpless: 'Беспомощен',
  Unconscious: 'Без сознания',
  Dead: 'Мёртв',
  Prone: 'Лежит',
  Blinded: 'Ослеплён',
  Suppressed: 'Подавлен',
  Concussed: 'Контужен',
  Burning: 'Горит',
  Crippled: 'Калечащее ранение',
  Poisoned: 'Отравлен',
  Irradiated: 'Облучён',
  Agony: 'Агония',
  PersistentFatigue: 'Стойкая усталость',
};
const bleedingLabel = { LIGHT: 'лёгкое', MEDIUM: 'среднее', HEAVY: 'тяжёлое' } as const;
const supportLabel = { supported: 'работает', partial: 'частично', blocked: 'не подключено' };

function Meter({ value, max, tone }: { value: number; max: number; tone: string }) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div className={`meter meter-${tone}`} role="meter" aria-valuenow={value} aria-valuemax={max}>
      <div style={{ width: `${ratio * 100}%` }} />
    </div>
  );
}

/**
 * Pointer instrument for wounds and blood (desktop shell): the needle and the readout show the
 * exact value from the Rules Engine; the dial is a picture of the same number, nothing more.
 */
function Gauge(props: { label: string; value: number; max: number; tone: 'wounds' | 'blood' }) {
  const { value, max } = props;
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  // 240° dial: from 150° (empty) clockwise to 30° (full), angles in SVG degrees.
  const angle = (r: number) => ((150 + 240 * r) * Math.PI) / 180;
  const at = (r: number, radius: number) => ({
    x: 50 + radius * Math.cos(angle(r)),
    y: 50 + radius * Math.sin(angle(r)),
  });
  const arc = (from: number, to: number, radius: number) => {
    const a = at(from, radius),
      b = at(to, radius);
    return `M ${a.x} ${a.y} A ${radius} ${radius} 0 ${240 * (to - from) > 180 ? 1 : 0} 1 ${b.x} ${b.y}`;
  };
  const tip = at(ratio, 33);
  return (
    <div
      className={`gauge gauge-${props.tone}`}
      role="meter"
      aria-label={props.label}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle className="gauge-bezel" cx={50} cy={50} r={47} />
        <circle className="gauge-face" cx={50} cy={50} r={42} />
        <path className="gauge-track" d={arc(0, 1, 36)} />
        {ratio > 0 && <path className="gauge-value" d={arc(0, ratio, 36)} />}
        {Array.from({ length: 11 }, (_, i) => {
          const a = at(i / 10, 39),
            b = at(i / 10, i % 5 === 0 ? 31 : 34);
          return <line key={i} className="gauge-tick" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
        })}
        <text className="gauge-scale" x={at(0, 24).x} y={at(0, 24).y + 2} textAnchor="middle">
          0
        </text>
        <text className="gauge-scale" x={at(1, 24).x} y={at(1, 24).y + 2} textAnchor="middle">
          {max}
        </text>
        <line className="gauge-needle" x1={50} y1={50} x2={tip.x} y2={tip.y} />
        <text className="gauge-name" x={50} y={66} textAnchor="middle">
          {props.label.toUpperCase()}
        </text>
        <rect className="gauge-window" x={27} y={71} width={46} height={15} rx={1.5} />
        <text className="gauge-digits" x={50} y={82.5} textAnchor="middle">
          {value} / {max}
        </text>
        <circle className="gauge-hub" cx={50} cy={50} r={4.5} />
      </svg>
      <div className="gauge-readout">
        <span className="gauge-label">{props.label}</span>
        <strong>
          {value} / {max}
        </strong>
      </div>
    </div>
  );
}

export function ActorCard({
  battle,
  id,
  setup,
  onFootprint,
  onSkr,
}: {
  battle: Battle;
  id: ActorId;
  setup: boolean;
  onFootprint: (footprint: Footprint) => void;
  /** Ruling 3: the player or the GM switches the СКР option, also during the fight. */
  onSkr: (option: number) => void;
}) {
  const footprint = fpOf(battle, id);
  const presetId = footprintPresets.find((p) => sameFootprint(p.footprint, footprint))?.id ?? '1x1';
  const c = combatant(battle, id);
  const profile = c.character;
  const status = actorStatus(battle, id);
  const own = battleWeapons(battle, id);

  return (
    <article className="actor-card" aria-label={`Персонаж ${profile.name}`}>
      <div className="diag-strip" aria-hidden="true">
        <span>ДИАГНОСТИКА</span>
        <span className={`diag-lamp diag-${status.life.toLowerCase()}`} />
        <span>{(lifeLabel[status.life] ?? status.life).toUpperCase()}</span>
      </div>
      <header className="actor-head">
        <div className={`avatar ${c.side === 'b' ? 'side-b' : 'side-a'}`}>{profile.name[0]}</div>
        <div>
          <h2>{profile.name}</h2>
          <p className="muted">
            {lifeLabel[status.life] ?? status.life} · {postureLabel[status.posture]} · усталость{' '}
            {status.fatigue}
          </p>
        </div>
      </header>

      <div className="vitals">
        <div className="gauges">
          <Gauge label="Раны" value={status.wounds} max={status.maxWounds} tone="wounds" />
          <Gauge
            label="Кровь"
            value={status.blood.currentBlood}
            max={status.blood.maxBlood}
            tone="blood"
          />
        </div>
        <div className="vital-bar">
          <div className="vital-label">
            <span>Раны</span>
            <strong>
              {status.wounds} / {status.maxWounds}
            </strong>
          </div>
          <Meter value={status.wounds} max={status.maxWounds} tone="wounds" />
        </div>
        <div className="vital-bar">
          <div className="vital-label">
            <span>Кровь</span>
            <strong>
              {status.blood.currentBlood} / {status.blood.maxBlood}
            </strong>
          </div>
          <Meter value={status.blood.currentBlood} max={status.blood.maxBlood} tone="blood" />
        </div>
      </div>

      {(status.conditions.length > 0 || status.bleeding.length > 0) && (
        <div className="chips">
          {[...new Set(status.conditions)].map((c, i) => (
            <span className="chip chip-warn" key={`${c}-${i}`}>
              {conditionLabel[c] ?? c}
            </span>
          ))}
          {status.bleeding.map((b) => (
            <span className="chip chip-blood" key={b.id}>
              Кровотечение {bleedingLabel[b.severity]} · {locationName(b.location)}
            </span>
          ))}
        </div>
      )}

      {status.injuries.length > 0 && (
        <section>
          <h3>Ранения</h3>
          <ul className="injuries">
            {status.injuries.map((i) => (
              <li key={i.id}>
                <strong>{locationName(i.location)}</strong> — {i.title}
                <span className="muted">
                  {' '}
                  (урон {i.finalDamage}, тяжесть {i.severity})
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={setup ? '' : 'detail'}>
        <h3>Токен на карте</h3>
        <dl className="facts">
          <div>
            <dt>Площадь токена по Размеру</dt>
            <dd>
              {setup ? (
                <select
                  aria-label="Площадь токена"
                  value={presetId}
                  onChange={(e) =>
                    onFootprint(footprintPresets.find((p) => p.id === e.target.value)!.footprint)
                  }
                >
                  {footprintPresets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              ) : (
                `${area(footprint)} (${footprint.width} × ${footprint.height})`
              )}
            </dd>
          </div>
        </dl>
        <p className="muted small detail">
          Размер 0 и меньше — 1 × 1, Размер 1 — 2 × 2, Размер 2 — 3 × 3 (решение автора 12).
        </p>
      </section>

      <section className="detail">
        <h3>Характеристики</h3>
        <dl className="stats">
          {Object.entries(profile.characteristics).map(([key, v]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>
                {v.value}
                {v.super ? ` (+${v.super} Сверх)` : ''}
              </dd>
            </div>
          ))}
        </dl>
        <dl className="facts">
          <div>
            <dt>ОБ</dt>
            <dd>
              {ARMOUR_ZONES.map((z) => `${armourZoneName[z]} ${profile.armour[z]}`).join(', ')}
            </dd>
          </div>
        </dl>
      </section>

      <section>
        <h3>Движение</h3>
        <dl className="facts">
          <div>
            <dt>СКР</dt>
            <dd>
              {profile.movement.options.length > 1 ? (
                <select
                  aria-label="Вариант СКР"
                  value={profile.movement.current}
                  onChange={(e) => onSkr(Number(e.target.value))}
                >
                  {profile.movement.options.map((o, i) => (
                    <option key={i} value={i}>
                      {o.label}: {o.skr} м
                    </option>
                  ))}
                </select>
              ) : (
                `${status.movement} м`
              )}
            </dd>
          </div>
        </dl>
      </section>

      <section>
        <h3>Оружие</h3>
        <ul className="weapons">
          {own.map((w) => {
            const support = weaponSupport(battle, w.id);
            const ammo = battle.ammo[w.id];
            return (
              <li key={w.id}>
                <div className="weapon-line">
                  <strong>{w.name}</strong>
                  <span className={`badge badge-${support.level} detail`}>
                    {supportLabel[support.level]}
                  </span>
                </div>
                <div className="muted small">
                  {ammo === null || ammo === undefined
                    ? 'без магазина'
                    : `боезапас ${ammo} / ${w.capacity}`}
                </div>
                {support.level !== 'supported' && <div className="muted small">{support.note}</div>}
              </li>
            );
          })}
        </ul>
      </section>

      <details className="profile-details detail">
        <summary>Навыки, таланты и особенности</summary>
        <div className="profile-entry">
          <strong>Навыки</strong>
          <p>
            {profile.skills
              .map((sk) => `${sk.name}${sk.bonus ? ` +${sk.bonus}` : ''}`)
              .join(', ') || '—'}
          </p>
        </div>
        <div className="profile-entry">
          <strong>Таланты</strong>
          <p>{profile.talents.join(', ') || '—'}</p>
        </div>
        {profile.traits && (
          <div className="profile-entry">
            <p className="muted small pre">{profile.traits}</p>
          </div>
        )}
      </details>
    </article>
  );
}

/**
 * Phone shell: a small fighter plate over the map (name, state, wound and blood gauges).
 * Tapping it opens the full card in the turn sheet.
 */
export function FighterHud(props: { battle: Battle; id: ActorId; onOpen: () => void }) {
  const status = actorStatus(props.battle, props.id);
  const name = combatant(props.battle, props.id).character.name;
  return (
    <button
      type="button"
      className="fighter-hud"
      onClick={props.onOpen}
      aria-label={`${name}: открыть карточку бойца`}
    >
      <span className="fighter-hud-name">
        <strong>{name}</strong>
        <span>{(lifeLabel[status.life] ?? status.life).toLowerCase()}</span>
      </span>
      <span className="fighter-hud-gauges">
        <Gauge label="Раны" value={status.wounds} max={status.maxWounds} tone="wounds" />
        <Gauge
          label="Кровь"
          value={status.blood.currentBlood}
          max={status.blood.maxBlood}
          tone="blood"
        />
      </span>
    </button>
  );
}
