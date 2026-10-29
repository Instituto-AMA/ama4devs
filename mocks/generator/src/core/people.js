// @ts-check
import { address } from './address.js'
import { dddFor, EMAIL_DOMAINS, FEMALE_FIRST_NAMES, LAST_NAMES, MALE_FIRST_NAMES, slugify } from './data.js'
import { cnh, cpf, formatPhone, pis, rg } from './documents.js'

/**
 * @typedef {object} Person
 * @property {string} name The full name.
 * @property {string} firstName The first name.
 * @property {string} lastName The two family names.
 * @property {'F' | 'M'} gender The gender.
 * @property {string} birthDate The birth date, as 'YYYY-MM-DD'.
 * @property {number} age The age in years.
 * @property {string} cpf The CPF, masked when formatted.
 * @property {string} rg The RG, masked when formatted.
 * @property {string} cnh The CNH, masked when formatted.
 * @property {string} pis The PIS, masked when formatted.
 * @property {string} motherName The mother name.
 * @property {string} email The e-mail address.
 * @property {string} mobilePhone The mobile number, masked when formatted.
 * @property {string} phone The landline number, masked when formatted.
 * @property {import('./address.js').Address} address The address.
 */

/**
 * @typedef {object} PersonOptions
 * @property {string} [state] Keep the person inside this state.
 * @property {'F' | 'M'} [gender] The gender; random when absent.
 * @property {number} [minAge] The youngest age allowed.
 * @property {number} [maxAge] The oldest age allowed.
 * @property {boolean} [formatted] Mask the documents and the phone numbers.
 * @property {Date | string} [now] The reference date, as a Date or 'YYYY-MM-DD'.
 */

/**
 * The date of the same day some years back, clamped to the end of the month.
 * @param {Date} reference
 * @param {number} years
 * @returns {Date}
 */
export function yearsBack(reference, years) {
  const year = reference.getUTCFullYear() - years
  const month = reference.getUTCMonth()
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return new Date(Date.UTC(year, month, Math.min(reference.getUTCDate(), lastDay)))
}

/**
 * The same date some years away, clamped to the end of the month.
 * @param {Date} date
 * @param {number} years
 * @returns {Date}
 */
function yearsAway(date, years) {
  const year = date.getUTCFullYear() + years
  const month = date.getUTCMonth()
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return new Date(Date.UTC(year, month, Math.min(date.getUTCDate(), lastDay)))
}

/**
 * The age of a person on a date.
 * @param {Date} birth
 * @param {Date} reference
 * @returns {number}
 */
function ageAt(birth, reference) {
  let age = reference.getUTCFullYear() - birth.getUTCFullYear()
  const month = reference.getUTCMonth() - birth.getUTCMonth()
  if (month < 0 || (month === 0 && reference.getUTCDate() < birth.getUTCDate())) age -= 1
  return age
}

/**
 * A mobile number: the area code, a 9 and eight digits that are not all the same.
 * @param {import('./rng.js').Rng} rng
 * @param {string} ddd The area code.
 * @returns {string}
 */
export function mobileNumber(rng, ddd) {
  let subscriber = rng.digits(8)
  while (/^(\d)\1{7}$/.test(subscriber)) subscriber = rng.digits(8)
  return `${ddd}9${subscriber}`
}

/**
 * A landline number: the area code, a digit from 2 to 5 and seven digits.
 * @param {import('./rng.js').Rng} rng
 * @param {string} ddd The area code.
 * @returns {string}
 */
export function landlineNumber(rng, ddd) {
  return `${ddd}${rng.int(2, 5)}${rng.digits(7)}`
}

/**
 * A Brazilian person: name, documents, address and contact details.
 * @param {import('./rng.js').Rng} rng
 * @param {PersonOptions} [options]
 * @returns {Person}
 */
export function person(rng, { state, gender, minAge = 18, maxAge = 80, formatted = false, now = new Date() } = {}) {
  const reference = now instanceof Date ? now : new Date(now)
  const sex = gender ?? (rng.bool() ? 'M' : 'F')
  const firstName = rng.pick(sex === 'F' ? FEMALE_FIRST_NAMES : MALE_FIRST_NAMES)
  const motherSurname = rng.pick(LAST_NAMES)
  const fatherSurname = rng.pick(LAST_NAMES)
  const lastName = `${motherSurname} ${fatherSurname}`

  let birth = yearsBack(reference, rng.int(minAge, maxAge))
  birth.setUTCDate(birth.getUTCDate() - rng.int(0, 364))
  let age = ageAt(birth, reference)
  if (age < minAge) {
    birth = yearsAway(birth, 1)
    age = ageAt(birth, reference)
  } else if (age > maxAge) {
    birth = yearsAway(birth, -1)
    age = ageAt(birth, reference)
  }

  const place = address(rng, { state, formatted })
  const ddd = rng.pick(dddFor(place.city, place.state))
  const mobile = mobileNumber(rng, ddd)
  const landline = landlineNumber(rng, ddd)
  const suffix = rng.bool() ? String(rng.int(10, 99)) : ''
  const email = `${slugify(firstName)}.${slugify(fatherSurname)}${suffix}@${rng.pick(EMAIL_DOMAINS)}`

  return {
    name: `${firstName} ${lastName}`,
    firstName,
    lastName,
    gender: sex,
    birthDate: birth.toISOString().slice(0, 10),
    age,
    cpf: cpf(rng, { formatted }),
    rg: rg(rng, { formatted }),
    cnh: cnh(rng, { formatted }),
    pis: pis(rng, { formatted }),
    motherName: `${rng.pick(FEMALE_FIRST_NAMES)} ${rng.pick(LAST_NAMES)} ${rng.pick(LAST_NAMES)}`,
    email,
    mobilePhone: formatted ? formatPhone(mobile) : mobile,
    phone: formatted ? formatPhone(landline) : landline,
    address: place,
  }
}
