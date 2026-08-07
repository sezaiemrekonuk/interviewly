import styles from './meter.module.css';

const cx = (...names: Array<string | false | undefined>) => names.filter(Boolean).join(' ');

export type MeterTone = 'default' | 'live' | 'primary' | 'danger';

/**
 * A quantity against its ceiling, drawn so the magnitude reads before the number does.
 *
 * Native <progress> rather than a styled div: the CSP forbids style attributes, so the
 * width-in-a-style-prop pattern this replaces silently rendered empty in production.
 *
 * `label` is required and visually hidden — a bar with no accessible name is a decoration
 * announced as "progress bar, 41%" with no idea what is at 41%. Pass `decorative` only when
 * the same value is already stated in text next to it.
 */
export function Meter({
  value,
  max = 100,
  tone = 'default',
  label,
  decorative = false,
  tall = false,
  onRail = false,
  instant = false,
  className,
}: {
  value: number;
  max?: number;
  tone?: MeterTone;
  label?: string;
  decorative?: boolean;
  tall?: boolean;
  onRail?: boolean;
  instant?: boolean;
  className?: string;
}) {
  // Clamp: a provider can report a level above 1, and a budget can be spent past its ceiling.
  // Either would render as an overflowing bar rather than a full one.
  const safeMax = max > 0 ? max : 1;
  const safeValue = Math.min(Math.max(value, 0), safeMax);

  return (
    <progress
      className={cx(
        styles.meter,
        tall && styles.tall,
        onRail && styles.onRail,
        instant && styles.instant,
        tone !== 'default' && styles[tone],
        className
      )}
      value={safeValue}
      max={safeMax}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative || undefined}
    />
  );
}
