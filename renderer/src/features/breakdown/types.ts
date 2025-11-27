export type CategoryType = 'expense' | 'income' | 'investment';

export interface Subcategory {
  id: number;
  name: string;
  color?: string | null;
  icon?: string | null;
  description?: string | null;
  count: number;
  total: number;
}

export interface TrendHistoryPoint {
  month: string;
  total: number;
}

export interface CategoryBreakdownItem {
  parentId: number;
  category: string;
  color?: string | null;
  icon?: string | null;
  description?: string | null;
  total: number;
  count: number;
  previousTotal?: number;
  previousCount?: number;
  history?: TrendHistoryPoint[];
  subcategories: Subcategory[];
}

export interface VendorInstitution {
  id: number;
  vendor_code: string;
  display_name_he: string;
  display_name_en: string;
  logo_url?: string;
  institution_type: string;
}

export interface VendorBreakdownItem {
  vendor: string;
  total: number;
  count: number;
  previousTotal?: number;
  previousCount?: number;
  history?: TrendHistoryPoint[];
  institution?: VendorInstitution;
}

export interface MonthlyBreakdownItem {
  month: string;
  total: number;
  inflow?: number;
  outflow?: number;
}

export interface BreakdownData {
  byCategory: CategoryBreakdownItem[];
  byVendor: VendorBreakdownItem[];
  byMonth: MonthlyBreakdownItem[];
}

export interface BreakdownSummary {
  total: number;
  count: number;
  average: number;
  min: number;
  max: number;
}

export interface BreakdownTransaction {
  identifier: string;
  vendor: string;
  date: Date | string;
  price: number;
  processed_date?: string;
  processedDate?: string;
  subcategory_id?: number;
  subcategoryId?: number;
  parent_id?: number;
  parentId?: number;
  account_number?: string;
  accountNumber?: string;
  institution?: VendorInstitution;
  name?: string;
  [key: string]: any;
}

export interface DrillLevel {
  type: 'parent' | 'subcategory';
  parentId?: number;
  parentName?: string;
  subcategoryId?: number;
  subcategoryName?: string;
}

export interface CategoryDetails {
  summary: BreakdownSummary;
  subcategories?: Subcategory[];
  byVendor?: VendorBreakdownItem[];
  byCard?: Array<{
    accountNumber: string;
    total: number;
    institution?: VendorInstitution;
    vendor?: string;
  }>;
  transactions: BreakdownTransaction[];
}

export type FormatCurrencyFn = (
  value: number,
  options?: Partial<{ minimumFractionDigits: number; maximumFractionDigits: number }>
) => string;

export interface OverviewDataItem {
  id: number;
  name: string;
  color?: string | null;
  icon?: string | null;
  description?: string | null;
  value: number;
  count: number;
  previousValue?: number;
  history?: TrendHistoryPoint[];
  subcategories?: Subcategory[];
}
