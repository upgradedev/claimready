/**
 * Coverage decision for a claim, read off the policy schedule.
 *
 * PURE MODULE. No DOM, no window, no document, no fetch, no timers, no I/O.
 *
 * This is a deterministic table lookup, not a model and not a guess. The same
 * policy and the same claim always produce the same answer, and every answer
 * cites the clause it came from. Clause ids and the wording of every exclusion
 * live in the policy fixture, so the fixture stays the single source of truth
 * and this module only decides which clause applies.
 */

/** Order matters. The first exclusion that fires supplies the headline clause. */
const EXCLUSION_ORDER = ['excluded_driver', 'outside_policy_period'];

function normaliseName(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function undecided(reason, currency) {
  return {
    covered: false,
    clause: null,
    deductible: null,
    currency,
    reason,
    exclusions: [],
    provisional: false,
  };
}

/**
 * Whether a yes on this policy still depends on a name nobody has given.
 *
 * findExcludedDriver answers null on an empty driver, which is correct as far as
 * it goes and used to be the whole story: a policy that excludes a named driver
 * printed a flat COVERED with a clause and an excess while nobody had said who
 * was at the wheel, and naming that one person turned the same claim into NOT
 * COVERED. The schedule cannot decide the question yet, so the answer says so
 * rather than picking the friendlier half of it.
 *
 * Only a yes can be provisional here. An exclusion that has already fired, a
 * section that was never bought and a date outside the period are all answers
 * the driver cannot change.
 */
function driverStillOpen(policy, claim) {
  if (normaliseName(claim.driver)) return null;
  const list = Array.isArray(policy.excluded_drivers) ? policy.excluded_drivers : [];
  if (list.length === 0) return null;
  const clauses = [...new Set(list.map((entry) => entry?.clause).filter(Boolean))];
  const under = clauses.length ? ` under ${clauses.length === 1 ? 'clause' : 'clauses'} ${clauses.join(', ')}` : '';
  return (
    ` Nobody is named as the driver yet, and this policy excludes ${list.length} named ` +
    `driver${list.length === 1 ? '' : 's'}${under}, so this answer is provisional until the claim says who was driving.`
  );
}

/**
 * Whether a yes on this policy still depends on a date nobody has given.
 *
 * THE SAME DEFECT AS THE DRIVER ONE, IN THE OTHER FIELD THE SCHEDULE READS. findOutsidePeriod
 * answers null on an empty date, which is right as far as it goes: a claim with no date has not
 * fallen outside anything. But the answer then printed a flat COVERED with a clause and an excess
 * on a claim that had never said when the loss happened, and typing one date inside the period
 * left it unchanged while typing one outside turned it into NOT COVERED. A cover answer that
 * ignores whether the loss falls inside the policy period is answering a question the schedule
 * has not decided.
 *
 * Only a yes can be provisional, for the same reason as the driver: an exclusion that has fired,
 * a section that was never bought and a driver who is excluded are all answers no date can move.
 *
 * A pack that states no period, or one whose period is not two dates, makes the question moot,
 * so the yes stays a plain yes rather than being provisional for ever.
 */
function dateStillOpen(policy, claim) {
  const date = claim.incident_date;
  if (typeof date === 'string' && date.trim()) return null;
  const period = policy.period;
  if (!period || typeof period.start !== 'string' || typeof period.end !== 'string') return null;
  const under = typeof period.clause === 'string' && period.clause ? ` under clause ${period.clause}` : '';
  return (
    ' No date has been recorded for the incident yet, and this policy covers losses between ' +
    `${period.start} and ${period.end}${under}, so this answer is provisional until the claim says when it happened.`
  );
}

function findExcludedDriver(policy, claim) {
  const driver = normaliseName(claim.driver);
  if (!driver) return null;
  const list = Array.isArray(policy.excluded_drivers) ? policy.excluded_drivers : [];
  const hit = list.find((entry) => normaliseName(entry?.name) === driver);
  if (!hit) return null;
  return {
    code: 'excluded_driver',
    clause: hit.clause ?? null,
    reason:
      hit.reason ??
      `${hit.name} is named as an excluded driver on this policy, so nothing they drive is covered.`,
  };
}

function findOutsidePeriod(policy, claim) {
  const period = policy.period;
  const date = claim.incident_date;
  if (!period || typeof date !== 'string') return null;
  const { start, end, clause } = period;
  if (typeof start !== 'string' || typeof end !== 'string') return null;
  if (date >= start && date <= end) return null;
  return {
    code: 'outside_policy_period',
    clause: clause ?? null,
    reason: `The incident date ${date} falls outside the policy period, which runs from ${start} to ${end}.`,
  };
}

function findCoverage(policy, incidentType) {
  const list = Array.isArray(policy.coverages) ? policy.coverages : [];
  return list.find(
    (entry) => Array.isArray(entry?.incident_types) && entry.incident_types.includes(incidentType),
  );
}

function liabilityNote(policy) {
  const list = Array.isArray(policy.coverages) ? policy.coverages : [];
  const liability = list.find((entry) => entry?.code === 'third_party' && entry?.active);
  if (!liability) return '';
  return ` Third party liability under clause ${liability.clause} is unaffected and stays in force.`;
}

/**
 * One rendering of the exclusion list, shared by the page and by the tool result.
 *
 * `decision.exclusions` holds objects, so joining the array on its own yields "[object Object]".
 * Every reader goes through here instead, which is also why the panel and the agent name an
 * exclusion with the same words.
 *
 * @param {{exclusions?: Array<{code: string, clause: (string|null)}>}} decision
 * @returns {string[]} one label per exclusion that fired. Empty when the claim is covered.
 */
export function exclusionLabels(decision) {
  const list = decision && Array.isArray(decision.exclusions) ? decision.exclusions : [];
  return list
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => {
      const code = entry.code ? String(entry.code) : 'exclusion';
      return entry.clause ? `${code} (clause ${entry.clause})` : code;
    });
}

/**
 * Decide whether this claim is covered.
 *
 * Return shape, always these seven keys:
 *   covered     boolean
 *   clause      string clause id such as "OD-4.1", or null when no clause decided it
 *   deductible  number of `currency` units the policyholder pays, or null when
 *               nothing is payable. Note that 0 is a real answer (glass cover
 *               carries no excess) and is different from null.
 *   currency    ISO code taken from the policy, defaulting to "EUR"
 *   reason      one or two plain sentences a policyholder can read
 *   exclusions  the exclusion objects that actually fired, each {code, clause, reason}.
 *               Empty when the claim is covered.
 *   provisional true when the answer is a yes that still depends on something the
 *               claim has not said yet. Two things can do that, and either one is
 *               enough: no driver named on a policy that excludes one, and no
 *               incident date on a policy that states a period. A no is never
 *               provisional. A caller that prints a bare "COVERED" over a
 *               provisional answer is telling the claimant something the schedule
 *               has not decided. The reason names every open question, so a caller
 *               that reads the reason knows what to ask for next.
 *
 * @param {object} policy the `policy` block of the fixture
 * @param {object} claim a claim from claim.js
 * @throws {TypeError} when the policy or claim is missing
 */
export function checkCoverage(policy, claim) {
  if (!policy || typeof policy !== 'object') {
    throw new TypeError('checkCoverage needs a policy object.');
  }
  if (!claim || typeof claim !== 'object') {
    throw new TypeError('checkCoverage needs a claim object.');
  }

  const currency = policy.currency ?? 'EUR';

  if (!claim.incident_type) {
    return undecided(
      'The incident type is not recorded yet, so cover cannot be checked. Set the incident type first.',
      currency,
    );
  }

  const found = { excluded_driver: findExcludedDriver(policy, claim), outside_policy_period: findOutsidePeriod(policy, claim) };
  const triggered = EXCLUSION_ORDER.map((code) => found[code]).filter(Boolean);

  if (triggered.length > 0) {
    const headline = triggered[0];
    return {
      covered: false,
      clause: headline.clause,
      deductible: null,
      currency,
      reason: `${headline.reason} That is clause ${headline.clause}.${liabilityNote(policy)}`,
      exclusions: triggered,
      provisional: false,
    };
  }

  const coverage = findCoverage(policy, claim.incident_type);

  if (!coverage) {
    return undecided(
      `This policy has no section covering a ${claim.incident_type} claim, so there is nothing to pay out against.${liabilityNote(policy)}`,
      currency,
    );
  }

  if (!coverage.active) {
    const reason =
      coverage.inactive_reason ??
      `The ${coverage.label} section was not added to this policy, so a ${claim.incident_type} claim is not covered.`;
    return {
      covered: false,
      clause: coverage.clause ?? null,
      deductible: null,
      currency,
      reason: `${reason} That is clause ${coverage.clause}.${liabilityNote(policy)}`,
      exclusions: [
        {
          code: 'rider_not_purchased',
          clause: coverage.clause ?? null,
          reason,
        },
      ],
      provisional: false,
    };
  }

  const deductible = typeof coverage.deductible === 'number' ? coverage.deductible : 0;
  const excessText =
    deductible === 0
      ? 'This section carries no excess, so there is nothing for you to pay towards it.'
      : `You pay the first ${deductible} ${currency} as the excess.`;

  // Two open questions, and they compose. Either one on its own makes the yes provisional, and a
  // claim that has said neither who was driving nor when it happened says both out loud rather
  // than whichever one the code happened to look at last.
  const openDriver = driverStillOpen(policy, claim);
  const openDate = dateStillOpen(policy, claim);

  return {
    covered: true,
    clause: coverage.clause ?? null,
    deductible,
    currency,
    reason:
      `A ${claim.incident_type} claim is covered under ${coverage.label}, clause ${coverage.clause}. ` +
      `${excessText}${openDriver ?? ''}${openDate ?? ''}`,
    exclusions: [],
    provisional: Boolean(openDriver || openDate),
  };
}
