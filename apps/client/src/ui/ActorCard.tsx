import { actorStatus, weaponSupport } from '../game/engine';
import { locationName } from '../game/journal';
import { actor, movementProfiles, weapons, type ActorId, type Battle } from '../game/model';

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

export function ActorCard({ battle, id }: { battle: Battle; id: ActorId }) {
  const profile = actor(id);
  const status = actorStatus(battle, id);
  const move = movementProfiles[id];
  const own = weapons.filter((w) => w.owner === id);
  const details = profile.profile.filter(
    (p) => !['ОБ', 'БВ', 'Раны', 'Движение'].includes(p.label),
  );
  const field = (label: string) => profile.profile.find((p) => p.label === label);

  return (
    <article className="actor-card" aria-label={`Персонаж ${profile.name}`}>
      <header className="actor-head">
        <div className={`avatar ${id === 'pak' ? 'side-b' : 'side-a'}`}>{profile.name[0]}</div>
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

      <section>
        <h3>Характеристики</h3>
        <dl className="stats">
          {Object.entries(profile.characteristics).map(([key, c]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{c.raw}</dd>
            </div>
          ))}
        </dl>
        <dl className="facts">
          <div>
            <dt>ОБ (голова/торс/руки/ноги)</dt>
            <dd>{field('ОБ')?.formattedValue}</dd>
          </div>
          <div>
            <dt>БВ</dt>
            <dd>{field('БВ')?.formattedValue}</dd>
          </div>
          <div>
            <dt>СКР в движке</dt>
            <dd title={`${move.source}: ${move.profileText}`}>{status.movement} м</dd>
          </div>
        </dl>
        {move.openQuestion && <p className="note-author">{move.openQuestion}</p>}
      </section>

      <section>
        <h3>Оружие</h3>
        <ul className="weapons">
          {own.map((w) => {
            const support = weaponSupport(w.id);
            const ammo = battle.ammo[w.id];
            return (
              <li key={w.id}>
                <div className="weapon-line">
                  <strong>{w.name}</strong>
                  <span className={`badge badge-${support.level}`}>
                    {supportLabel[support.level]}
                  </span>
                </div>
                <div className="muted small">
                  {ammo === null ? 'без боезапаса' : `боезапас ${ammo} / ${w.capacity}`}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <details className="profile-details">
        <summary>Навыки, таланты, импланты и снаряжение</summary>
        {details.map((p) => (
          <div key={p.label} className="profile-entry">
            <strong>{p.label.replace(/:$/, '')}</strong>
            <p>{p.formattedValue}</p>
            {p.note && <p className="muted small pre">{p.note}</p>}
          </div>
        ))}
      </details>
    </article>
  );
}
