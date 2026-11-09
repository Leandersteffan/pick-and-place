// Time estimates for the Gcode_Parser (design section 5, "Timing"). Pure: no DOM, no three.js.
//
// There is no acceleration model in the demo (Requirement 24 refines this). A Move takes
// length / (F / 60) seconds with the modal F, a dwell takes its G4 parameter, an E-only
// command takes |E| / (F / 60), and a temperature wait takes the temperature change
// divided by a fixed heating or cooling rate.

/** Feedrate assumed until the file sets one, mm/min. */
export const DEFAULT_FEEDRATE = 6000

/** Nozzle heating rate used for wait estimates, °C/s. Open Question in the design. */
export const HEATING_RATE = 2.5

/** Nozzle cooling rate used for wait estimates, °C/s. Open Question in the design. */
export const COOLING_RATE = 1.0

/** Nozzle temperature assumed before the file sets a T0 target, °C. */
export const AMBIENT_TEMPERATURE = 25

/** Seconds for a path of `length` mm at feedrate `f` mm/min (DEFAULT_FEEDRATE if f is unset or not positive). */
export function travelSeconds(length: number, f: number): number {
  const feed = f > 0 ? f : DEFAULT_FEEDRATE
  return length / (feed / 60)
}

/** Seconds for an E-only command (`G1 E10 F2400`, `G1 E-3 F4200`): |E| / (F / 60). */
export function eOnlySeconds(e: number, f: number): number {
  return travelSeconds(Math.abs(e), f)
}

/** Dwell in milliseconds from `G4 P<ms>` or `G4 S<s>`. P wins if both are present. */
export function dwellMs(words: Record<string, number>): number {
  if (words.P !== undefined) return Math.max(0, words.P)
  if (words.S !== undefined) return Math.max(0, words.S * 1000)
  return 0
}

/** Seconds to go from `from` to `to` °C: heating at HEATING_RATE, cooling at COOLING_RATE. */
export function temperatureChangeSeconds(from: number, to: number): number {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0
  if (to > from) return (to - from) / HEATING_RATE
  return (from - to) / COOLING_RATE
}

/**
 * T0 temperature state for wait estimates.
 *
 * `current` is the last T0 target set by M104 or M109. `reference` is the temperature the
 * nozzle is assumed to be at: the target that was in effect before the latest M104, until a
 * wait settles the nozzle. Both start at AMBIENT_TEMPERATURE.
 *
 * Why `reference` and not `current`: the pipeline writes `M104 S{temp} T0` and then
 * `TEMPERATURE_WAIT SENSOR=extruder MAXIMUM=target+2` (cooling) or `MINIMUM=target-2`
 * (heating). By the time the wait is read, `current` already holds the new target, so the
 * wait is measured from the target before that M104 to the wait bound.
 */
export class TemperatureClock {
  current = AMBIENT_TEMPERATURE
  reference = AMBIENT_TEMPERATURE

  /** `M104 S<t>` on T0: no time, the nozzle starts moving towards `target`. */
  setTarget(target: number): void {
    this.reference = this.current
    this.current = target
  }

  /** `M109 S<t>` or `M109 R<t>` on T0: |target - previous target| / rate, then settled at target. */
  heatAndWait(target: number): number {
    const s = temperatureChangeSeconds(this.current, target)
    this.current = target
    this.reference = target
    return s
  }

  /**
   * `TEMPERATURE_WAIT SENSOR=extruder MINIMUM=<a> MAXIMUM=<b>`: if the reference is above
   * MAXIMUM, cooling down to MAXIMUM; if below MINIMUM, heating up to MINIMUM; otherwise 0.
   * The nozzle is then settled at the current target.
   */
  temperatureWait(min: number | undefined, max: number | undefined): number {
    const ref = this.reference
    let s = 0
    if (max !== undefined && ref > max) s = temperatureChangeSeconds(ref, max)
    else if (min !== undefined && ref < min) s = temperatureChangeSeconds(ref, min)
    this.reference = this.current
    return s
  }
}
