import React from 'react';

interface LicenseReadOnlyAlertProps {
  open: boolean;
  onClose: () => void;
  reason?: 'trial_expired' | 'offline_grace_expired' | 'not_registered' | string;
  onUpgrade?: () => void;
}

/**
 * Compatibility component for callers that still handle the retired license
 * error shape. Public-access builds never render a license-blocking dialog.
 */
const LicenseReadOnlyAlert: React.FC<LicenseReadOnlyAlertProps> = () => null;

/**
 * Check if an API response indicates a license read-only error.
 */
export function isLicenseReadOnlyError(responseData: unknown): { isReadOnly: boolean; reason?: string } {
  void responseData;
  return { isReadOnly: false };
}

export default LicenseReadOnlyAlert;
