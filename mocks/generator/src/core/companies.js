// @ts-check
import { address } from './address.js'
import { ACTIVITIES, COMPANY_SUFFIXES, COMPANY_WORDS, dddFor, EMAIL_DOMAINS, LAST_NAMES, slugify } from './data.js'
import { cnpj, formatPhone } from './documents.js'
import { landlineNumber, mobileNumber, person, yearsBack } from './people.js'

/**
 * @typedef {object} Company
 * @property {string} corporateName The registered name.
 * @property {string} tradeName The trade name.
 * @property {string} cnpj The CNPJ, masked when formatted.
 * @property {string} stateRegistration The state registration number, or 'ISENTO'.
 * @property {string} municipalRegistration The municipal registration number.
 * @property {string} openingDate The opening date, as 'YYYY-MM-DD'.
 * @property {'MEI' | 'ME' | 'EPP' | 'DEMAIS'} size The size of the company.
 * @property {{ cnae: string, description: string }} activity The CNAE activity.
 * @property {string} email The e-mail address.
 * @property {string} phone The landline number, masked when formatted.
 * @property {string} mobilePhone The mobile number, masked when formatted.
 * @property {string} website The website.
 * @property {import('./address.js').Address} address The address.
 * @property {import('./people.js').Person[]} partners The partners of the company.
 */

/**
 * @typedef {object} CompanyOptions
 * @property {string} [state] Keep the company inside this state.
 * @property {boolean} [formatted] Mask the documents and the phone numbers.
 * @property {Date | string} [now] The reference date, as a Date or 'YYYY-MM-DD'.
 */

/** @type {readonly ('MEI' | 'ME' | 'EPP' | 'DEMAIS')[]} */
const COMPANY_SIZES = Object.freeze(['MEI', 'ME', 'EPP', 'DEMAIS'])

/** The words an activity description never leads the corporate name with. */
const SKIP_WORDS = new Set([
  'atividade', 'atividades', 'outras', 'outros', 'servicos', 'serviço',
  'de', 'do', 'da', 'em', 'para', 'e',
])

/**
 * The trade name: one or two company words, sometimes a family name in front.
 * @param {import('./rng.js').Rng} rng
 * @returns {string}
 */
function tradeNameFor(rng) {
  const count = rng.bool(0.65) ? 1 : 2
  let name = rng.pick(COMPANY_WORDS)
  for (let index = 1; index < count; index++) name = `${name} ${rng.pick(COMPANY_WORDS)}`
  if (rng.bool(0.25)) name = `${rng.pick(LAST_NAMES)} ${rng.pick(COMPANY_WORDS)}`
  return name
}

/**
 * The word of the activity that names the business.
 * @param {string} description
 * @returns {string}
 */
function activityWord(description) {
  const words = description.split(' ')
  const raw = words.find((word) => !SKIP_WORDS.has(word.toLowerCase())) ?? words[0] ?? ''
  const word = raw.replace(/[^A-Za-zÀ-ÿ]/g, '')
  return word.charAt(0).toUpperCase() + word.slice(1)
}

/**
 * A Brazilian company: activity, documents, address and partners.
 * @param {import('./rng.js').Rng} rng
 * @param {CompanyOptions} [options]
 * @returns {Company}
 */
export function company(rng, { state, formatted = false, now = new Date() } = {}) {
  const reference = now instanceof Date ? now : new Date(now)
  const activity = rng.pick(ACTIVITIES)
  const tradeName = tradeNameFor(rng)
  const corporateName = `${tradeName} ${activityWord(activity.description)} ${rng.pick(COMPANY_SUFFIXES)}`
  const place = address(rng, { state, formatted })
  const ddd = rng.pick(dddFor(place.city, place.state))
  const mobile = mobileNumber(rng, ddd)
  const landline = landlineNumber(rng, ddd)

  /** @type {import('./people.js').Person[]} */
  const partners = []
  for (let index = 0; index < rng.int(1, 3); index++) {
    partners.push(person(rng, { state: place.state, minAge: 21, formatted, now: reference }))
  }

  return {
    corporateName,
    tradeName,
    cnpj: cnpj(rng, { formatted }),
    stateRegistration: rng.bool(0.2) ? 'ISENTO' : rng.digits(rng.int(9, 12)),
    municipalRegistration: rng.digits(rng.int(7, 8)),
    openingDate: yearsBack(reference, rng.int(1, 30)).toISOString().slice(0, 10),
    size: rng.pick(COMPANY_SIZES),
    activity: { cnae: activity.cnae, description: activity.description },
    email: `${rng.bool() ? 'contato' : 'financeiro'}@${slugify(tradeName)}.${rng.pick(EMAIL_DOMAINS)}`,
    phone: formatted ? formatPhone(landline) : landline,
    mobilePhone: formatted ? formatPhone(mobile) : mobile,
    website: `https://www.${slugify(tradeName)}.example.com`,
    address: place,
    partners,
  }
}
