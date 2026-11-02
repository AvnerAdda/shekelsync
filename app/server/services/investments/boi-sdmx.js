'use strict';

// Shared helpers for the Bank of Israel SDMX REST service (CSV format).

const BOI_SDMX_BASE = 'https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS';

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      values.push(current);
      current = '';
    } else {
      current += character;
    }
  }
  values.push(current);
  return values;
}

/**
 * Parse a BoI SDMX CSV payload into observations.
 * Rows arrive grouped by series (not sorted), so callers group by seriesCode.
 * @returns {Array<{seriesCode: string, period: string, value: number}>}
 */
function parseSdmxCsv(csvText) {
  const lines = String(csvText || '').replace(/^﻿/, '').trim().split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]);
  const seriesIndex = headers.indexOf('SERIES_CODE');
  const periodIndex = headers.indexOf('TIME_PERIOD');
  const valueIndex = headers.indexOf('OBS_VALUE');
  const unitMultiplierIndex = headers.indexOf('UNIT_MULT');
  if ([seriesIndex, periodIndex, valueIndex].some((index) => index < 0)) {
    const error = new Error('Bank of Israel response did not contain the expected SDMX columns');
    error.status = 502;
    throw error;
  }
  const observations = [];
  for (const line of lines.slice(1)) {
    const values = parseCsvLine(line);
    const raw = values[valueIndex];
    if (raw === undefined || raw === '' || raw === 'NaN') continue;
    const multiplier = unitMultiplierIndex < 0 || values[unitMultiplierIndex] === ''
      ? 0
      : Number(values[unitMultiplierIndex]) || 0;
    const value = Number(raw) / (10 ** multiplier);
    if (!Number.isFinite(value)) continue;
    observations.push({ seriesCode: values[seriesIndex], period: values[periodIndex], value });
  }
  return observations;
}

/** Build a data URL for one dataflow and one or more series codes (path key). */
function buildBoiSeriesUrl(dataflow, seriesCodes, params = {}) {
  const codes = Array.isArray(seriesCodes) ? seriesCodes : [seriesCodes];
  const url = new URL(`${BOI_SDMX_BASE}/${dataflow}/1.0/${codes.join('+')}`);
  url.searchParams.set('format', 'csv');
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  // The BoI service expects literal commas between series codes; a
  // percent-encoded %2C (or +) returns HTTP 404.
  url.href = url.href.replace(/\+/g, ',').replace(/%2C/gi, ',');
  return url;
}

module.exports = {
  BOI_SDMX_BASE,
  buildBoiSeriesUrl,
  parseCsvLine,
  parseSdmxCsv,
};
