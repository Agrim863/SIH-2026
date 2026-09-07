/**
 * Vessel class markers, vessel selection, and the vessel-instance drawer.
 * Compatibility comes from the canonical checkAllVesselsForVoyage() engine.
 * Vessel instances come from VESSEL_INSTANCES, not the legacy MOCK_VESSELS.
 */

import maplibregl from 'maplibre-gl';
import { VESSEL_CLASSES, type VesselClass, type VesselClassSpec } from '../../data/vessels';
import { VESSEL_INSTANCES, type VesselInstance } from '../../data/vesselInstances';
import type { VesselAvailability } from '../../lib/voyageAvailability';
import { clearVesselMarkers, getMap, vesselMarkers } from '../map';
import { TIMING } from '../../utils/timing';
import { flash } from './toast';
import { getState, setState } from '../state';
import { drawAnalysis } from './intelligence';

const $ = (selector: string): HTMLElement | null =>
  document.querySelector(selector);
const $$ = (selector: string): HTMLElement[] =>
  Array.from(document.querySelectorAll(selector));

/** Geographic offsets — vessels stand side-by-side just offshore of origin */
const VESSEL_OFFSETS: Record<VesselClass, { lng: number; lat: number }> = {
  handysize: { lng: -0.28, lat: -0.18 },
  supramax: { lng: -0.09, lat: -0.18 },
  panamax: { lng: 0.1, lat: -0.18 },
  capesize: { lng: 0.32, lat: -0.18 },
};

function shipModelHtml(vessel: VesselClassSpec, ok: boolean, reason: string | null): string {
  const size = vessel.dwt / 3000; // visual scale from DWT
  return `
    <div class="ship-3d" style="--ship-w:${size}px">
      <div class="ship-3d-hull"></div>
      <div class="ship-3d-super"></div>
      <div class="ship-3d-bridge"></div>
    </div>
    <b>${vessel.label}</b>
    <small>${ok ? vessel.draftM + 'm draft · compatible' : '✕ ' + (reason ?? 'Incompatible')}</small>
  `;
}

export function drawShips(): void {
  const s = getState();
  if (!s.routeAnimationComplete || !s.origin) return;

  clearVesselMarkers();
  const shipsEl = $('#ships');
  if (!shipsEl) return;
  shipsEl.classList.remove('hidden');
  shipsEl.innerHTML = '';

  const map = getMap();
  const availability = s.vesselAvailability ?? [];
  const lookup = new Map<VesselClass, VesselAvailability>();
  availability.forEach((a) => lookup.set(a.vesselClass, a));

  VESSEL_CLASSES.forEach((vessel, index) => {
    const avail = lookup.get(vessel.id);
    const ok = avail?.isCompatible ?? false;
    const reason = avail?.failureReason ?? null;

    const offset = VESSEL_OFFSETS[vessel.id];
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `ship-geo ship-marker ship-lineup ${ok ? '' : 'disabled'} ${s.selectedVesselClass === vessel.id ? 'selected' : ''}`;
    el.dataset.vessel = vessel.id;
    el.style.animationDelay = `${index * TIMING.shipEmergeStagger}ms`;
    el.title = ok
      ? `${vessel.label} · ${vessel.draftM}m draft`
      : `${vessel.label} unavailable — ${reason ?? 'incompatible'}`;
    el.innerHTML = shipModelHtml(vessel, ok, reason);

    if (ok) {
      el.onclick = () => selectVesselType(vessel.id);
    }

    if (map && s.origin && s.origin.lat !== null && s.origin.lng !== null) {
      const lng: number = s.origin.lng;
      const lat: number = s.origin.lat;
      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([lng + offset.lng, lat + offset.lat])
        .addTo(map);
      vesselMarkers.push(marker);
    } else {
      shipsEl.appendChild(el);
    }
  });
}

export function selectVesselType(id: VesselClass): void {
  setState({ selectedVesselClass: id, selectedVessel: null });
  drawShips();
  drawAnalysis();
  drawDrawer();
  const v = VESSEL_CLASSES.find((vc) => vc.id === id);
  if (v) flash(`${v.label} selected`);
}

export function drawDrawer(): void {
  const s = getState();
  if (!s.selectedVesselClass) return;

  const type = VESSEL_CLASSES.find((v) => v.id === s.selectedVesselClass);
  if (!type) return;
  const list = VESSEL_INSTANCES.filter((v) => v.vesselClass === s.selectedVesselClass);

  const dock = $('#vessel-dock');
  if (!dock) return;
  dock.classList.remove('hidden');
  const dockClass = $('#dock-class');
  const vesselCount = $('#vessel-count');
  const vesselList = $('#vessel-list');

  if (dockClass) dockClass.textContent = type.label;
  if (vesselCount) vesselCount.textContent = `${list.length} vessels found`;

  if (vesselList) {
    vesselList.innerHTML = list
      .map((v, i) => {
        const active = s.selectedVessel?.id === v.id || (!s.selectedVessel && i === 0);
        return `<article class="vessel-card ${active ? 'active' : ''}" data-vessel-name="${v.name}">
          <div class="mini-ship"></div>
          <div class="vessel-info">
            <span>${v.name}</span>
            <b>${v.dwt.toLocaleString()} DWT · ${v.loaM}m LOA · ${v.beamM}m beam · ${v.draftM}m draft</b>
          </div>
          <div class="vessel-rate"><b>$${(v.dailyRate / 1000).toFixed(1)}k</b><span>/day</span></div>
          <button type="button" class="select-vessel" data-select-vessel="${v.name}">${active ? 'Selected ✓' : 'Select'}</button>
        </article>`;
      })
      .join('');
  }

  // Default-select first vessel if none chosen
  if (!s.selectedVessel && list[0]) {
    setState({ selectedVessel: list[0] });
  }

  $$('[data-select-vessel]').forEach((btn) => {
    (btn as HTMLButtonElement).onclick = () => {
      const name = (btn as HTMLElement).dataset.selectVessel;
      const inst: VesselInstance | undefined = list.find((v) => v.name === name);
      if (inst) {
        setState({ selectedVessel: inst });
        drawDrawer();
        flash(`${name} selected`);
      }
    };
  });
}
