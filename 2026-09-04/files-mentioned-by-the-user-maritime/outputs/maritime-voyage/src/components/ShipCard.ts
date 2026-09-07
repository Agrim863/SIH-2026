/**
 * Ship Card UI Component
 * Renders individual vessel availability cards with compatibility status.
 * Compatible vessels show saturated visuals; incompatible show desaturated with reasons.
 */

import type { VesselAvailability } from '../lib/voyageAvailability';
import type { VesselInstance } from '../data/vesselInstances';
import { VESSEL_INSTANCES } from '../data/vesselInstances';

export interface ShipCardOptions {
  availability: VesselAvailability;
  instance?: VesselInstance;
  onSelect?: (vessel: VesselInstance) => void;
}

/**
 * Create a ship card DOM element for a vessel.
 * Shows saturation based on compatibility; displays failure reason as tooltip.
 */
export function createShipCard(options: ShipCardOptions): HTMLElement {
  const { availability, instance, onSelect } = options;
  const vesselInstances = VESSEL_INSTANCES.filter(
    (v) => v.vesselClass === availability.vesselClass,
  );
  const displayInstance = instance || vesselInstances[0];

  if (!displayInstance) {
    throw new Error(`No vessel instance found for class ${availability.vesselClass}`);
  }

  const card = document.createElement('div');
  card.className = `ship-card ${availability.isCompatible ? 'compatible' : 'incompatible'}`;
  card.setAttribute('data-vessel-class', availability.vesselClass);

  // Status indicator
  const statusClass = availability.isCompatible
    ? 'ship-status-compatible'
    : 'ship-status-incompatible';

  const failureTooltip = availability.failureReason
    ? `title="${availability.failureReason}"`
    : '';

  card.innerHTML = `
    <div class="ship-visual">
      <div class="ship-model ${availability.vesselClass}"></div>
      <span class="${statusClass}"></span>
    </div>
    <div class="ship-info">
      <div class="ship-class">${displayInstance.vesselClass.toUpperCase()}</div>
      <div class="ship-name">${displayInstance.name}</div>
      <div class="ship-specs">
        <div>LOA ${displayInstance.loaM}m</div>
        <div>Draft ${displayInstance.draftM}m</div>
        <div>Beam ${displayInstance.beamM}m</div>
      </div>
      <div class="ship-dwt">${(displayInstance.dwt / 1000).toFixed(0)}k DWT</div>
      <div class="ship-rate">$${(displayInstance.dailyRate / 1000).toFixed(1)}k/day</div>
      ${
        availability.failureReason
          ? `<div class="ship-failure" ${failureTooltip}>${availability.failureReason}</div>`
          : ''
      }
    </div>
  `;

  if (onSelect) {
    card.addEventListener('click', () => onSelect(displayInstance));
  }

  return card;
}

/**
 * Create a container of ship cards for all vessel classes in a voyage.
 */
export function createShipGrid(
  availabilities: VesselAvailability[],
  onSelect?: (vessel: VesselInstance) => void,
): HTMLElement {
  const grid = document.createElement('div');
  grid.className = 'ship-grid';

  availabilities.forEach((availability) => {
    const card = createShipCard({ availability, onSelect });
    grid.appendChild(card);
  });

  return grid;
}
