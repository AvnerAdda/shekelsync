import { createContext, useCallback, useContext } from 'react';
import { apiClient } from '@renderer/lib/api-client';
import { PLANNING_CHANGED_EVENT } from '../types';
import type { CashScenarioInput, PlanningData, SavingsGoalInput } from '../types';
import { usePlanningResource } from './usePlanningResource';

export function notifyPlanningChanged() {
  window.dispatchEvent(new Event(PLANNING_CHANGED_EVENT));
}

async function loadPlanningData(): Promise<PlanningData> {
  const response = await apiClient.get<PlanningData>('/api/planning', { cacheMode: 'no-store' });
  if (!response.ok || !response.data?.settings || !Array.isArray(response.data.goals)
    || !Array.isArray(response.data.scenarios)) throw new Error('Unable to load planning data');
  return response.data;
}

export function useLocalPlanningData(enabled = true) {
  const resource = usePlanningResource(loadPlanningData, enabled);

  const saveGoal = useCallback(async (input: SavingsGoalInput, id?: number) => {
    const response = id === undefined
      ? await apiClient.post('/api/planning/goals', input)
      : await apiClient.put(`/api/planning/goals/${id}`, input);
    if (!response.ok) throw new Error('Unable to save goal');
    notifyPlanningChanged();
  }, []);

  const deleteGoal = useCallback(async (id: number) => {
    const response = await apiClient.delete(`/api/planning/goals/${id}`);
    if (!response.ok) throw new Error('Unable to delete goal');
    notifyPlanningChanged();
  }, []);

  const saveScenario = useCallback(async (input: CashScenarioInput, id?: number) => {
    const response = id === undefined
      ? await apiClient.post('/api/planning/scenarios', input)
      : await apiClient.put(`/api/planning/scenarios/${id}`, input);
    if (!response.ok) throw new Error('Unable to save scenario');
    notifyPlanningChanged();
  }, []);

  const deleteScenario = useCallback(async (id: number) => {
    const response = await apiClient.delete(`/api/planning/scenarios/${id}`);
    if (!response.ok) throw new Error('Unable to delete scenario');
    notifyPlanningChanged();
  }, []);

  return { ...resource, saveGoal, deleteGoal, saveScenario, deleteScenario };
}

export const PlanningDataContext = createContext<ReturnType<typeof useLocalPlanningData> | null>(null);

export function usePlanningData() {
  const shared = useContext(PlanningDataContext);
  const local = useLocalPlanningData(!shared);
  return shared ?? local;
}
