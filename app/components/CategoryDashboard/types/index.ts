export interface CategorySummary {
  category_definition_id: number;
  name: string;
  name_en?: string | null;
  color?: string | null;
  icon?: string | null;
  category_type?: string | null;
  transaction_count: number;
  value: number;
  auto_count: number;
  expenses_total: number;
  income_total: number;
}

export interface Expense {
  name: string;
  price: number;
  date: string;
  identifier?: string;
  vendor?: string;
  category?: string | null;
  account_number?: string | null;
  category_definition_id?: number | null;
  category_name?: string | null;
  category_name_en?: string | null;
  category_type?: string | null;
  parent_category_definition_id?: number | null;
  parent_category_name?: string | null;
  parent_category_name_en?: string | null;
  resolved_category_name?: string | null;
  resolved_parent_category_name?: string | null;
  legacy_category?: string | null;
  legacy_parent_category?: string | null;
}

export interface CategoryOption {
  id: number;
  name: string;
  nameEn?: string | null;
  categoryType: string;
  parentId?: number | null;
  parentName?: string | null;
  parentNameEn?: string | null;
}

export interface ExpensesModalProps {
  open: boolean;
  onClose: () => void;
  data: ModalData;
  color: string;
  setModalData?: (data: ModalData) => void;
  currentMonth?: string;
} 

export interface ModalData {
  type: string;
  category_definition_id?: number;
  data: Expense[];
}

export type CategorizedExpense = Expense & { category: string };

export interface BoxPanelData {
  allTransactions: string;
  nonMapped: string;
  categories: string;
  lastMonth: string;
}
