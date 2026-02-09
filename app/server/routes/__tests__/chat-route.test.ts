import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createChatRouter } = require('../../routes/chat.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const chatService = require('../../services/chat.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const donationsService = require('../../services/donations.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/chat', createChatRouter());
  return app;
}

describe('Shared /api/chat routes', () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('processes chat messages', async () => {
    vi.spyOn(donationsService, 'getDonationStatus').mockResolvedValue({
      canAccessAiAgent: true,
      tier: 'bronze',
      supportStatus: 'verified',
    });
    const response = { reply: 'Hello there!' };
    const spy = vi.spyOn(chatService, 'processMessage').mockResolvedValue(response);

    const res = await request(app).post('/api/chat').send({ message: 'Hi' }).expect(200);

    expect(res.body).toEqual(response);
    expect(spy).toHaveBeenCalledWith({ message: 'Hi' });
  });

  it('handles chat errors', async () => {
    vi.spyOn(donationsService, 'getDonationStatus').mockResolvedValue({
      canAccessAiAgent: true,
      tier: 'bronze',
      supportStatus: 'verified',
    });
    vi.spyOn(chatService, 'processMessage').mockRejectedValue({
      status: 422,
      message: 'Bad input',
    });

    const res = await request(app).post('/api/chat').send({}).expect(422);

    expect(res.body.error).toMatch(/bad input/i);
  });

  it('blocks chat when supporter plan is not verified', async () => {
    vi.spyOn(donationsService, 'getDonationStatus').mockResolvedValue({
      canAccessAiAgent: false,
      tier: 'none',
      supportStatus: 'none',
    });

    const res = await request(app).post('/api/chat').send({ message: 'Hi' }).expect(403);

    expect(res.body.code).toBe('SUPPORT_PLAN_REQUIRED');
  });
});
