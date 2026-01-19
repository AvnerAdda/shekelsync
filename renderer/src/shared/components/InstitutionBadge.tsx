import { Chip, Tooltip } from '@mui/material';
import i18n from '@renderer/i18n';

export interface InstitutionMetadata {
  id: number;
  vendor_code: string;
  display_name_he: string;
  display_name_en: string;
  display_name_fr?: string;
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

const normalizeLocale = (value?: string) => value?.toLowerCase().split('-')[0];

export function getInstitutionLabel(institution?: InstitutionMetadata | null, locale?: string) {
  if (!institution) return null;
  const normalized = normalizeLocale(locale || i18n.language) || 'he';
  const heName = institution.display_name_he;
  const enName = institution.display_name_en;
  const frName = institution.display_name_fr;

  if (normalized === 'he') return heName || enName || frName || institution.vendor_code;
  if (normalized === 'fr') return frName || enName || heName || institution.vendor_code;
  return enName || frName || heName || institution.vendor_code;
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
  const locale = normalizeLocale(i18n.language) || 'he';
  const label = getInstitutionLabel(institution, locale) ?? fallback ?? 'Unknown institution';
  const alternateLabel = locale === 'he'
    ? (institution?.display_name_en || institution?.display_name_fr)
    : institution?.display_name_he;
  const tooltipTitle = alternateLabel && alternateLabel !== label
    ? alternateLabel
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
