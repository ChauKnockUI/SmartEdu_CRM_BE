import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const mocks = vi.hoisted(() => ({ count: vi.fn(), list: vi.fn(), aggregate: vi.fn() }));
vi.mock('../src/repositories/lead.repository', () => ({ leadRepository: { count: mocks.count, findMany: mocks.list, getFunnelAggregates: mocks.aggregate } }));
vi.mock('../src/services/ai/leadScoring.service', () => ({ leadScoringService: {} }));
vi.mock('../src/services/ai/leadScoring.repository', () => ({ leadScoringRepository: { decorateLeads: async (leads: any[]) => leads } }));
vi.mock('../src/middlewares/auth.middleware', () => ({
  authenticate: (req: any, _res: any, next: any) => { req.user = { role: 'sale', userId: 12 }; next(); },
  authorize: () => (_req: any, _res: any, next: any) => next(),
}));
import leadRoutes from '../src/routes/lead.routes';
const app = express();
app.use('/leads', leadRoutes);

describe('Board filters and summary are evaluated server-side in the sale scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.count.mockResolvedValue(0);
    mocks.list.mockResolvedValue([]);
    mocks.aggregate.mockResolvedValue([]);
  });
  it('retains search/course/care filters and prevents a sale selecting another assignee', async () => {
    const res = await request(app).get('/leads?course_id=7&assigned_to=999&needs_care=true&search=example');
    expect(res.status).toBe(200);
    const where = mocks.count.mock.calls[0][0];
    expect(where).toMatchObject({ course_id: 7, assigned_to: 12 });
    expect(where.AND[0].status.in).toEqual(['new', 'contacted', 'interested', 'trial']);
    expect(where.AND[1].OR[0]).toEqual({ last_contacted: null });
    expect(where.OR[0].full_name.contains).toBe('example');
  });
  it('uses the same criteria for aggregate statistics rather than just counting the loaded board page', async () => {
    const res = await request(app).get('/leads/funnel?course_id=7&assigned_to=999&needs_care=true&search=example&status=trial');
    expect(res.status).toBe(200);
    expect(mocks.aggregate.mock.calls[0][0]).toMatchObject({ course_id: 7, assigned_to: 12, needs_care: true, search: 'example', status: 'trial' });
  });
});
