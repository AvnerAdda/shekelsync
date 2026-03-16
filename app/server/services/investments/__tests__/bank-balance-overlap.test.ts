import { beforeAll, describe, expect, it } from 'vitest';

let applyBankBalanceOverlapAdjustments: any;
let buildBankBalanceOverlapAdjustmentMap: any;

beforeAll(async () => {
  const module = await import('../bank-balance-overlap.js');
  ({
    applyBankBalanceOverlapAdjustments,
    buildBankBalanceOverlapAdjustmentMap,
  } = module.default ?? module);
});

describe('bank balance overlap helper', () => {

  it('subtracts overlapping Pikadon balances from the matching bank balance account', () => {
    const accounts = [
      {
        id: 1,
        account_type: 'bank_balance',
        account_number: '1234',
        institution_id: 18,
        institution: { vendor_code: 'discount' },
        current_value: 705476.03,
        cost_basis: 705476.03,
      },
      {
        id: 2,
        account_type: 'savings',
        institution_id: 18,
        institution: { vendor_code: 'discount' },
        current_value: 680000,
        cost_basis: 680000,
      },
    ];
    const sources = [
      {
        institution_id: 18,
        source_vendor_code: 'discount',
        source_account_number: '1234',
        active_value: '680000',
      },
    ];

    const adjustments = buildBankBalanceOverlapAdjustmentMap(accounts, sources);
    const adjustedAccounts = applyBankBalanceOverlapAdjustments(accounts, sources);

    expect(adjustments.get(1)).toBe(680000);
    expect(adjustedAccounts[0]).toMatchObject({
      current_value: 25476.03,
      cost_basis: 25476.03,
    });
    expect(adjustedAccounts[1]).toMatchObject({
      current_value: 680000,
      cost_basis: 680000,
    });
  });

  it('does not subtract by vendor alone when multiple bank balance accounts would be ambiguous', () => {
    const accounts = [
      {
        id: 1,
        account_type: 'bank_balance',
        institution: { vendor_code: 'discount' },
        current_value: 1000,
        cost_basis: 1000,
      },
      {
        id: 2,
        account_type: 'bank_balance',
        institution: { vendor_code: 'discount' },
        current_value: 2000,
        cost_basis: 2000,
      },
    ];
    const sources = [
      {
        source_vendor_code: 'discount',
        active_value: '500',
      },
    ];

    const adjustments = buildBankBalanceOverlapAdjustmentMap(accounts, sources);
    const adjustedAccounts = applyBankBalanceOverlapAdjustments(accounts, sources);

    expect(adjustments.size).toBe(0);
    expect(adjustedAccounts).toEqual(accounts);
  });

  it('does not subtract when the bank balance is smaller than the active Pikadon amount', () => {
    const accounts = [
      {
        id: 1,
        account_type: 'bank_balance',
        account_number: '0162490242',
        institution_id: 16,
        institution: { vendor_code: 'discount' },
        current_value: 25476.03,
        cost_basis: 25476.03,
      },
      {
        id: 2,
        account_type: 'savings',
        account_number: null,
        institution_id: 16,
        institution: { vendor_code: 'discount' },
        current_value: 680400,
        cost_basis: 680400,
      },
    ];
    const sources = [
      {
        institution_id: 16,
        source_vendor_code: 'discount',
        source_account_number: '0162490242',
        active_value: '680400',
      },
    ];

    const adjustedAccounts = applyBankBalanceOverlapAdjustments(accounts, sources);

    expect(adjustedAccounts).toEqual(accounts);
  });
});
