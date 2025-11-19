import { Chip, Tooltip } from '@mui/material';

export interface InstitutionMetadata {
  id: number;
  vendor_code: string;
  display_name_he: string;
  display_name_en: string;
  institution_type: string;
  category?: string;
  subcategory?: string | null;
  logo_url?: string | null;
  is_scrapable?: number | boolean;
  scraper_company_id?: string | null;
  display_order?: number | null;
  credential_fields?: string | string[] | null;
  credentialFieldList?: string[];
}

export function getInstitutionLabel(institution?: InstitutionMetadata | null) {
  if (!institution) return null;
  return institution.display_name_he || institution.display_name_en || institution.vendor_code;
}

interface InstitutionBadgeProps {
  institution?: InstitutionMetadata | null;
  fallback?: string;
  size?: 'small' | 'medium';
  variant?: 'filled' | 'outlined';
}

export function InstitutionBadge({
  institution,
  fallback,
  size = 'small',
  variant = 'outlined',
}: InstitutionBadgeProps) {
  const label = getInstitutionLabel(institution) ?? fallback ?? 'Unknown institution';
  const tooltipTitle = institution?.display_name_en && institution?.display_name_en !== label
    ? institution.display_name_en
    : institution?.vendor_code;

  const chip = (
    <Chip
      label={label}
      size={size}
      variant={variant}
      sx={{ textTransform: 'none', fontWeight: 500 }}
    />
  );

  if (!tooltipTitle) {
    return chip;
  }

  return (
    <Tooltip title={tooltipTitle}>
      <span>{chip}</span>
    </Tooltip>
  );
}

export default InstitutionBadge;
