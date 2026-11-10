import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const mocks = vi.hoisted(() => ({ sources: vi.fn(), create: vi.fn(), update: vi.fn(), read: vi.fn(), score: vi.fn() }));
vi.mock('../src/repositories/lead.repository', () => ({ leadRepository: {
  getSourceValues: mocks.sources, create: mocks.create, update: mocks.update, findById: mocks.read,
} }));
vi.mock('../src/services/ai/leadScoring.service', () => ({ leadScoringService: { scoreLead: mocks.score } }));
vi.mock('../src/services/ai/leadScoring.repository', () => ({ leadScoringRepository: { decorateLeads: async (leads: any[]) => leads } }));
vi.mock('../src/middlewares/auth.middleware', () => ({
  authenticate: (req: any, _res: any, next: any) => { req.user = { role: 'admin', userId: 12 }; next(); },
  authorize: () => (_req: any, _res: any, next: any) => next(),
}));

import { LEAD_SOURCES } from '../src/constants/leadSources';
import { leadService } from '../src/services/lead.service';
import leadRoutes from '../src/routes/lead.routes';

const app = express();
app.use(express.json());
app.use('/leads', leadRoutes);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sources.mockResolvedValue([{ lead_source: 'website' }, { lead_source: 'zalo' }, { lead_source: 'Old campaign' }]);
  mocks.read.mockResolvedValue({ id: 1, status: 'contacted', lead_source: 'Old campaign', notes: null });
  mocks.create.mockResolvedValue({ id: 1 });
  mocks.update.mockResolvedValue({ id: 1 });
  mocks.score.mockResolvedValue({ success: true });
});

describe('Lead sources share one catalog and preserve stored codes', () => {
  it('serves /sources before the /:id route, including historical tenant values', async () => {
    const res = await request(app).get('/leads/sources');
    expect(res.status).toBe(200);
    expect(res.body.data).toContainEqual({ value: 'zalo', label: 'Zalo', legacy: false });
    expect(res.body.data).toContainEqual({ value: 'Old campaign', label: 'Old campaign', legacy: true });
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it.each(LEAD_SOURCES)('uses the exact database code $value for create, edit and display', async source => {
    const sources = await leadService.getLeadSources();
    await leadService.createLead({ full_name: 'Example', source: source.value });
    await leadService.updateLead(1, { source: source.value });
    expect(mocks.create.mock.calls[0][0].lead_source).toBe(source.value);
    expect(mocks.update.mock.calls[0][1].lead_source).toBe(source.value);
    expect(sources.find(option => option.value === source.value)?.label).toBe(source.label);
  });

  it('preserves an existing historical source during unrelated edits, without offering it for new leads', async () => {
    await leadService.getLeadSources(12);
    expect(mocks.sources).toHaveBeenCalledWith(12);
    await leadService.updateLead(1, { source: 'Old campaign', notes: 'Updated note' });
    expect(mocks.update.mock.calls[0][1]).toMatchObject({ lead_source: 'Old campaign', notes: 'Updated note' });
    await expect(leadService.createLead({ full_name: 'Example', source: 'Old campaign' })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects arbitrary source strings on create and update before writing to the database', async () => {
    await expect(leadService.createLead({ full_name: 'Example', source: 'Random new label' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(leadService.updateLead(1, { source: 'Random new label' })).rejects.toMatchObject({ statusCode: 400 });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('returns a validation error for an invalid source in the HTTP update endpoint', async () => {
    const res = await request(app).put('/leads/1').send({ source: 'Facebook Ads' });
    expect(res.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
