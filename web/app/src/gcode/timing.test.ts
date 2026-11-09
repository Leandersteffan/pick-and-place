import { describe, expect, it } from 'vitest'
import { parseGcode } from './parser'
import {
  AMBIENT_TEMPERATURE, COOLING_RATE, DEFAULT_FEEDRATE, HEATING_RATE, TemperatureClock,
  dwellMs, eOnlySeconds, temperatureChangeSeconds, travelSeconds,
} from './timing'

describe('timing helpers', () => {
  it('has the named constants', () => {
    expect(DEFAULT_FEEDRATE).toBe(6000)
    expect(HEATING_RATE).toBe(2.5)
    expect(COOLING_RATE).toBe(1.0)
    expect(AMBIENT_TEMPERATURE).toBe(25)
  })

  it('travel time is length / (F / 60), default feed when unset', () => {
    expect(travelSeconds(10, 600)).toBeCloseTo(1, 12)
    expect(travelSeconds(100, NaN)).toBeCloseTo(1, 12) // 6000 mm/min = 100 mm/s
    expect(travelSeconds(100, 0)).toBeCloseTo(1, 12)
    expect(eOnlySeconds(-3, 4200)).toBeCloseTo(3 / 70, 12)
  })

  it('dwell reads P in ms or S in seconds', () => {
    expect(dwellMs({ P: 500 })).toBe(500)
    expect(dwellMs({ S: 2 })).toBe(2000)
    expect(dwellMs({ P: 100, S: 2 })).toBe(100)
    expect(dwellMs({})).toBe(0)
    expect(dwellMs({ P: -5 })).toBe(0)
  })

  it('temperature change uses the heating or cooling rate', () => {
    expect(temperatureChangeSeconds(100, 210)).toBeCloseTo(44, 12)
    expect(temperatureChangeSeconds(210, 100)).toBeCloseTo(110, 12)
    expect(temperatureChangeSeconds(200, 200)).toBe(0)
  })

  it('TEMPERATURE_WAIT measures from the target before the preceding M104 to the bound', () => {
    const c = new TemperatureClock()
    expect(c.heatAndWait(210)).toBeCloseTo((210 - 25) / 2.5, 12)
    c.setTarget(100)
    expect(c.temperatureWait(undefined, 102)).toBeCloseTo(210 - 102, 12) // cooling to MAXIMUM
    expect(c.temperatureWait(undefined, 102)).toBe(0) // already settled
    c.setTarget(210)
    expect(c.temperatureWait(208, undefined)).toBeCloseTo((208 - 100) / 2.5, 12) // heating to MINIMUM
    c.setTarget(205)
    expect(c.temperatureWait(undefined, 207)).toBeCloseTo(210 - 207, 12) // cooling from 210 to the bound
    c.setTarget(200)
    expect(c.temperatureWait(undefined, 207)).toBe(0) // 205 is already below the bound
  })
})

describe('parser timing', () => {
  const head = 'G90\nM83\nG92 X0 Y0 Z0\n'

  it('adds dwell, E-only and wait time before the next Move', () => {
    const r = parseGcode(
      `${head}M109 S210\nM104 S100 T0\nTEMPERATURE_WAIT SENSOR=extruder MAXIMUM=102\nG4 S1\nG1 E10 F600\nG1 X60 F3600\n`,
    )
    const wait = (210 - 25) / 2.5 + (210 - 102) / 1.0
    expect(r.moves.n).toBe(1)
    expect(r.moves.tStart[0]).toBeCloseTo(wait + 1 + 1, 6)
    expect(r.moves.duration[0]).toBeCloseTo(1, 6)
    expect(r.totalTime).toBeCloseTo(wait + 3, 6)
  })

  it('ignores waits on other sensors and other tools', () => {
    const r = parseGcode(`${head}M109 S210 T1\nTEMPERATURE_WAIT SENSOR=heater_bed MINIMUM=60\nG1 X1\n`)
    expect(r.moves.tStart[0]).toBe(0)
  })
})
