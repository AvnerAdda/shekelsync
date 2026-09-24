import { Stack } from '@mui/material';
import GoalsPanel from './GoalsPanel';
import ScenariosPanel from './ScenariosPanel';
import SpendabilityCard from './SpendabilityCard';
import { PlanningDataContext, useLocalPlanningData } from '../hooks/usePlanningData';

export default function PlanningWorkspace() {
  const planning = useLocalPlanningData();
  return (
    <PlanningDataContext.Provider value={planning}>
      <Stack spacing={3}>
        <SpendabilityCard />
        <GoalsPanel />
        <ScenariosPanel />
      </Stack>
    </PlanningDataContext.Provider>
  );
}
