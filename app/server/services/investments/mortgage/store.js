'use strict';

const actualDatabase = require('../../database.js');
const { MORTGAGE_INDEX_STATEMENTS, MORTGAGE_TABLE_STATEMENTS } = require('./schema.js');
const { AMORTIZATIONS, EVENT_TYPES, GRACE_TYPES, TRACK_TYPES } = require('./engine.js');
const { isIsoDate } = require('./dates.js');

let database = actualDatabase;
let schemaPromise = null;

const MAX_TRACKS = 12;
const MAX_TRANCHES = 24;
const MAX_EVENTS = 200;
const VARIABLE_TYPES = new Set(['variable_unlinked', 'variable_cpi']);
const FIXED_TYPES = new Set(['fixed_unlinked', 'fixed_cpi', 'fx_linked', 'legacy']);

function serviceError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      for (const statement of MORTGAGE_TABLE_STATEMENTS) await database.query(statement);
      for (const statement of MORTGAGE_INDEX_STATEMENTS) await database.query(statement);
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function optionalNumber(value, field, { min = -Infinity, max = Infinity } = {}) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw serviceError(400, `${field} must be a number between ${min} and ${max}`);
  }
  return parsed;
}

function requiredNumber(value, field, range) {
  const parsed = optionalNumber(value, field, range);
  if (parsed === null) throw serviceError(400, `${field} is required`);
  return parsed;
}

function optionalDate(value, field) {
  if (value === null || value === undefined || value === '') return null;
  const date = String(value).slice(0, 10);
  if (!isIsoDate(date)) throw serviceError(400, `${field} must be a YYYY-MM-DD date`);
  return date;
}

function optionalText(value, maxLength = 200) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function normalizeTranche(raw, field) {
  const drawDate = optionalDate(raw?.drawDate, `${field}.drawDate`);
  if (!drawDate) throw serviceError(400, `${field}.drawDate is required`);
  return {
    drawDate,
    amount: requiredNumber(raw?.amount, `${field}.amount`, { min: 0.01, max: 1e9 }),
    status: raw?.status === 'planned' ? 'planned' : 'drawn',
    rate: optionalNumber(raw?.rate, `${field}.rate`, { min: -5, max: 30 }),
    termMode: raw?.termMode === 'full_term' ? 'full_term' : 'same_maturity',
    termMonths: optionalNumber(raw?.termMonths, `${field}.termMonths`, { min: 1, max: 600 }),
    notes: optionalText(raw?.notes, 500),
  };
}

function normalizeTrackPayload(raw, index) {
  const field = `tracks[${index}]`;
  const type = String(raw?.type || '');
  if (!TRACK_TYPES.includes(type)) throw serviceError(400, `${field}.type is not a supported track type`);
  const tranches = Array.isArray(raw?.tranches) ? raw.tranches : [];
  if (tranches.length === 0) throw serviceError(400, `${field} needs at least one drawdown`);
  if (tranches.length > MAX_TRANCHES) throw serviceError(400, `${field} has too many drawdowns`);
  const normalizedTranches = tranches.map((tranche, trancheIndex) => normalizeTranche(tranche, `${field}.tranches[${trancheIndex}]`));

  const rate = optionalNumber(raw?.rate, `${field}.rate`, { min: -5, max: 30 });
  const margin = optionalNumber(raw?.margin, `${field}.margin`, { min: -10, max: 15 });
  if (type === 'prime' && margin === null) throw serviceError(400, `${field}.margin is required for a prime track`);
  if (FIXED_TYPES.has(type) && rate === null && normalizedTranches.some((tranche) => tranche.rate === null && tranche.status === 'drawn')) {
    throw serviceError(400, `${field}.rate is required`);
  }
  if (VARIABLE_TYPES.has(type) && rate === null) throw serviceError(400, `${field}.rate (current rate) is required`);

  const graceType = GRACE_TYPES.includes(raw?.grace?.type) ? raw.grace.type : 'none';
  const graceEndDate = optionalDate(raw?.grace?.endDate, `${field}.grace.endDate`);
  if (graceType !== 'none' && !graceEndDate) throw serviceError(400, `${field}.grace.endDate is required`);

  const anchorDate = optionalDate(raw?.anchor?.date, `${field}.anchor.date`);
  const anchorBalance = optionalNumber(raw?.anchor?.balance, `${field}.anchor.balance`, { min: 0, max: 1e9 });
  if ((anchorDate === null) !== (anchorBalance === null)) {
    throw serviceError(400, `${field}.anchor needs both a date and a balance`);
  }

  return {
    type,
    label: optionalText(raw?.label, 120),
    rate,
    margin,
    rateConvention: raw?.rateConvention === 'effective' ? 'effective' : 'nominal',
    resetPeriodMonths: VARIABLE_TYPES.has(type)
      ? optionalNumber(raw?.resetPeriodMonths, `${field}.resetPeriodMonths`, { min: 1, max: 360 }) ?? 60
      : null,
    anchorSeriesKey: optionalText(raw?.anchorSeriesKey, 80),
    amortization: AMORTIZATIONS.includes(raw?.amortization) ? raw.amortization : 'spitzer',
    termMonths: Math.round(requiredNumber(raw?.termMonths, `${field}.termMonths`, { min: 1, max: 600 })),
    paymentDay: optionalNumber(raw?.paymentDay, `${field}.paymentDay`, { min: 1, max: 31 }),
    firstPaymentDate: optionalDate(raw?.firstPaymentDate, `${field}.firstPaymentDate`),
    grace: { type: graceType, endDate: graceType === 'none' ? null : graceEndDate },
    cpiFloorAtBase: Boolean(raw?.cpiFloorAtBase),
    anchor: anchorDate
      ? {
        date: anchorDate,
        balance: anchorBalance,
        remainingMonths: optionalNumber(raw?.anchor?.remainingMonths, `${field}.anchor.remainingMonths`, { min: 1, max: 600 }),
        payment: optionalNumber(raw?.anchor?.payment, `${field}.anchor.payment`, { min: 0, max: 1e8 }),
      }
      : null,
    status: ['active', 'closed', 'refinanced'].includes(raw?.status) ? raw.status : 'active',
    tranches: normalizedTranches,
  };
}

function normalizeEventPayload(raw, index, trackCount) {
  const field = `events[${index}]`;
  const type = String(raw?.type || '');
  if (!EVENT_TYPES.includes(type)) throw serviceError(400, `${field}.type is not supported`);
  const date = optionalDate(raw?.date, `${field}.date`);
  if (!date) throw serviceError(400, `${field}.date is required`);
  const trackIndex = raw?.trackIndex === null || raw?.trackIndex === undefined ? null : Number(raw.trackIndex);
  if (trackIndex !== null && (!Number.isInteger(trackIndex) || trackIndex < 0 || trackIndex >= trackCount)) {
    throw serviceError(400, `${field}.trackIndex does not match a track`);
  }
  if (type !== 'refinance' && trackIndex === null) throw serviceError(400, `${field}.trackIndex is required`);
  const amount = optionalNumber(raw?.amount, `${field}.amount`, { min: 0, max: 1e9 });
  if (type === 'prepay_partial' && !(amount > 0)) throw serviceError(400, `${field}.amount is required`);
  const rate = optionalNumber(raw?.rate, `${field}.rate`, { min: -5, max: 30 });
  if (type === 'rate_override' && rate === null) throw serviceError(400, `${field}.rate is required`);
  const closeTrackIndexes = Array.isArray(raw?.closeTrackIndexes)
    ? raw.closeTrackIndexes.map(Number).filter((value) => Number.isInteger(value) && value >= 0 && value < trackCount)
    : null;
  return {
    type,
    date,
    trackIndex,
    amount,
    mode: type === 'prepay_partial' ? (raw?.mode === 'reduce_term' ? 'reduce_term' : 'reduce_payment') : null,
    fee: optionalNumber(raw?.fee, `${field}.fee`, { min: 0, max: 1e8 }),
    rate,
    closeTrackIndexes,
    notes: optionalText(raw?.notes, 500),
  };
}

function normalizeMortgagePayload(payload = {}) {
  const tracks = Array.isArray(payload.tracks) ? payload.tracks : [];
  if (tracks.length === 0) throw serviceError(400, 'At least one track is required');
  if (tracks.length > MAX_TRACKS) throw serviceError(400, `At most ${MAX_TRACKS} tracks are supported`);
  const normalizedTracks = tracks.map(normalizeTrackPayload);
  const events = Array.isArray(payload.events) ? payload.events : [];
  if (events.length > MAX_EVENTS) throw serviceError(400, 'Too many events');
  const approvedAmount = optionalNumber(payload.approvedAmount, 'approvedAmount', { min: 0, max: 1e10 });
  const totalTranches = normalizedTracks.reduce(
    (sum, track) => sum + track.tranches.reduce((acc, tranche) => acc + tranche.amount, 0),
    0,
  );
  if (approvedAmount !== null && totalTranches > approvedAmount * 1.001 + 1) {
    throw serviceError(400, 'Drawdowns exceed the approved loan amount');
  }
  const brokenPeriodInterest = ['actual_days', 'separate'].includes(payload.options?.brokenPeriodInterest)
    ? payload.options.brokenPeriodInterest
    : 'monthly';
  return {
    lender: optionalText(payload.lender, 120),
    label: optionalText(payload.label, 120),
    approvedAmount,
    options: { brokenPeriodInterest, primeChangeLagMonths: Number(payload.options?.primeChangeLagMonths) === 1 ? 1 : 0 },
    paymentMatch: {
      vendor: optionalText(payload.paymentMatch?.vendor, 120),
      accountNumber: optionalText(payload.paymentMatch?.accountNumber, 60),
      pattern: optionalText(payload.paymentMatch?.pattern, 200),
    },
    notes: optionalText(payload.notes, 2000),
    tracks: normalizedTracks,
    events: events.map((event, index) => normalizeEventPayload(event, index, normalizedTracks.length)),
  };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function mapTrackRow(row, tranches) {
  return {
    id: Number(row.id),
    type: row.track_type,
    label: row.label,
    rate: row.rate,
    margin: row.margin,
    rateConvention: row.rate_convention,
    resetPeriodMonths: row.reset_period_months,
    anchorSeriesKey: row.anchor_series_key,
    amortization: row.amortization,
    termMonths: row.term_months,
    paymentDay: row.payment_day,
    firstPaymentDate: row.first_payment_date,
    grace: { type: row.grace_type, endDate: row.grace_end_date },
    cpiFloorAtBase: Boolean(row.cpi_floor_at_base),
    anchor: row.anchor_date
      ? {
        date: row.anchor_date,
        balance: row.anchor_balance,
        remainingMonths: row.anchor_remaining_months,
        payment: row.anchor_payment,
      }
      : null,
    status: row.status,
    tranches: tranches.map((tranche) => ({
      id: Number(tranche.id),
      drawDate: tranche.draw_date,
      amount: tranche.amount,
      status: tranche.status,
      rate: tranche.rate,
      termMode: tranche.term_mode,
      termMonths: tranche.term_months,
      notes: tranche.notes,
    })),
  };
}

async function getMortgageForAccount(accountId) {
  await ensureSchema();
  const loanResult = await database.query(
    'SELECT * FROM mortgage_loans WHERE account_id = $1 ORDER BY id ASC LIMIT 1',
    [accountId],
  );
  const loan = loanResult.rows?.[0];
  if (!loan) return null;

  const trackRows = (await database.query(
    'SELECT * FROM mortgage_tracks WHERE loan_id = $1 ORDER BY sort_order ASC, id ASC',
    [loan.id],
  )).rows || [];
  const trancheRows = trackRows.length
    ? (await database.query(
      `SELECT d.* FROM mortgage_track_drawdowns d
         JOIN mortgage_tracks t ON t.id = d.track_id
        WHERE t.loan_id = $1
        ORDER BY d.draw_date ASC, d.id ASC`,
      [loan.id],
    )).rows || []
    : [];
  const eventRows = (await database.query(
    'SELECT * FROM mortgage_events WHERE loan_id = $1 ORDER BY event_date ASC, id ASC',
    [loan.id],
  )).rows || [];

  return mortgageFromRows(loan, trackRows, trancheRows, eventRows);
}

/** Pure: database rows → stored mortgage structure (shared with the sync forecast loader). */
function mortgageFromRows(loan, trackRows, trancheRows, eventRows) {
  const tracks = trackRows.map((row) => mapTrackRow(
    row,
    trancheRows.filter((tranche) => Number(tranche.track_id) === Number(row.id)),
  ));
  const indexById = new Map(tracks.map((track, index) => [track.id, index]));
  const options = parseJson(loan.options_json, {});

  return {
    id: Number(loan.id),
    accountId: Number(loan.account_id),
    lender: loan.lender,
    label: loan.label,
    approvedAmount: loan.approved_amount,
    currency: loan.currency,
    status: loan.status,
    options: {
      brokenPeriodInterest: ['actual_days', 'separate'].includes(options.brokenPeriodInterest) ? options.brokenPeriodInterest : 'monthly',
      primeChangeLagMonths: Number(options.primeChangeLagMonths) === 1 ? 1 : 0,
    },
    paymentMatch: {
      vendor: loan.payment_match_vendor,
      accountNumber: loan.payment_match_account_number,
      pattern: loan.payment_match_pattern,
    },
    notes: loan.notes,
    updatedAt: loan.updated_at,
    tracks,
    events: eventRows.map((row) => {
      const payload = parseJson(row.payload_json, {});
      const trackId = row.track_id === null || row.track_id === undefined ? null : Number(row.track_id);
      return {
        id: Number(row.id),
        type: row.event_type,
        date: row.event_date,
        trackId,
        trackIndex: trackId === null ? null : (indexById.get(trackId) ?? null),
        amount: row.amount,
        mode: row.mode,
        fee: row.fee_paid,
        rate: row.rate,
        closeTrackIndexes: Array.isArray(payload.closeTrackIndexes) ? payload.closeTrackIndexes : null,
        notes: row.notes,
      };
    }),
  };
}

async function withTransaction(run) {
  const client = typeof database.getClient === 'function'
    ? await database.getClient()
    : { query: (...args) => database.query(...args), release: () => {} };
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (_rollbackError) {
      // Preserve the original error.
    }
    throw error;
  } finally {
    client.release?.();
  }
}

async function deleteLoansForAccount(client, accountId) {
  const loans = (await client.query('SELECT id FROM mortgage_loans WHERE account_id = $1', [accountId])).rows || [];
  for (const loan of loans) {
    // Explicit deletes: foreign_keys may be off on some connections.
    await client.query('DELETE FROM mortgage_events WHERE loan_id = $1', [loan.id]);
    await client.query(
      'DELETE FROM mortgage_track_drawdowns WHERE track_id IN (SELECT id FROM mortgage_tracks WHERE loan_id = $1)',
      [loan.id],
    );
    await client.query('DELETE FROM mortgage_tracks WHERE loan_id = $1', [loan.id]);
    await client.query('DELETE FROM mortgage_loans WHERE id = $1', [loan.id]);
  }
}

/** Replace the whole loan structure of an account (validated, transactional). */
async function replaceMortgageForAccount(accountId, payload) {
  const normalized = normalizeMortgagePayload(payload);
  await ensureSchema();
  await withTransaction(async (client) => {
    await deleteLoansForAccount(client, accountId);
    const loanResult = await client.query(
      `INSERT INTO mortgage_loans (
         account_id, lender, label, approved_amount, options_json,
         payment_match_vendor, payment_match_account_number, payment_match_pattern, notes
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        accountId,
        normalized.lender,
        normalized.label,
        normalized.approvedAmount,
        JSON.stringify(normalized.options),
        normalized.paymentMatch.vendor,
        normalized.paymentMatch.accountNumber,
        normalized.paymentMatch.pattern,
        normalized.notes,
      ],
    );
    const loanId = loanResult.rows?.[0]?.id;
    if (!loanId) throw serviceError(500, 'Failed to create mortgage loan');

    const trackIds = [];
    for (const [index, track] of normalized.tracks.entries()) {
      const trackResult = await client.query(
        `INSERT INTO mortgage_tracks (
           loan_id, track_type, label, rate, margin, rate_convention, reset_period_months,
           anchor_series_key, amortization, term_months, payment_day, first_payment_date,
           grace_type, grace_end_date, cpi_floor_at_base, anchor_date, anchor_balance,
           anchor_remaining_months, anchor_payment, status, sort_order
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
         RETURNING id`,
        [
          loanId,
          track.type,
          track.label,
          track.rate,
          track.margin,
          track.rateConvention,
          track.resetPeriodMonths,
          track.anchorSeriesKey,
          track.amortization,
          track.termMonths,
          track.paymentDay,
          track.firstPaymentDate,
          track.grace.type,
          track.grace.endDate,
          track.cpiFloorAtBase ? 1 : 0,
          track.anchor?.date ?? null,
          track.anchor?.balance ?? null,
          track.anchor?.remainingMonths ?? null,
          track.anchor?.payment ?? null,
          track.status,
          index,
        ],
      );
      const trackId = trackResult.rows?.[0]?.id;
      trackIds.push(trackId);
      for (const tranche of track.tranches) {
        await client.query(
          `INSERT INTO mortgage_track_drawdowns (
             track_id, draw_date, amount, status, rate, term_mode, term_months, notes
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [trackId, tranche.drawDate, tranche.amount, tranche.status, tranche.rate, tranche.termMode, tranche.termMonths, tranche.notes],
        );
      }
    }

    for (const event of normalized.events) {
      await client.query(
        `INSERT INTO mortgage_events (
           loan_id, track_id, event_type, event_date, amount, mode, fee_paid, rate, payload_json, notes
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          loanId,
          event.trackIndex === null ? null : trackIds[event.trackIndex],
          event.type,
          event.date,
          event.amount,
          event.mode,
          event.fee,
          event.rate,
          event.closeTrackIndexes ? JSON.stringify({ closeTrackIndexes: event.closeTrackIndexes }) : null,
          event.notes,
        ],
      );
    }
  });
  return getMortgageForAccount(accountId);
}

async function deleteMortgageForAccount(accountId) {
  await ensureSchema();
  await withTransaction((client) => deleteLoansForAccount(client, accountId));
  return { deleted: true };
}

// ---------------------------------------------------------------------------
// Property settings (usage / sale assumptions) and purchase costs
// ---------------------------------------------------------------------------

const USAGE_TYPES = ['owner_occupied', 'rented', 'vacant'];
const VALUE_INDEX_SERIES = [
  'cbs.hpi.national', 'cbs.hpi.new_dwellings', 'cbs.hpi.district.jerusalem', 'cbs.hpi.district.north',
  'cbs.hpi.district.haifa', 'cbs.hpi.district.center', 'cbs.hpi.district.tel_aviv', 'cbs.hpi.district.south',
];
const COST_TYPES = ['down_payment', 'purchase_tax', 'lawyer', 'broker', 'appraisal', 'renovation', 'mortgage_fees', 'other'];
const NUMERIC_SETTINGS = {
  marketRent: [0, 1e6], rentGrowthPct: [-20, 30], vacancyPct: [0, 100], rentalTaxPct: [0, 60],
  alternativeReturnPct: [-20, 30], alternativeTaxPct: [0, 60], brokerPct: [0, 10], lawyerPct: [0, 10],
  vatPct: [0, 50], otherSaleCosts: [0, 1e8], capitalGainsTaxPct: [0, 60], monthlyIncomeOverride: [0, 1e8],
};

async function getPropertySettings(accountId) {
  await ensureSchema();
  const row = (await database.query('SELECT * FROM real_estate_property_settings WHERE account_id = $1', [accountId])).rows?.[0];
  const extra = parseJson(row?.settings_json, {});
  return {
    usageType: row?.usage_type || 'owner_occupied',
    isOffPlan: Boolean(row?.is_off_plan),
    deliveryDate: row?.delivery_date || null,
    ...extra,
    stored: Boolean(row),
  };
}

function normalizeSettingsPayload(payload = {}) {
  const extra = {};
  for (const [key, [min, max]] of Object.entries(NUMERIC_SETTINGS)) {
    const value = optionalNumber(payload[key], key, { min, max });
    if (value !== null) extra[key] = value;
  }
  if (VALUE_INDEX_SERIES.includes(payload.valueIndexSeries)) extra.valueIndexSeries = payload.valueIndexSeries;
  if (payload.singleApartmentExemption !== undefined && payload.singleApartmentExemption !== null) {
    extra.singleApartmentExemption = Boolean(payload.singleApartmentExemption);
  }
  return {
    usageType: USAGE_TYPES.includes(payload.usageType) ? payload.usageType : 'owner_occupied',
    isOffPlan: Boolean(payload.isOffPlan),
    deliveryDate: optionalDate(payload.deliveryDate, 'deliveryDate'),
    extra,
  };
}

async function replacePropertySettings(accountId, payload) {
  const normalized = normalizeSettingsPayload(payload);
  await ensureSchema();
  await database.query(
    `INSERT INTO real_estate_property_settings (account_id, usage_type, is_off_plan, delivery_date, settings_json, updated_at)
     VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
     ON CONFLICT (account_id) DO UPDATE SET
       usage_type = excluded.usage_type, is_off_plan = excluded.is_off_plan,
       delivery_date = excluded.delivery_date, settings_json = excluded.settings_json,
       updated_at = CURRENT_TIMESTAMP`,
    [accountId, normalized.usageType, normalized.isOffPlan ? 1 : 0, normalized.deliveryDate, JSON.stringify(normalized.extra)],
  );
  return getPropertySettings(accountId);
}

async function listPropertyCosts(accountId) {
  await ensureSchema();
  const rows = (await database.query(
    'SELECT * FROM real_estate_property_costs WHERE account_id = $1 ORDER BY cost_date ASC, id ASC',
    [accountId],
  )).rows || [];
  return rows.map((row) => ({
    id: Number(row.id),
    type: row.cost_type,
    label: row.label,
    amount: Number(row.amount),
    date: row.cost_date,
    status: row.status,
    deductible: Boolean(row.deductible),
    notes: row.notes,
  }));
}

async function replacePropertyCosts(accountId, payload) {
  const costs = Array.isArray(payload) ? payload : (Array.isArray(payload?.costs) ? payload.costs : []);
  if (costs.length > 100) throw serviceError(400, 'Too many costs');
  const normalized = costs.map((cost, index) => {
    const field = `costs[${index}]`;
    if (!COST_TYPES.includes(cost?.type)) throw serviceError(400, `${field}.type is not supported`);
    return {
      type: cost.type,
      label: optionalText(cost.label, 120),
      amount: requiredNumber(cost.amount, `${field}.amount`, { min: 0, max: 1e9 }),
      date: optionalDate(cost.date, `${field}.date`),
      status: cost.status === 'planned' ? 'planned' : 'paid',
      deductible: cost.deductible === undefined ? cost.type !== 'down_payment' && cost.type !== 'mortgage_fees' : Boolean(cost.deductible),
      notes: optionalText(cost.notes, 500),
    };
  });
  await ensureSchema();
  await withTransaction(async (client) => {
    await client.query('DELETE FROM real_estate_property_costs WHERE account_id = $1', [accountId]);
    for (const cost of normalized) {
      await client.query(
        `INSERT INTO real_estate_property_costs (account_id, cost_type, label, amount, cost_date, status, deductible, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [accountId, cost.type, cost.label, cost.amount, cost.date, cost.status, cost.deductible ? 1 : 0, cost.notes],
      );
    }
  });
  return listPropertyCosts(accountId);
}

/** Save (or clear) which bank debits are this loan's payments. */
async function updatePaymentMatcher(accountId, matcher) {
  await ensureSchema();
  const pattern = optionalText(matcher?.pattern, 200);
  const result = await database.query(
    `UPDATE mortgage_loans
        SET payment_match_vendor = $1, payment_match_account_number = $2, payment_match_pattern = $3,
            updated_at = CURRENT_TIMESTAMP
      WHERE account_id = $4
      RETURNING id`,
    [pattern ? optionalText(matcher?.vendor, 120) : null, pattern ? optionalText(matcher?.accountNumber, 60) : null, pattern, accountId],
  );
  if (!result.rows?.length) throw serviceError(404, 'No mortgage tracks saved for this property');
  return getMortgageForAccount(accountId);
}

/** Convert a stored (or draft, normalized) mortgage into engine input. */
function toEngineInput(mortgage) {
  const tracks = (mortgage?.tracks || []).map((track, index) => ({
    id: String(track.id ?? `track-${index}`),
    label: track.label,
    type: track.type,
    rate: track.rate,
    margin: track.margin,
    rateConvention: track.rateConvention,
    resetPeriodMonths: track.resetPeriodMonths,
    anchorKey: track.anchorSeriesKey || null,
    amortization: track.amortization,
    termMonths: track.termMonths,
    paymentDay: track.paymentDay,
    firstPaymentDate: track.firstPaymentDate,
    grace: track.grace,
    cpiFloorAtBase: track.cpiFloorAtBase,
    anchor: track.anchor,
    tranches: (track.tranches || []).map((tranche, trancheIndex) => ({
      id: String(tranche.id ?? `${index}-${trancheIndex}`),
      drawDate: tranche.drawDate,
      amount: tranche.amount,
      status: tranche.status,
      rate: tranche.rate,
      termMode: tranche.termMode,
      termMonths: tranche.termMonths,
    })),
  }));
  const trackIdAt = (index) => (index === null || index === undefined ? null : tracks[index]?.id ?? null);
  const events = (mortgage?.events || []).map((event, index) => ({
    id: String(event.id ?? `event-${index}`),
    type: event.type,
    date: event.date,
    trackId: trackIdAt(event.trackIndex),
    amount: event.amount,
    mode: event.mode,
    fee: event.fee,
    rate: event.rate,
    payload: event.closeTrackIndexes
      ? { closeTrackIds: event.closeTrackIndexes.map(trackIdAt).filter(Boolean) }
      : undefined,
  }));
  return { tracks, events, options: mortgage?.options || {} };
}

module.exports = {
  COST_TYPES,
  USAGE_TYPES,
  VALUE_INDEX_SERIES,
  deleteMortgageForAccount,
  ensureSchema,
  getMortgageForAccount,
  getPropertySettings,
  listPropertyCosts,
  mortgageFromRows,
  replacePropertyCosts,
  replacePropertySettings,
  updatePaymentMatcher,
  normalizeMortgagePayload,
  replaceMortgageForAccount,
  toEngineInput,
  __setDatabase(mockDatabase) {
    database = mockDatabase || actualDatabase;
    schemaPromise = null;
  },
  __resetDatabase() {
    database = actualDatabase;
    schemaPromise = null;
  },
};
