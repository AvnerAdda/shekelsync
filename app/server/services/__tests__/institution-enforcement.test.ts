import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';

const mockMapVendorCodeToInstitutionId = vi.fn();
const mockGetInstitutionById = vi.fn();

const databaseModuleMock = vi.hoisted(() => ({
  query: vi.fn(),
  getClient: vi.fn(() => ({ query: vi.fn(), release: vi.fn() })),
}));

vi.mock('../database.js', () => databaseModuleMock);
vi.mock('../../../lib/create-db-pool.js', () => ({
  __esModule: true,
  default: vi.fn(() => ({
    query: vi.fn(),
    connect: vi.fn(),
    close: vi.fn(),
    _db: {},
  })),
}));
vi.mock('../../../lib/better-sqlite3-wrapper.js', () => ({
  __esModule: true,
  default: vi.fn(() => ({})),
}));
vi.mock(
  'better-sqlite3',
  () => {
    const mockConstructor = vi.fn(() => ({}));
    return {
      __esModule: true,
      default: mockConstructor,
    };
  },
  { virtual: true },
);
vi.mock('../institutions.js', () => ({
  mapVendorCodeToInstitutionId: mockMapVendorCodeToInstitutionId,
  getInstitutionById: mockGetInstitutionById,
  INSTITUTION_JOIN_VENDOR_CRED: '',
  INSTITUTION_SELECT_FIELDS: '',
  INSTITUTION_JOIN_INVESTMENT_ACCOUNT: '',
}));
vi.mock('../../../lib/server/encryption.js', () => ({
  encrypt: (value: string) => `enc_${value}`,
  decrypt: (value: string) => value,
}));

let credentialsService: typeof import('../credentials.js');
let investmentAccountsService: typeof import('../investments/accounts.js');

async function loadServices() {
  credentialsService = await import('../credentials.js');
  investmentAccountsService = await import('../investments/accounts.js');
}

const originalStubEnv = process.env.BETTER_SQLITE3_STUB;

beforeAll(async () => {
  process.env.BETTER_SQLITE3_STUB = 'true';
  await loadServices();
});

afterAll(() => {
  if (originalStubEnv === undefined) {
    delete process.env.BETTER_SQLITE3_STUB;
  } else {
    process.env.BETTER_SQLITE3_STUB = originalStubEnv;
  }
});

describe('institution enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    return loadServices();
  });

  it('rejects credential creation when institution cannot be resolved', async () => {
    mockMapVendorCodeToInstitutionId.mockResolvedValueOnce(null);

    await expect(credentialsService.createCredential({ vendor: 'unknown', nickname: 'Test' }))
      .rejects.toThrow('Unknown institution');
    expect(databaseModuleMock.query).not.toHaveBeenCalled();
  });

  it('rejects investment account creation when institution cannot be resolved', async () => {
    mockMapVendorCodeToInstitutionId.mockResolvedValueOnce(null);

    await expect(
      investmentAccountsService.createAccount({
        account_name: 'My Account',
        account_type: 'brokerage',
      }),
    ).rejects.toThrow('institution_id is required');
    expect(databaseModuleMock.query).not.toHaveBeenCalled();
  });
});
