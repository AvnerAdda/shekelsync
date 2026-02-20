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
  const allowAiAccess = () =>
    vi.spyOn(donationsService, 'getDonationStatus').mockResolvedValue({
      canAccessAiAgent: true,
      tier: 'one_time',
      supportStatus: 'verified',
    });

  beforeEach(() => {
    app = buildApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('processes chat messages', async () => {
    allowAiAccess();
    const response = { reply: 'Hello there!' };
    const spy = vi.spyOn(chatService, 'processMessage').mockResolvedValue(response);

    const res = await request(app).post('/api/chat').send({ message: 'Hi' }).expect(200);

    expect(res.body).toEqual(response);
    expect(spy).toHaveBeenCalledWith({ message: 'Hi' });
  });

  it('handles chat errors', async () => {
    allowAiAccess();
    vi.spyOn(chatService, 'processMessage').mockRejectedValue({
      status: 422,
      message: 'Bad input',
    });

    const res = await request(app).post('/api/chat').send({}).expect(422);

    expect(res.body.error).toMatch(/bad input/i);
  });

  it('blocks chat when donation is not verified', async () => {
    vi.spyOn(donationsService, 'getDonationStatus').mockResolvedValue({
      canAccessAiAgent: false,
      tier: 'none',
      supportStatus: 'none',
    });

    const res = await request(app).post('/api/chat').send({ message: 'Hi' }).expect(403);

    expect(res.body.code).toBe('DONATION_REQUIRED');
  });

  it('passes supporter context headers to donation-status lookup', async () => {
    allowAiAccess();
    vi.spyOn(chatService, 'processMessage').mockResolvedValue({ reply: 'ok' });

    await request(app)
      .post('/api/chat')
      .set('x-auth-access-token', 'token-1')
      .set('x-auth-user-id', 'u-123')
      .set('x-auth-user-email', 'user@example.com')
      .set('x-auth-user-name', 'Demo User')
      .send({ message: 'Hi' })
      .expect(200);

    expect(donationsService.getDonationStatus).toHaveBeenCalledWith({
      accessToken: 'token-1',
      userId: 'u-123',
      email: 'user@example.com',
      name: 'Demo User',
    });
  });

  it('includes retryAfter when chat processing error provides it', async () => {
    allowAiAccess();
    vi.spyOn(chatService, 'processMessage').mockRejectedValue({
      status: 429,
      message: 'Too many requests',
      retryAfter: 60,
    });

    const res = await request(app).post('/api/chat').send({ message: 'Hi' }).expect(429);
    expect(res.body.retryAfter).toBe(60);
  });

  it('lists conversations with parsed query options', async () => {
    allowAiAccess();
    const listSpy = vi.spyOn(chatService, 'listConversations').mockResolvedValue([{ id: 'conv-1' }]);

    const res = await request(app)
      .get('/api/chat/conversations?limit=5&offset=2&includeArchived=true')
      .expect(200);

    expect(listSpy).toHaveBeenCalledWith({
      limit: 5,
      offset: 2,
      includeArchived: true,
    });
    expect(res.body.conversations).toEqual([{ id: 'conv-1' }]);
  });

  it('uses default conversation list options for invalid query params', async () => {
    allowAiAccess();
    const listSpy = vi.spyOn(chatService, 'listConversations').mockResolvedValue([]);

    await request(app).get('/api/chat/conversations?limit=foo&offset=bar').expect(200);
    expect(listSpy).toHaveBeenCalledWith({
      limit: 20,
      offset: 0,
      includeArchived: false,
    });
  });

  it('handles conversation list errors', async () => {
    allowAiAccess();
    vi.spyOn(chatService, 'listConversations').mockRejectedValue({
      status: 503,
      message: 'Service unavailable',
    });

    const res = await request(app).get('/api/chat/conversations').expect(503);
    expect(res.body.error).toMatch(/service unavailable/i);
  });

  it('gets conversation history by id and handles missing history', async () => {
    allowAiAccess();
    vi.spyOn(chatService, 'getConversationHistory').mockResolvedValue({
      id: 'conv-2',
      messages: [{ role: 'user', content: 'hello' }],
    });

    const successRes = await request(app).get('/api/chat/conversations/conv-2').expect(200);
    expect(successRes.body.id).toBe('conv-2');

    vi.spyOn(chatService, 'getConversationHistory').mockRejectedValueOnce({
      status: 404,
      message: 'Conversation not found',
    });
    const errorRes = await request(app).get('/api/chat/conversations/does-not-exist').expect(404);
    expect(errorRes.body.error).toMatch(/conversation not found/i);
  });

  it('deletes conversation and surfaces delete failures', async () => {
    allowAiAccess();
    const deleteSpy = vi.spyOn(chatService, 'deleteConversation').mockResolvedValue(undefined);

    const successRes = await request(app).delete('/api/chat/conversations/conv-3').expect(200);
    expect(successRes.body).toEqual({ success: true });
    expect(deleteSpy).toHaveBeenCalledWith('conv-3');

    vi.spyOn(chatService, 'deleteConversation').mockRejectedValueOnce({
      status: 500,
      message: 'Delete failed',
    });
    const errorRes = await request(app).delete('/api/chat/conversations/conv-3').expect(500);
    expect(errorRes.body.error).toMatch(/delete failed/i);
  });

  it('uses none/default supporter details when donation status is missing', async () => {
    vi.spyOn(donationsService, 'getDonationStatus').mockResolvedValue(null);
    const res = await request(app).post('/api/chat').send({ message: 'Hi' }).expect(403);

    expect(res.body.code).toBe('DONATION_REQUIRED');
    expect(res.body.details).toEqual({
      requiredDonation: true,
      currentTier: 'none',
      supportStatus: 'none',
    });
  });
});
