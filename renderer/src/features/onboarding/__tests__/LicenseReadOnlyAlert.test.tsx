import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import LicenseReadOnlyAlert, {
  isLicenseReadOnlyError,
} from '@renderer/shared/components/LicenseReadOnlyAlert';

describe('LicenseReadOnlyAlert in public-access builds', () => {
  it('ignores the retired backend error shape', () => {
    expect(isLicenseReadOnlyError({
      code: 'LICENSE_READ_ONLY',
      error: 'License is in read-only mode',
      reason: 'No license registered',
    })).toEqual({ isReadOnly: false });
  });

  it('never renders a registration-blocking dialog', () => {
    const { container } = render(
      <LicenseReadOnlyAlert
        open
        onClose={() => undefined}
        reason="No license registered"
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
