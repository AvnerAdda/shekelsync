export interface TransactionDetail {
  identifier: string;
  vendor: string;
  price: number;
  description: string;
  date: string;
  category_name?: string | null;
  parent_name?: string | null;
  categoryType?: string | null;
  memo?: string;
  tags?: string[];
  institution?: {
    id: number;
    vendor_code: string;
    display_name_he: string;
    display_name_en: string;
    logo_url?: string;
    institution_type: string;
  };
}
