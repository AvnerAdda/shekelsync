export interface TransactionDetail {
  identifier: string;
  vendor: string;
  price: number;
  description: string;
  date: string;
  category: string;
  parentCategory: string;
  categoryType: string;
  parent_name?: string;
  category_name?: string;
  institution?: {
    id: number;
    vendor_code: string;
    display_name_he: string;
    display_name_en: string;
    logo_url?: string;
    institution_type: string;
  };
}
