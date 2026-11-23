import { actorStatus, weaponSupport } from '../game/engine';
import { armourZoneName, ARMOUR_ZONES } from '../game/character';
import { area, footprintPresets, sameFootprint, type Footprint } from '../game/grid';
import { locationName } from '../game/journal';
import { battleWeapons, combatant, fpOf, type ActorId, type Battle } from '../game/model';

const lifeLabel: Record<string, string> = {
  ALIVE: 'В строю',
  AGONY: 'Агония',
  DEAD: 'Мёртв',
};
const postureLabel = { standing: 'стоит', kneeling: 'на колене', prone: 'лёжа' } as const;
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
        <div>
          <div className="vital-label">
            <span>Раны</span>
            <strong>
              {status.wounds} / {status.maxWounds}
            </strong>
          </div>
          <Meter value={status.wounds} max={status.maxWounds} tone="wounds" />
        </div>
        <div>
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
          {status.conditions.map((c, i) => (
            <span className="chip chip-warn" key={`${c}-${i}`}>
              {c}
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
