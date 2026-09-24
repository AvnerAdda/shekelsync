const express = require('express');
const planningService = require('../services/planning.js');

function createPlanningRouter({ service = planningService } = {}) {
  const router = express.Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const handle = (action, status = 200) => async (req, res) => {
    try { res.status(status).json(await action(req)); } catch (error) {
      const code = Number.isInteger(error?.status) ? error.status : 500;
      if (code >= 500) console.error('[Planning] Request failed:', error);
      res.status(code).json({ error: code < 500 ? error.message : 'Unable to complete planning request', ...(error?.code ? { code: error.code } : {}) });
    }
  };
  router.get('/', handle(() => service.getPlanningData()));
  router.get('/projection', handle((req) => service.getProjection(req.query)));
  router.put('/settings', handle((req) => service.updateSettings(req.body || {})));
  router.post('/goals', handle((req) => service.saveGoal(req.body || {}), 201));
  router.put('/goals/:id', handle((req) => service.saveGoal(req.body || {}, req.params.id)));
  router.delete('/goals/:id', handle((req) => service.deleteGoal(req.params.id)));
  router.post('/scenarios/preview', handle((req) => service.previewScenario(req.body || {})));
  router.post('/scenarios', handle((req) => service.saveScenario(req.body || {}), 201));
  router.put('/scenarios/:id', handle((req) => service.saveScenario(req.body || {}, req.params.id)));
  router.delete('/scenarios/:id', handle((req) => service.deleteScenario(req.params.id)));
  return router;
}

module.exports = { createPlanningRouter };
