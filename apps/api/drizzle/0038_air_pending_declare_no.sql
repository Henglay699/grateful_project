-- An air shipment's declaration can be saved with its date while the number is pending.
ALTER TABLE "customs_declarations" ALTER COLUMN "declare_no" DROP NOT NULL;