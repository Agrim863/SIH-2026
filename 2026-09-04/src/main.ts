/**
 * Main application entry point.
 * Integrates voyage compatibility engine with UI layer.
 */

import { checkAllVesselsForVoyage } from './src/lib/voyageAvailability';
import { createShipGrid } from './src/components/ShipCard';
import { PORTS } from './src/data/ports';
import type { CargoCategory } from './src/data/cargo';

const $ = (selector: string): HTMLElement | null => document.querySelector(selector);
const $$ = (selector: string): HTMLElement[] => Array.from(document.querySelectorAll(selector));

// DOM elements
const originSelect = $('#origin') as HTMLSelectElement;
const destinationSelect = $('#destination') as HTMLSelectElement;
const cargoSelect = $('#cargo') as HTMLSelectElement;
const checkButton = $('#check-button') as HTMLButtonElement;
const resultsContainer = $('#results-container') as HTMLElement;

/**
 * Render the results view with voyage compatibility information and vessel cards.
 */
function renderResults(
  originPortId: string,
  destinationPortId: string,
  cargo: CargoCategory,
): void {
  const availabilities = checkAllVesselsForVoyage(originPortId, destinationPortId, cargo);

  const originPort = PORTS.find((p) => p.id === originPortId);
  const destPort = PORTS.find((p) => p.id === destinationPortId);

  if (!originPort || !destPort) {
    resultsContainer.innerHTML = '<div class="empty-state"><p>Ports not found</p></div>';
    return;
  }

  // Port info section
  const portInfoHTML = `
    <div class="port-info">
      <div class="port-item">
        <strong>Origin</strong>
        <span>${originPort.name}, ${originPort.country}</span>
      </div>
      <div class="port-item">
        <strong>Destination</strong>
        <span>${destPort.name}, ${destPort.country}</span>
      </div>
      <div class="port-item">
        <strong>Cargo</strong>
        <span>${cargo.replace(/_/g, ' ').toUpperCase()}</span>
      </div>
      <div class="port-item">
        <strong>Compatible Vessels</strong>
        <span>${availabilities.filter((a) => a.isCompatible).length} of ${availabilities.length}</span>
      </div>
    </div>
  `;

  // Vessel cards section
  const gridContainer = document.createElement('div');
  gridContainer.className = 'ship-grid-container';
  const shipGrid = createShipGrid(availabilities, (vessel) => {
    console.log('Selected vessel:', vessel);
    alert(`Selected: ${vessel.name} (${vessel.vesselClass.toUpperCase()})\nDWT: ${vessel.dwt}\nRate: $${vessel.dailyRate}/day`);
  });
  gridContainer.appendChild(shipGrid);

  resultsContainer.innerHTML = portInfoHTML;
  resultsContainer.appendChild(gridContainer);
}

/**
 * Handle the "Check Compatibility" button click.
 */
function handleCheckCompatibility(): void {
  const origin = originSelect.value;
  const destination = destinationSelect.value;
  const cargo = cargoSelect.value;

  if (!origin || !destination || !cargo) {
    alert('Please select origin, destination, and cargo');
    return;
  }

  if (origin === destination) {
    alert('Origin and destination must be different');
    return;
  }

  renderResults(origin, destination, cargo as CargoCategory);
}

/**
 * Initialize event listeners.
 */
function initializeEventListeners(): void {
  checkButton.addEventListener('click', handleCheckCompatibility);

  // Allow Enter to check
  const selects = [originSelect, destinationSelect, cargoSelect];
  selects.forEach((select) => {
    select.addEventListener('keypress', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleCheckCompatibility();
      }
    });
  });
}

/**
 * Initialize the application.
 */
function initializeApp(): void {
  initializeEventListeners();
  console.log('Maritime Voyage Planner initialized');
  console.log(`Loaded ${PORTS.length} ports and compatibility engine`);
}

// Start the app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  initializeApp();
}
