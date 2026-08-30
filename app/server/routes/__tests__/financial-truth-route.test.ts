import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createFinancialTruthRouter } = require('../../routes/financial-truth.js');

function buildApp(service: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use('/api/financial-truth', createFinancialTruthRouter({ service }));
  return app;
}

describe('Financial truth routes', () => {
  it('previews and creates an idempotent correction', async () => {
    const previewCorrection = vi.fn().mockReturnValue({ success: true, impact: { monthlyDelta: -50 } });
    const createCorrection = vi.fn().mockReturnValue({
      success: true,
      correction: { id: 9, action: 'suppress_pattern' },
      truthRevision: 4,
      affectedDomains: ['forecast', 'subscriptions'],
      refreshState: 'pending',
    });
    const app = buildApp({
      previewCorrection,
      createCorrection,
      listCorrections: vi.fn(),
      revertCorrection: vi.fn(),
      setPresentationDismissal: vi.fn(),
      listPresentationDismissals: vi.fn(),
    });
    const payload = { target: { kind: 'pattern', patternId: 3 }, action: 'suppress_pattern' };

    await request(app).post('/api/financial-truth/corrections/preview').send(payload).expect(200);
    const created = await request(app).post('/api/financial-truth/corrections').send(payload).expect(201);

    expect(previewCorrection).toHaveBeenCalledWith(payload);
    expect(createCorrection).toHaveBeenCalledWith(payload);
    expect(created.body.truthRevision).toBe(4);
  });

  it('lists, restores, and shares presentation-only hides', async () => {
    const listCorrections = vi.fn().mockReturnValue({ success: true, corrections: [] });
    const revertCorrection = vi.fn().mockReturnValue({ success: true, correction: { id: 8, status: 'reverted' } });
    const setPresentationDismissal = vi.fn().mockReturnValue({ success: true, hidden: true });
    const listPresentationDismissals = vi.fn().mockReturnValue({ success: true, sourceKeys: ['money_review:notification:a'] });
    const app = buildApp({
      previewCorrection: vi.fn(),
      createCorrection: vi.fn(),
      listCorrections,
      revertCorrection,
      setPresentationDismissal,
      listPresentationDismissals,
    });

    await request(app).get('/api/financial-truth/corrections?status=reverted').expect(200);
    await request(app).post('/api/financial-truth/corrections/8/revert').expect(200);
    await request(app).put('/api/financial-truth/presentation-dismissals/source%3Aone').send({ hidden: true, sourceType: 'notification' }).expect(200);
    const hidden = await request(app).get('/api/financial-truth/presentation-dismissals').expect(200);

    expect(listCorrections).toHaveBeenCalledWith({ status: 'reverted' });
    expect(revertCorrection).toHaveBeenCalledWith('8');
    expect(setPresentationDismissal).toHaveBeenCalledWith('source:one', { hidden: true, sourceType: 'notification' });
    expect(hidden.body.sourceKeys).toEqual(['money_review:notification:a']);
  });

  it('returns safe validation errors', async () => {
    const error = Object.assign(new Error('A valid pattern is required'), { status: 400, code: 'PATTERN_REQUIRED' });
    const app = buildApp({
      previewCorrection: vi.fn(() => { throw error; }),
      createCorrection: vi.fn(),
      listCorrections: vi.fn(),
      revertCorrection: vi.fn(),
      setPresentationDismissal: vi.fn(),
      listPresentationDismissals: vi.fn(),
    });

    const response = await request(app).post('/api/financial-truth/corrections/preview').send({}).expect(400);
    expect(response.body).toMatchObject({ error: 'A valid pattern is required', code: 'PATTERN_REQUIRED' });
  });
});
