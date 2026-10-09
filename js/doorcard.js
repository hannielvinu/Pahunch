// Door cards: what a rider learns on arrival (photo, DIGIPIN, floor, route), kept on the phone in localStorage.
import { describe } from './parser.js';
import { encodeDigipin } from './digipin.js';

const KEY = 'pahunch.doors.v1';
const MAX_CARDS = 30;

export function loadCards(store = globalThis.localStorage) {
  try { return JSON.parse(store?.getItem(KEY) || '[]'); } catch { return []; }
}

// Newest first. If storage is full, drop the oldest photos, then the oldest cards, until it fits.
export function saveCard(card, store = globalThis.localStorage) {
  const cards = [card, ...loadCards(store).filter((c) => c.id !== card.id)].slice(0, MAX_CARDS);
  for (;;) {
    try { store.setItem(KEY, JSON.stringify(cards)); return true; } catch {
      const old = [...cards].reverse().find((c, k) => c.photo && k < cards.length - 1);
      if (old) old.photo = null;
      else if (cards.length > 1) cards.pop();
      else return false;
    }
  }
}

export function deleteCard(id, store = globalThis.localStorage) {
  store.setItem(KEY, JSON.stringify(loadCards(store).filter((c) => c.id !== id)));
}

export function makeCard(graph, { secs = null, lang = graph.lang, at = Date.now() } = {}) {
  const arrive = graph.steps[graph.steps.length - 1];
  return {
    id: `d${at.toString(36)}`,
    at,
    note: graph.note || '',
    route: graph.steps.map(describe),
    dest: describe(arrive).replace(/^Arrive: /, ''),
    floor: graph.floor ?? null,
    lang,
    secs,
    digipin: null, lat: null, lon: null, acc: null,
    photo: null,
  };
}

export function setPosition(card, { latitude, longitude, accuracy }) {
  Object.assign(card, {
    lat: Math.round(latitude * 1e6) / 1e6,
    lon: Math.round(longitude * 1e6) / 1e6,
    acc: accuracy != null ? Math.round(accuracy) : null,
    digipin: encodeDigipin(latitude, longitude),
  });
  return card;
}

// What the QR carries: enough for another phone to load the same door (no photo, it is too big for a QR).
export function qrPayload(card) {
  const o = { pahunch: 1, digipin: card.digipin, floor: card.floor, dest: card.dest, note: card.note };
  return JSON.stringify(o);
}

// Full card as JSON for the laptop (Office Kit). Photo included as a data URL.
export function cardJson(card) {
  return JSON.stringify({ app: 'Pahunch', version: 1, ...card, at: new Date(card.at).toISOString() }, null, 2);
}

// Shrink a camera photo to a small JPEG data URL so dozens of cards fit in localStorage.
export async function shrinkPhoto(file, max = 640, quality = 0.72) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return c.toDataURL('image/jpeg', quality);
}

// Current position, or null after `ms` (indoors / no permission).
export function locate(ms = 15000) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition((p) => resolve(p.coords), () => resolve(null),
      { enableHighAccuracy: true, timeout: ms, maximumAge: 30000 });
  });
}
