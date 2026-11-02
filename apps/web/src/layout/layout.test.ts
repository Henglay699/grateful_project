import { describe, expect, it } from 'vitest';
import { titleFor } from './nav';

describe('titleFor', () => {
  it.each([
    ['/overview', 'Overview'],
    ['/plans', 'Shipping Plans'],
    ['/plans/new', 'Create Shipment'],
    ['/accounting', 'Accounting'],
    ['/accounting/credit-notes', 'Chea Payments'],
    ['/accounting/tax-invoices', 'Tax Invoice'],
    ['/cutstock', 'CDC Master List'],
    ['/staff', 'Staff Management'],
    ['/plans/3f6c0a1e-0000-4000-8000-000000000000', 'Shipment Details'],
    ['/clients/3f6c0a1e-0000-4000-8000-000000000000', 'Client Details'],
  ])('%s → %s', (path, title) => expect(titleFor(path)).toBe(title));
});
