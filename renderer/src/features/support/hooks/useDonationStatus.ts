import { useDonationStatusContext } from '../contexts/DonationStatusContext';
import type { DonationStatusContextValue } from '../contexts/DonationStatusContext';

type UseDonationStatusReturn = DonationStatusContextValue;

export function useDonationStatus(): UseDonationStatusReturn {
  return useDonationStatusContext();
}

export type { UseDonationStatusReturn };
export default useDonationStatus;
