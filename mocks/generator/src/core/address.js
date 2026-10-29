// @ts-check
import { CITIES, DISTRICTS, STATES, STREET_NAMES, STREET_TYPES } from './data.js'
import { formatCep } from './documents.js'

/**
 * @typedef {object} Address
 * @property {string} postalCode The eight CEP digits, masked when formatted.
 * @property {string} street The street, with its type.
 * @property {string} number The street number, sometimes 'S/N'.
 * @property {string} complement The apartment, room or block, empty half the time.
 * @property {string} district The district.
 * @property {string} city The city.
 * @property {string} state The two-letter state code.
 * @property {string} stateName The state name.
 * @property {string} ibgeCode The seven-digit IBGE municipality code.
 * @property {string} country The country.
 */

/**
 * @typedef {object} AddressOptions
 * @property {string} [state] Keep the address inside this state; unknown states fall back to all of them.
 * @property {boolean} [formatted] Mask the CEP.
 */

/**
 * A Brazilian address: a real city, a CEP inside the city's range and a real
 * street name.
 * @param {import('./rng.js').Rng} rng
 * @param {AddressOptions} [options]
 * @returns {Address}
 */
export function address(rng, { state, formatted = false } = {}) {
  const matching = state ? CITIES.filter((city) => city.state === state) : []
  const city = rng.pick(matching.length > 0 ? matching : CITIES)
  const digits = `${String(rng.int(city.cep[0], city.cep[1])).padStart(5, '0')}${rng.digits(3)}`

  return {
    postalCode: formatted ? formatCep(digits) : digits,
    street: `${rng.pick(STREET_TYPES)} ${rng.pick(STREET_NAMES)}`,
    number: rng.bool(0.05) ? 'S/N' : String(rng.int(1, 4999)),
    complement: rng.bool(0.5) ? '' : rng.pick(['Apto 12', 'Sala 304', 'Casa 2', 'Bloco B']),
    district: rng.pick(DISTRICTS),
    city: city.city,
    state: city.state,
    stateName: STATES[city.state] ?? city.state,
    ibgeCode: city.ibge,
    country: 'Brasil',
  }
}
