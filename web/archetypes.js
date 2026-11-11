// Floor archetypes.
//
// A store type is not a label on a screen. It decides which positions exist to fight
// over, and that changes the problem the optimiser is solving. A corner shop has a
// counter and a window and no weekly circular at all, so its whole game is the three
// feet beside the till. A supermarket has seven endcaps and a front page.
//
// Levels carry the meaning the model was fitted on: display level 2 is a prime
// position, level 1 is secondary; mailer level 2 is the front page, level 1 interior.
// Nothing here invents a lever the model has not seen.

export const ARCHETYPES = {
  corner_store: {
    key: 'corner_store',
    title: 'Corner store',
    note: 'A 1,200 sq ft counter-led shop.',
    description: 'Small counter-led shop. One till, wall coolers, no weekly circular.',
    size: { w: 9.0, d: 13.0, h: 2.9 },
    visits_per_week: 3500,
    entrance: { x: 4.5, z: 0.0, w: 2.5 },
    checkouts: [{ x: 7.4, z: 2.2, w: 1.1, d: 2.4 }],
    posters: [
      { x: 1.2, z: 6.0, w: 1.0, h: 1.3, text: 'COLD' },
      { x: 7.8, z: 9.0, w: 1.0, h: 1.3, text: 'DEALS' },
    ],
    slots: [
      { id: 'checklane', kind: 'display', level: 2, label: 'Counter stack',
        x: 6.2, z: 3.8, w: 1.2, d: 1.2 },
      { id: 'cooler_endcap', kind: 'display', level: 2, label: 'Cooler end, front',
        x: 1.9, z: 6.4, w: 1.4, d: 1.4 },
      { id: 'window_stack', kind: 'display', level: 1, label: 'Window stack',
        x: 2.2, z: 1.9, w: 1.4, d: 1.2 },
    ],
  },

  neighborhood_market: {
    key: 'neighborhood_market',
    title: 'Neighbourhood market',
    note: 'A 8,800 sq ft neighbourhood supermarket.',
    description: 'Small grocer. Several aisles, a cooler wall, four tills, a weekly flyer.',
    size: { w: 24.0, d: 34.0, h: 3.4 },
    visits_per_week: 12000,
    entrance: { x: 4.5, z: 0.0, w: 4.0 },
    checkouts: [0, 1, 2, 3].map(i => ({ x: 12.0 + i * 2.6, z: 3.0, w: 1.1, d: 3.0 })),
    posters: [
      { x: 11.0, z: 10.4, w: 1.5, h: 1.0, text: 'THIS WEEK' },
      { x: 2.0, z: 16.0, w: 1.2, h: 1.6, text: 'FRESH' },
      { x: 23.4, z: 20.0, w: 1.2, h: 1.6, text: 'SAVE' },
    ],
    slots: [
      { id: 'endcap_front_left', kind: 'display', level: 2, label: 'Entrance endcap (left)',
        x: 8.6, z: 7.4, w: 2.4, d: 1.2 },
      { id: 'endcap_front_right', kind: 'display', level: 2, label: 'Entrance endcap (right)',
        x: 15.4, z: 7.4, w: 2.4, d: 1.2 },
      { id: 'island_mid', kind: 'display', level: 1, label: 'Mid-floor island',
        x: 12.0, z: 19.0, w: 2.2, d: 2.2 },
      { id: 'island_rear', kind: 'display', level: 1, label: 'Rear island',
        x: 6.2, z: 27.0, w: 2.0, d: 2.0 },
      { id: 'checklane', kind: 'display', level: 1, label: 'Checklane stack',
        x: 19.4, z: 5.0, w: 1.6, d: 1.6 },
      { id: 'flyer_front_1', kind: 'mailer', level: 2, label: 'Flyer front page, lead' },
      { id: 'flyer_front_2', kind: 'mailer', level: 2, label: 'Flyer front page, second' },
      { id: 'flyer_in_1', kind: 'mailer', level: 1, label: 'Flyer interior A' },
      { id: 'flyer_in_2', kind: 'mailer', level: 1, label: 'Flyer interior B' },
      { id: 'flyer_in_3', kind: 'mailer', level: 1, label: 'Flyer interior C' },
    ],
  },

  supermarket: {
    key: 'supermarket',
    title: 'Supermarket',
    note: 'A 19,600 sq ft full-line supermarket.',
    description: 'Full-line store. Long aisles, many endcaps, a multi-page circular.',
    size: { w: 38.0, d: 48.0, h: 4.2 },
    visits_per_week: 28000,
    entrance: { x: 7.0, z: 0.0, w: 6.0 },
    checkouts: [0, 1, 2, 3, 4, 5, 6, 7].map(i => ({ x: 17.0 + i * 2.6, z: 3.4, w: 1.1, d: 3.2 })),
    posters: [
      { x: 18.0, z: 12.0, w: 2.0, h: 1.2, text: 'THIS WEEK' },
      { x: 1.6, z: 22.0, w: 1.3, h: 1.8, text: 'FRESH' },
      { x: 36.4, z: 28.0, w: 1.3, h: 1.8, text: 'SAVE' },
    ],
    slots: [
      { id: 'endcap_front_left', kind: 'display', level: 2, label: 'Entrance endcap (left)',
        x: 12.0, z: 9.5, w: 2.6, d: 1.3 },
      { id: 'endcap_front_right', kind: 'display', level: 2, label: 'Entrance endcap (right)',
        x: 26.0, z: 9.5, w: 2.6, d: 1.3 },
      { id: 'endcap_mid_left', kind: 'display', level: 1, label: 'Mid-aisle endcap (left)',
        x: 12.0, z: 25.0, w: 2.6, d: 1.3 },
      { id: 'endcap_mid_right', kind: 'display', level: 1, label: 'Mid-aisle endcap (right)',
        x: 26.0, z: 25.0, w: 2.6, d: 1.3 },
      { id: 'island_mid', kind: 'display', level: 1, label: 'Mid-floor island',
        x: 19.0, z: 19.0, w: 2.6, d: 2.6 },
      { id: 'island_rear', kind: 'display', level: 1, label: 'Rear island',
        x: 19.0, z: 38.0, w: 2.4, d: 2.4 },
      { id: 'checklane', kind: 'display', level: 1, label: 'Checklane stack',
        x: 33.0, z: 6.0, w: 1.6, d: 1.6 },
      { id: 'flyer_front_1', kind: 'mailer', level: 2, label: 'Circular front page, lead' },
      { id: 'flyer_front_2', kind: 'mailer', level: 2, label: 'Circular front page, second' },
      { id: 'flyer_in_1', kind: 'mailer', level: 1, label: 'Circular interior A' },
      { id: 'flyer_in_2', kind: 'mailer', level: 1, label: 'Circular interior B' },
      { id: 'flyer_in_3', kind: 'mailer', level: 1, label: 'Circular interior C' },
      { id: 'flyer_in_4', kind: 'mailer', level: 1, label: 'Circular interior D' },
    ],
  },
};

export const DEFAULT_ARCHETYPE = 'neighborhood_market';

/** The compact form the vision pass is shown, so it picks a type and names real slot ids. */
export function archetypeCatalog() {
  return Object.fromEntries(Object.values(ARCHETYPES).map(a => [a.key, {
    description: a.description,
    approx_size_m: `${a.size.w} x ${a.size.d}`,
    contested_positions: a.slots.map(s => `${s.id} (${s.label})`),
  }]));
}
