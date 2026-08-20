import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const mockMapVendorCodeToInstitutionId = vi.fn();
const mockGetInstitutionById = vi.fn();
const mockGetInstitutionByVendorCode = vi.fn();
const mockBuildInstitutionFromRow = vi.fn((row) => (
  row?.institution_id ? { id: row.institution_id } : null
));

const databaseModuleMock = vi.hoisted(() => ({
  query: vi.fn(),
  getClient: vi.fn(() => ({ query: vi.fn(), release: vi.fn() })),
}));

vi.mock('../database.js', () => databaseModuleMock);
const mockPool = {
  query: vi.fn(),
  connect: vi.fn(),
  close: vi.fn(),
  _db: {},
};
const mockCreateDbPool = vi.fn(() => mockPool);
vi.mock('../../../lib/create-db-pool.js', () => mockCreateDbPool);
vi.mock('../../../lib/sqlite-pool.js', () => ({
  __esModule: true,
  default: vi.fn(() => mockPool),
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
  getInstitutionByVendorCode: mockGetInstitutionByVendorCode,
  buildInstitutionFromRow: mockBuildInstitutionFromRow,
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
const tmpDbPath = path.join(os.tmpdir(), 'clarify-test.sqlite');

beforeAll(async () => {
  process.env.BETTER_SQLITE3_STUB = 'true';
  process.env.SQLITE_DB_PATH = tmpDbPath;
  if (!fs.existsSync(tmpDbPath)) {
    fs.writeFileSync(tmpDbPath, '');
  }
  await loadServices();
});

afterAll(() => {
  if (originalStubEnv === undefined) {
    delete process.env.BETTER_SQLITE3_STUB;
  } else {
    process.env.BETTER_SQLITE3_STUB = originalStubEnv;
  }
  delete process.env.SQLITE_DB_PATH;
  if (fs.existsSync(tmpDbPath)) {
    fs.unlinkSync(tmpDbPath);
  }
});

describe('institution enforcement', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    await loadServices();
    credentialsService.__setDatabase(databaseModuleMock);
    credentialsService.__setInstitutionsModule({
      mapVendorCodeToInstitutionId: mockMapVendorCodeToInstitutionId,
      getInstitutionById: mockGetInstitutionById,
      buildInstitutionFromRow: mockBuildInstitutionFromRow,
      INSTITUTION_JOIN_VENDOR_CRED: '',
      INSTITUTION_SELECT_FIELDS: '',
    });
    investmentAccountsService.__setDatabase(databaseModuleMock);
  });

  it('rejects credential creation when institution cannot be resolved', async () => {
    mockMapVendorCodeToInstitutionId.mockResolvedValueOnce(null);

    await expect(credentialsService.createCredential({ vendor: 'unknown', nickname: 'Test' }))
      .rejects.toThrow('Unknown institution');
    expect(databaseModuleMock.query).not.toHaveBeenCalled();
  });

  it('allows a custom investment account when institution cannot be resolved', async () => {
    mockMapVendorCodeToInstitutionId.mockResolvedValueOnce(null);
    mockGetInstitutionByVendorCode.mockResolvedValueOnce(null);
    databaseModuleMock.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM institution_nodes')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO investment_accounts')) {
        return { rows: [{ id: 71 }] };
      }
      if (sql.includes('FROM investment_accounts ia')) {
        return {
          rows: [{
            id: 71,
            account_name: 'My Account',
            account_type: 'brokerage',
            institution: 'Independent Broker',
            institution_id: null,
          }],
        };
      }
      throw new Error(`Unexpected query in custom institution test: ${sql.slice(0, 120)}`);
    });

    const result = await investmentAccountsService.createAccount({
      account_name: 'My Account',
      account_type: 'brokerage',
      institution: 'Independent Broker',
    });

    expect(result.account).toMatchObject({
      id: 71,
      account_type: 'brokerage',
      institution_id: null,
      institution: 'Independent Broker',
    });
    expect(databaseModuleMock.query).toHaveBeenCalled();
  });
});
