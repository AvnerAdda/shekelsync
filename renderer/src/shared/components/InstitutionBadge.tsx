import { Chip, Tooltip } from '@mui/material';

export interface InstitutionMetadata {
  id: number;
  vendor_code: string;
  display_name_he: string;
  display_name_en: string;
  institution_type: string;
  category?: string;
  subcategory?: string | null;
  parent_id?: number | null;
  hierarchy_path?: string;
  depth_level?: number;
  node_type?: 'root' | 'group' | 'institution';
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
      sx={{ 
        textTransform: 'none', 
        fontWeight: 500,
        borderRadius: '8px',
        transition: 'all 0.2s ease-in-out',
        boxShadow: (theme) => variant === 'filled'
          ? (theme.palette.mode === 'dark'
            ? '0 2px 4px rgba(0, 0, 0, 0.3)'
            : '0 2px 4px rgba(0, 0, 0, 0.1)')
          : 'none',
        '&:hover': {
          transform: 'scale(1.05)',
          boxShadow: (theme) => theme.palette.mode === 'dark'
            ? '0 4px 8px rgba(0, 0, 0, 0.4)'
            : '0 4px 8px rgba(0, 0, 0, 0.15)',
        },
      }}
    />
  );

  if (!tooltipTitle) {
    return chip;
  }

  return (
    <Tooltip 
      title={tooltipTitle}
      arrow
      placement="top"
      sx={{
        '& .MuiTooltip-tooltip': {
          borderRadius: '8px',
          padding: '8px 12px',
        },
      }}
    >
      <span>{chip}</span>
    </Tooltip>
  );
}

export default InstitutionBadge;
