function toNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function compareHoldingsBySnapshot(left, right) {
  const leftDate = String(left?.as_of_date || '');
  const rightDate = String(right?.as_of_date || '');
  if (leftDate !== rightDate) {
    return rightDate.localeCompare(leftDate);
  }

  return Number(right?.id || 0) - Number(left?.id || 0);
}

function addNullableNumbers(left, right) {
  const leftValue = toNumber(left);
  const rightValue = toNumber(right);
  if (leftValue === null && rightValue === null) {
    return null;
  }
  return (leftValue || 0) + (rightValue || 0);
}

function buildCurrentHoldingSnapshot(holdingsRows = []) {
  if (!Array.isArray(holdingsRows) || holdingsRows.length === 0) {
    return {
      current_value: null,
      cost_basis: null,
      as_of_date: null,
      uses_pikadon_rollup: false,
    };
  }

  const activePikadonRows = holdingsRows.filter((row) =>
    String(row?.holding_type || 'standard') === 'pikadon'
    && String(row?.status || 'active') === 'active',
  );

  if (activePikadonRows.length > 0) {
    const currentValue = activePikadonRows.reduce((sum, row) => {
      const value = toNumber(row.current_value);
      const fallback = toNumber(row.cost_basis);
      return sum + (value ?? fallback ?? 0);
    }, 0);
    const costBasis = activePikadonRows.reduce((sum, row) => {
      const value = toNumber(row.cost_basis);
      const fallback = toNumber(row.current_value);
      return sum + (value ?? fallback ?? 0);
    }, 0);
    const asOfDate = activePikadonRows.reduce((latest, row) => {
      const date = row?.as_of_date || null;
      if (!date) return latest;
      if (!latest || String(date) > String(latest)) {
        return String(date);
      }
      return latest;
    }, null);

    const standardRows = holdingsRows.filter((row) => String(row?.holding_type || 'standard') !== 'pikadon');
    const latestStandard = [...standardRows].sort(compareHoldingsBySnapshot)[0] || null;

    return {
      current_value: addNullableNumbers(currentValue, latestStandard?.current_value),
      cost_basis: addNullableNumbers(costBasis, latestStandard?.cost_basis),
      as_of_date: latestStandard?.as_of_date && String(latestStandard.as_of_date) > String(asOfDate || '')
        ? latestStandard.as_of_date
        : asOfDate,
      uses_pikadon_rollup: true,
    };
  }

  const standardRows = holdingsRows.filter((row) => String(row?.holding_type || 'standard') !== 'pikadon');
  const sourceRows = standardRows.length > 0 ? standardRows : holdingsRows;
  const latest = [...sourceRows].sort(compareHoldingsBySnapshot)[0];

  if (!latest) {
    return {
      current_value: null,
      cost_basis: null,
      as_of_date: null,
      uses_pikadon_rollup: false,
    };
  }

  return {
    current_value: toNumber(latest.current_value),
    cost_basis: toNumber(latest.cost_basis),
    as_of_date: latest.as_of_date || null,
    uses_pikadon_rollup: false,
  };
}

module.exports = {
  buildCurrentHoldingSnapshot,
  toNumber,
};

module.exports.default = module.exports;
