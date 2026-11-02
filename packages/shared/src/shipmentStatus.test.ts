import { describe, expect, it } from 'vitest';
import { clearanceStatusOf, shipmentInputSchema, shipmentStatusOf } from './schemas/shipments';

describe('shipment status', () => {
  it('an import is completed by its ETA Factory date, an export by its ATD', () => {
    expect(shipmentStatusOf({ direction: 'IMPORT', arriveFty: '2026-09-28' })).toBe('COMPLETED');
    expect(shipmentStatusOf({ direction: 'IMPORT', atd: '2026-09-01' })).toBe('PENDING');
    expect(shipmentStatusOf({ direction: 'EXPORT', atd: '2026-09-04' })).toBe('COMPLETED');
    expect(shipmentStatusOf({ direction: 'EXPORT', arriveFty: '2026-09-28' })).toBe('PENDING');
  });

  it('is in progress once a declaration is recorded, else pending', () => {
    const declared = [{ declareNo: 'I 138735' }];
    expect(shipmentStatusOf({ direction: 'IMPORT', declarations: declared })).toBe('IN_PROGRESS');
    expect(shipmentStatusOf({ direction: 'IMPORT', declarations: [{ declareNo: ' ' }] })).toBe(
      'PENDING',
    );
  });

  it('clearance is cleared by a declaration no. and date, in progress by the no. alone', () => {
    expect(clearanceStatusOf({ declarations: [] })).toBe('PENDING');
    expect(clearanceStatusOf({ declarations: [{ declareNo: 'I 142652' }] })).toBe('IN_PROGRESS');
    expect(
      clearanceStatusOf({ declarations: [{ declareNo: 'I 142652', declareDate: '2026-10-02' }] }),
    ).toBe('CLEARED');
    expect(clearanceStatusOf({ declarations: [{ declareDate: '2026-10-02' }] })).toBe('PENDING');
  });

  it('is worked out on save; a status sent in is ignored', () => {
    const parsed = shipmentInputSchema.parse({
      clientId: '00000000-0000-4000-8000-000000000000',
      direction: 'EXPORT',
      transportMode: 'SEA',
      loadType: 'LCL',
      status: 'EXCEPTION',
      clearanceStatus: 'EXCEPTION',
      atd: '2026-09-04',
    });
    expect(parsed.status).toBe('COMPLETED');
    expect(parsed.clearanceStatus).toBe('PENDING');
  });
});
