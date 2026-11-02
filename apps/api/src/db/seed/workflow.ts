import { sql } from 'drizzle-orm';
import { EXPORT_STAGES, IMPORT_STAGES, stageIndex } from '@gs/shared';
import { db } from '../client';
import { queryRows } from '../../lib/listing';
import { addDays } from './rng';

interface Ids {
  today: string;
  jrId: string;
  operatorId: string;
  managerId: string;
  accountantId: string;
  opsManagerId: string;
  brokerId: string;
}

/** Stages open shipments are spread over, so every role has something in "My Work". */
const OPEN_IMPORT = [
  'PRE_ALERT',
  'DOC_CHECK',
  'PERMIT_PACKAGE',
  'REVIEW',
  'CUSTOMER_SIGNING',
  'PERMIT',
  'ARRIVAL',
  'LOCAL_CHARGES',
  'DELIVERY_ORDER',
  'CLEARANCE',
];
const OPEN_EXPORT = [
  'BOOKING_RECEIVED',
  'BOOKED',
  'FINAL_PACKING',
  'WAREHOUSE_DOCS',
  'REVIEW',
  'DECLARATION',
  'CFS_DELIVERY',
  'BL',
  'CO',
  'VENDOR_COSTS',
];

/**
 * Places the seeded shipments in the job workflow and adds the records each stage needs, so the
 * demo shows the workflow tab, My Work, approvals and alerts with realistic data.
 */
export async function seedWorkflow(ids: Ids): Promise<void> {
  const { today } = ids;

  // Our customs broker and JR's letter details (what the import letters used to hard-code).
  await db.execute(sql`
    INSERT INTO broker_agents (company, company_vattin, grantee_name, grantee_id_no, grantee_phone, agent_name, agent_id_no,
      agent_phone, card_no, card_expiry, is_default)
    VALUES ('GRATEFUL SOLUTIONS (CAMBODIA) CO., LTD.', 'K008-902404873', 'យឹម ជៀវសៀ', '021114299', '098 484 414',
      'សៀ សុខជា', '020466170 (02)', '086 347 078', 'CB CARD #1132', '2028-03-31', true)`);
  await db.execute(sql`
    UPDATE clients SET company_phone = '077 777 469', cdc_extension_letter_no = '1343/26',
      cdc_customs_note_date = '2026-05-22',
      cdc_no = coalesce(cdc_no, 'QIP25021226-C01996'), cdc_issue_date = coalesce(cdc_issue_date, '2025-05-21'),
      cdc_valid_until = ${addDays(today, 24)}::date
    WHERE id = ${ids.jrId}`);
  await db.execute(sql`
    INSERT INTO client_signatories (client_id, name, passport_no, title, title_km, is_default)
    VALUES (${ids.jrId}, 'LIN LEE BI JEN', '353387543', 'GENERAL MANAGER', 'ជ.នាយកក្រុមហ៊ុន JR APPAREL', true)`);
  await db.execute(sql`
    INSERT INTO client_authorizations (client_id, kind, reference, issued_on, valid_until, notes) VALUES
      (${ids.jrId}, 'AUTHORIZATION_LETTER', 'Transfer of rights to Grateful Solutions', ${addDays(today, -340)}::date, ${addDays(today, 12)}::date, 'Sign & stamp 2 sets'),
      (${ids.jrId}, 'BROKER_ID', 'CB CARD #1132', ${addDays(today, -200)}::date, '2028-03-31', NULL),
      (${ids.jrId}, 'PATENT_VAT', 'Patent tax 2026', '2026-01-01', '2026-12-31', 'Displayed at the office'),
      (${ids.jrId}, 'OWNER_TO_STAFF', 'Owner to shipping staff', ${addDays(today, -100)}::date, ${addDays(today, 265)}::date, NULL)`);

  // Closed jobs: completed and in the ledger. Completed without a ledger row: waiting for billing.
  await db.execute(sql`
    UPDATE shipments s SET workflow_stage = CASE
        WHEN EXISTS (SELECT 1 FROM customs_declarations d JOIN accounting_records a ON a.declaration_id = d.id
                     WHERE d.shipment_id = s.id) THEN 'CLOSED'
        ELSE 'BILLING' END,
      stage_changed_at = (coalesce(s.arrive_fty, s.atd, s.eta, ${today}::date) + 3)::timestamptz
    WHERE s.status = 'COMPLETED' AND s.deleted_at IS NULL`);

  const open = await queryRows<{
    id: string;
    direction: 'IMPORT' | 'EXPORT';
    declared: boolean;
    eta: string | null;
    etd: string | null;
    pcs: string;
    gw: string;
    cbm: string;
  }>(
    db,
    sql`SELECT s.id, s.direction, to_char(s.eta, 'YYYY-MM-DD') AS eta, to_char(s.etd, 'YYYY-MM-DD') AS etd,
               EXISTS (SELECT 1 FROM customs_declarations d WHERE d.shipment_id = s.id AND d.declare_no IS NOT NULL) AS declared,
               (SELECT coalesce(sum(l.pcs), 0) FROM cargo_invoice_lines l JOIN cargo_invoices i ON i.id = l.invoice_id WHERE i.shipment_id = s.id)::text AS pcs,
               (SELECT coalesce(sum(l.gross_weight_kg), 0) FROM cargo_invoice_lines l JOIN cargo_invoices i ON i.id = l.invoice_id WHERE i.shipment_id = s.id)::text AS gw,
               (SELECT coalesce(sum(l.cbm), 0) FROM cargo_invoice_lines l JOIN cargo_invoices i ON i.id = l.invoice_id WHERE i.shipment_id = s.id)::text AS cbm
        FROM shipments s WHERE s.status <> 'COMPLETED' AND s.deleted_at IS NULL ORDER BY s.eta NULLS LAST, s.reference`,
  );

  let imp = 0;
  let exp = 0;
  let permitNo = 168_800;
  for (const sh of open) {
    const isImport = sh.direction === 'IMPORT';
    const stage = isImport
      ? sh.declared
        ? imp++ % 2
          ? 'DELIVERY'
          : 'CLEARANCE'
        : OPEN_IMPORT[imp++ % OPEN_IMPORT.length]!
      : sh.declared
        ? exp++ % 2
          ? 'BL'
          : 'CFS_DELIVERY'
        : OPEN_EXPORT[exp++ % OPEN_EXPORT.length]!;
    const days = (permitNo % 6) + 1;
    await db.execute(sql`
      UPDATE shipments SET workflow_stage = ${stage}, stage_changed_at = now() - make_interval(days => ${days})
      WHERE id = ${sh.id}`);
    const at = stageIndex(sh.direction, stage);
    const stages = isImport ? IMPORT_STAGES : EXPORT_STAGES;
    const prev = stages[at - 1];
    if (prev)
      await db.execute(sql`
        INSERT INTO shipment_stage_history (shipment_id, from_stage, to_stage, action, note, user_id, created_at)
        VALUES (${sh.id}, ${prev.key}, ${stage}, ${prev.approval ? 'APPROVE' : 'ADVANCE'}, NULL,
                ${prev.owner === 'OPERATION_MANAGER' ? ids.opsManagerId : prev.owner === 'BROKER' ? ids.brokerId : prev.owner === 'ACCOUNTANT' ? ids.accountantId : ids.operatorId},
                now() - make_interval(days => ${days}))`);

    if (isImport) {
      // A permit once the broker's stage is done; the first one runs close to its expiry.
      if (at > stageIndex('IMPORT', 'PERMIT')) {
        const issue = addDays(sh.eta ?? today, -6);
        const until = permitNo === 168_800 && !sh.declared ? addDays(today, 3) : addDays(issue, 30);
        await db.execute(sql`
          INSERT INTO customs_permits (shipment_id, permit_no, issue_date, valid_from, valid_until, office, created_by_id)
          VALUES (${sh.id}, ${`PRT${issue.replace(/-/g, '')}GDCE${permitNo}`}, ${issue}::date, ${issue}::date,
                  ${until}::date, 'CHQ42', ${ids.brokerId})`);
        permitNo++;
      }
      // Local charges from the destination agent once arrival is noted.
      if (at >= stageIndex('IMPORT', 'LOCAL_CHARGES')) {
        const paid = at > stageIndex('IMPORT', 'LOCAL_CHARGES');
        await db.execute(sql`
          INSERT INTO vendor_invoices (shipment_id, vendor_name, invoice_no, invoice_date, description, amount, vat, due_date, paid_on, payment_ref, created_by_id)
          VALUES (${sh.id}, 'FWF Full Well and Nisshin', ${`IMP${(sh.eta ?? today).replace(/-/g, '').slice(0, 6)}${String(permitNo).slice(-3)}`},
                  ${sh.eta ?? today}::date, 'THC, CIC, EMS, EIB 40''', 510, 0, ${addDays(sh.eta ?? today, 2)}::date,
                  ${paid ? (sh.eta ?? today) : null}::date, ${paid ? 'ABA transfer' : null}, ${ids.accountantId}),
                 (${sh.id}, 'FWF Full Well and Nisshin', ${`IMP${(sh.eta ?? today).replace(/-/g, '').slice(0, 6)}${String(permitNo).slice(-3)}A`},
                  ${sh.eta ?? today}::date, 'DO fee, document fee, handling', 165, 16.5, ${addDays(sh.eta ?? today, 2)}::date,
                  ${paid ? (sh.eta ?? today) : null}::date, ${paid ? 'ABA transfer' : null}, ${ids.accountantId})`);
      }
    } else {
      // The booking, and (from the CFS on) what the warehouse measured: one with a CBM gap.
      const pcs = Number(sh.pcs);
      const gw = Number(sh.gw);
      const cbm = Number(sh.cbm);
      const over = exp % 3 === 0 ? Math.round(pcs * 0.005) : 0;
      await db.execute(sql`
        UPDATE shipments SET booked_qty = ${String(pcs - over)}, booked_gross_weight_kg = ${(exp % 4 === 0 ? gw * 0.92 : gw).toFixed(3)},
               booked_cbm = ${cbm.toFixed(3)} WHERE id = ${sh.id}`);
      if (at >= stageIndex('EXPORT', 'CFS_DELIVERY') && cbm > 0) {
        const measured = exp % 2 ? cbm * 1.054 : cbm;
        await db.execute(sql`
          UPDATE shipments SET measured_cbm = ${measured.toFixed(3)}, measured_gross_weight_kg = ${(gw * 0.995).toFixed(3)}
          WHERE id = ${sh.id}`);
        await db.execute(sql`
          INSERT INTO vendor_invoices (shipment_id, vendor_name, invoice_no, invoice_date, description, amount, vat, billed_cbm, billed_gross_weight_kg, due_date, created_by_id)
          VALUES (${sh.id}, 'CF Global', ${`TICF2026${String(2900 + exp)}`}, ${sh.etd ?? today}::date,
                  'Handling, customs clearance, THC, CFS, BL, VGM, ACI', 626.83, 62.68, ${measured.toFixed(3)},
                  ${(gw * 0.995).toFixed(3)}, ${addDays(sh.etd ?? today, 14)}::date, ${ids.accountantId})`);
      }
    }
  }

  // Two finished jobs waiting to be closed: one normal, one with a thin margin for the CEO.
  const closing = await queryRows<{ id: string }>(
    db,
    sql`SELECT s.id FROM shipments s
        WHERE s.workflow_stage = 'CLOSED' AND EXISTS (
          SELECT 1 FROM customs_declarations d JOIN accounting_records a ON a.declaration_id = d.id WHERE d.shipment_id = s.id)
        ORDER BY coalesce(s.arrive_fty, s.atd) DESC NULLS LAST LIMIT 2`,
  );
  for (const [i, c] of closing.entries()) {
    await db.execute(
      sql`UPDATE shipments SET workflow_stage = 'CLOSING', stage_changed_at = now() - interval '1 day' WHERE id = ${c.id}`,
    );
    if (i === 1)
      await db.execute(sql`
        UPDATE accounting_records a SET other_pay = a.inv_revenue + a.dis_total + a.dn_total - a.clear_fee - a.thc - a.commission - 5,
               net_profit = 5
        FROM customs_declarations d WHERE d.id = a.declaration_id AND d.shipment_id = ${c.id}`);
  }
}
