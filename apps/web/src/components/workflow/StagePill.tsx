import { CLOSED_STAGE, stageLabel, stagesFor, type Direction } from '@gs/shared';
import { ownerTone } from './glyphs';
import w from './Workflow.module.css';

/** A shipment's workflow stage, coloured by the role that has it. */
export function StagePill({ direction, stage }: { direction: Direction; stage: string }) {
  if (stage === CLOSED_STAGE)
    return (
      <span className={w.stagePill} data-closed>
        Closed
      </span>
    );
  const def = stagesFor(direction).find((s) => s.key === stage);
  return (
    <span className={w.stagePill} data-tone={def ? ownerTone(def.owner) : undefined}>
      {stageLabel(direction, stage)}
    </span>
  );
}
