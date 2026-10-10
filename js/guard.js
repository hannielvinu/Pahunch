// Local-only network guard: nothing the app (or a library inside it) requests may leave the phone.
// Loaded before everything else. Off-device fetch / XHR / beacon calls are refused and remembered, so the
// offline chip can say what was blocked. (Found because MediaPipe's vision bundle posts usage logs to
// odml.pa.googleapis.com; the model itself runs locally.)

const LOCAL = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
export const blocked = [];

export function isLocal(url) {
  try {
    const u = new URL(url, location.href);
    return !/^https?:$/.test(u.protocol) || LOCAL.has(u.hostname);
  } catch { return true; }
}

const note = (u) => { blocked.push(String(u).slice(0, 120)); guard.onBlock?.(blocked); };
export const guard = { onBlock: null };

const realFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const u = typeof input === 'string' ? input : input?.url;
  if (u && !isLocal(u)) { note(u); return Promise.reject(new TypeError('Blocked: Pahunch keeps data on this phone')); }
  return realFetch(input, init);
};

const realOpen = XMLHttpRequest.prototype.open;
const realSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.open = function (method, url, ...rest) {
  this.__pahunchBlocked = !isLocal(url);
  if (this.__pahunchBlocked) note(url);
  return realOpen.call(this, method, this.__pahunchBlocked ? 'data:,' : url, ...rest);
};
XMLHttpRequest.prototype.send = function (body) {
  if (this.__pahunchBlocked) { setTimeout(() => this.dispatchEvent(new Event('error')), 0); return; }
  return realSend.call(this, body);
};

if (navigator.sendBeacon) {
  const realBeacon = navigator.sendBeacon.bind(navigator);
  navigator.sendBeacon = (url, data) => (isLocal(url) ? realBeacon(url, data) : (note(url), false));
}
