// KADAT 2 UI Kit v0.2 — React-обёртки над графическими компонентами (ресурсы в ./assets,
// классы в ./kit.css). Текст, числа и шкалы — живые; графика — отдельные 9-slice и картинки.
import type { ReactNode } from 'react';
import type { AttackPreview } from '../../game/engine';

/** Газоразрядный индикатор числа. */
export function Nixie(props: { value: ReactNode; label: string; size?: 'sm' | 'lg' }) {
  return (
    <div
      className={`kit-nixie kit-nixie-${props.size ?? 'sm'}`}
      role="img"
      aria-label={`${props.label}: ${String(props.value)}`}
    >
      <span className="kit-nixie-digits">{props.value}</span>
    </div>
  );
}

/** Световой индикатор (лампа в хромированной оправе). */
export function Lamp(props: {
  on: boolean;
  color: 'amber' | 'green';
  label: string;
  className?: string;
}) {
  return (
    <span
      className={`kit-lamp kit-lamp-${props.color}${props.className ? ` ${props.className}` : ''}${props.on ? ' on' : ''}`}
      role="img"
      aria-label={`${props.label}: ${props.on ? 'есть' : 'нет'}`}
      title={props.label}
    />
  );
}

const signed = (v: number) => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0');

/** Блок «ПОРОГ d100» панели атаки: характеристика, модификаторы ядра, итог (ADR 0007). */
export function AttackReadout({ preview }: { preview: AttackPreview | null | undefined }) {
  if (!preview) return null;
  if (preview.status !== 'ready')
    return (
      <section className="kit-screen kit-readout" aria-label="Порог атаки">
        <div className="kit-readout-head">
          <span className="kit-caption">ПОРОГ d100</span>
          <Nixie value="—" label="Порог d100" size="lg" />
        </div>
        <p className="kit-readout-reason">{preview.reason}</p>
      </section>
    );
  // Only what changes the target: zero contributions are left out.
  const shown = preview.modifiers.filter((m) => m.value !== 0);
  return (
    <section className="kit-screen kit-readout" aria-label="Порог атаки">
      <div className="kit-readout-head">
        <div>
          <span className="kit-caption">ПОРОГ d100</span>
          <div className="kit-readout-base">
            {preview.characteristic} {preview.baseValue}
            {preview.finalModifier !== 0 && <> {signed(preview.finalModifier)}</>}
          </div>
        </div>
        <Nixie value={preview.target} label="Порог d100" size="lg" />
      </div>
      {shown.length > 0 && (
        <ul className="kit-readout-mods">
          {shown.map((m) => (
            <li key={m.id} className={m.included ? '' : 'off'}>
              <span>{m.label}</span>
              <span className={m.value > 0 ? 'plus' : m.value < 0 ? 'minus' : ''}>
                {m.included ? signed(m.value) : 'не действует'}
              </span>
            </li>
          ))}
        </ul>
      )}
      {preview.rawModifierSum !== preview.finalModifier && (
        <p className="kit-readout-note">
          Сумма {signed(preview.rawModifierSum)} ограничена до {signed(preview.finalModifier)}
        </p>
      )}
    </section>
  );
}
