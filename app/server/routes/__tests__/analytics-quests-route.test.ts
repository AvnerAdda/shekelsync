// @vitest-environment node
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { createAnalyticsRouter } = require('../analytics.js');
const questsService = require('../../services/analytics/quests.js');

describe('quest acceptance route', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ['Maximum active quests reached (5)', 409],
    ['Quest not found', 404],
    ['Quest cannot be accepted (current status: resolved)', 400],
    ['Database unavailable', 500],
  ])('returns the appropriate status and reason for %s', async (message, status) => {
    vi.spyOn(questsService, 'acceptQuest').mockRejectedValue(new Error(message));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const app = express();
    app.use('/api/analytics', createAnalyticsRouter());

    const response = await request(app).post('/api/analytics/quests/12/accept').expect(status);

    expect(response.body).toEqual({ error: 'Failed to accept quest', message });
    expect(questsService.acceptQuest).toHaveBeenCalledWith(12);
  });
});
