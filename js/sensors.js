// Phone sensors the browser can read, fused for guidance:
//   gyroscope  -> yaw (turns), integrated around the gravity axis so it works held upright or flat;
//                 unlike the compass it isn't thrown off by steel and wiring indoors
//   accelerometer (linear) -> walking steps and distance since the last landmark
//   gravity, rotation vector (absolute orientation), GPS watch, ambient light (sensor or camera brightness)
// Light, proximity, IR and raw magnetometer have no web API in Chrome by default: reported as "native only".

const FIX_KEY = 'pahunch.lastfix';

export class Sensors {
  constructor() {
    this.yaw = 0;            // degrees, + = turned right, since start or last resetYaw()
    this.steps = 0;
    this.accel = null;       // linear acceleration magnitude, m/s²
    this.gyro = null;        // { a, b, g } deg/s
    this.gravity = null;     // { x, y, z } m/s²
    this.quat = null;        // rotation vector (AbsoluteOrientationSensor) quaternion
    this.lux = null;         // AmbientLightSensor, if exposed
    this.pos = null;         // last GPS fix { lat, lon, acc, at }
    this.gpsError = null;
    this.lastFix = null;     // last good fix, kept across sessions (indoors / airplane mode: no new fix)
    try { this.lastFix = JSON.parse(localStorage.getItem(FIX_KEY) || 'null'); } catch {}
    this.avail = {};
    this._lastT = 0;
    this._peak = false;
    this._lastStep = 0;
  }

  start() {
    this.avail.motion = 'DeviceMotionEvent' in window;
    window.addEventListener('devicemotion', (e) => this._motion(e));
    // Generic Sensor API (Chrome Android): best effort, each one optional.
    const tryS = (name, opts, fn) => {
      try {
        if (!(name in window)) { this.avail[name] = false; return; }
        const s = new window[name](opts);
        s.addEventListener('reading', () => fn(s));
        s.addEventListener('error', () => { this.avail[name] = false; });
        s.start();
        this.avail[name] = true;
      } catch { this.avail[name] = false; }
    };
    tryS('GravitySensor', { frequency: 10 }, (s) => { this.gravity = { x: s.x, y: s.y, z: s.z }; });
    tryS('AbsoluteOrientationSensor', { frequency: 10 }, (s) => { this.quat = s.quaternion; });
    // Gyro + accelerometer fusion without the magnetometer: steady indoors, and the heading below
    // stays correct when the phone is held upright for the camera (Euler angles break there).
    tryS('RelativeOrientationSensor', { frequency: 30 }, (s) => { this.heading = cameraHeading(s.quaternion); });
    tryS('AmbientLightSensor', { frequency: 2 }, (s) => { this.lux = s.illuminance; });
    this.avail.Magnetometer = 'Magnetometer' in window;
    this.avail.Proximity = 'ProximitySensor' in window;
    this.watchGps();
  }

  // A fix: kept as the live position, and remembered (with the steps walked since) for when GPS goes quiet.
  _fix(lat, lon, acc, at = Date.now()) {
    this.pos = { lat, lon, acc: Math.round(acc), at };
    this.gpsError = null;
    this.stepsAtFix = this.totalSteps || 0;
    if (acc <= 100) { this.lastFix = { ...this.pos }; try { localStorage.setItem(FIX_KEY, JSON.stringify(this.lastFix)); } catch {} }
    this.onFix?.(this.pos);
  }

  // Best position for the door card: live fix, else the last good fix widened by the distance walked since.
  estimate(maxAgeMs = 6 * 3600e3) {
    const p = this.pos && Date.now() - this.pos.at < 60000 ? this.pos : null;
    if (p) return { ...p, estimated: false };
    const f = this.lastFix;
    if (!f || Date.now() - f.at > maxAgeMs) return null;
    const walked = Math.max(0, ((this.totalSteps || 0) - (this.stepsAtFix || 0)) * 0.7);
    return { ...f, acc: Math.round(f.acc + walked), estimated: true, ageMin: Math.round((Date.now() - f.at) / 60000) };
  }

  watchGps() {
    if (!navigator.geolocation) { this.gpsError = 'no GPS API'; return; }
    navigator.geolocation.clearWatch?.(this._watch);
    const ok = (p) => this._fix(p.coords.latitude, p.coords.longitude, p.coords.accuracy);
    const fail = (e) => {
      this.gpsError = e.code === 1 ? 'location permission denied' : e.code === 2 ? 'no GPS signal (indoors?)' : 'GPS timeout';
      // Fall back to network location if high accuracy keeps failing.
      if (e.code !== 1 && !this._lowAcc) { this._lowAcc = true; navigator.geolocation.getCurrentPosition(ok, () => {}, { enableHighAccuracy: false, timeout: 15000, maximumAge: 120000 }); }
    };
    this._watch = navigator.geolocation.watchPosition(ok, fail, { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 });
  }

  resetYaw() { this.yaw = 0; }
  resetSteps() { this.steps = 0; }

  _motion(e) {
    const r = e.rotationRate, g = e.accelerationIncludingGravity, a = e.acceleration;
    const t = e.timeStamp || performance.now();
    const dt = this._lastT ? Math.min(0.1, (t - this._lastT) / 1000) : 0;
    this._lastT = t;
    if (r && r.alpha != null) {
      this.gyro = { a: r.alpha, b: r.beta, g: r.gamma };
      // Yaw rate = rotation about the "up" axis: project (beta about x, gamma about y, alpha about z) onto gravity.
      const up = this.gravity ? [this.gravity.x, this.gravity.y, this.gravity.z] : g ? [g.x, g.y, g.z] : null;
      if (up && dt) {
        const n = Math.hypot(...up) || 1;
        const rate = (r.beta * up[0] + r.gamma * up[1] + r.alpha * up[2]) / n; // + = counter-clockwise from above = left
        if (Math.abs(rate) > 2) this.yaw -= rate * dt; // ignore gyro drift below 2°/s
      }
    }
    if (a && a.x != null) {
      const m = Math.hypot(a.x, a.y, a.z);
      this.accel = m;
      // Step = a peak above 1.6 m/s² after a dip, at most ~3 steps a second.
      if (m > 1.6 && !this._peak && t - this._lastStep > 330) { this._peak = true; this._lastStep = t; this.steps++; this.totalSteps = (this.totalSteps || 0) + 1; }
      else if (m < 0.8) this._peak = false;
    }
  }

  // Short lines for the sensors panel.
  report(extra = {}) {
    const f = (v, d = 1) => (v == null ? '–' : v.toFixed(d));
    const yes = (k) => (this.avail[k] ? '✓' : 'native only');
    return [
      `Gyroscope      ${this.gyro ? `${f(this.gyro.a, 0)} / ${f(this.gyro.b, 0)} / ${f(this.gyro.g, 0)} °/s` : 'waiting…'}`,
      `Turn (gyro)    ${f(this.yaw, 0)}°`,
      `Accelerometer  ${this.accel == null ? 'waiting…' : `${f(this.accel, 2)} m/s²`} · steps ${this.steps} (~${Math.round(this.steps * 0.7)} m)`,
      `Gravity        ${this.gravity ? `${f(this.gravity.x)} ${f(this.gravity.y)} ${f(this.gravity.z)}` : yes('GravitySensor')}`,
      `Rotation vec.  ${this.quat ? this.quat.map((q) => q.toFixed(2)).join(' ') : yes('AbsoluteOrientationSensor')}`,
      `Compass        ${extra.heading == null ? 'waiting…' : `${Math.round(extra.heading)}°`}`,
      `GPS            ${this.pos ? `${this.pos.lat.toFixed(5)}, ${this.pos.lon.toFixed(5)} ±${this.pos.acc} m` : this.gpsError || 'searching…'}`,
      `Light          ${this.lux != null ? `${Math.round(this.lux)} lux` : extra.brightness != null ? `camera brightness ${Math.round(extra.brightness * 100)}%` : yes('AmbientLightSensor')}`,
      `Magnetometer   ${this.avail.Magnetometer ? '✓ (via compass)' : 'used via compass heading'}`,
      `Proximity / IR native only (no web API)`,
    ].join('\n');
  }
}

// Direction the camera looks, in degrees around the vertical (any fixed origin; only changes matter).
// Rotates the camera axis (device -Z) into the world frame and takes its horizontal bearing; if the phone
// lies flat (camera pointing down) the top edge (device +Y) is used instead.
export function cameraHeading(q) {
  if (!q) return null;
  const [x, y, z, w] = q;
  const rot = (vx, vy, vz) => {
    // v' = q * v * q^-1
    const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
    return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
  };
  let v = rot(0, 0, -1);
  if (Math.abs(v[2]) > 0.8) v = rot(0, 1, 0);
  return ((Math.atan2(v[0], v[1]) * 180) / Math.PI + 360) % 360; // clockwise from the world Y axis
}

// Gyro-based turn detector: same contract as guide.js TurnDetector (delta, tick, want), so the overlay arc works.
export const TURN_AT = 60; // degrees: a real corner, but not a full 90 (people rarely turn exactly 90)

export class GyroTurn {
  constructor(sensors, compass, want, onTurn) {
    this.s = sensors; this.compass = compass; this.want = want; this.onTurn = onTurn;
    this.y0 = sensors.yaw;
    this.f0 = sensors.heading ?? null;
    this.h0 = compass?.heading ?? null;
    this.since = null;
  }
  get delta() {
    // 1) fused orientation (best), 2) integrated gyro, 3) compass.
    if (this.f0 == null && this.s.heading != null) this.f0 = this.s.heading;
    if (this.f0 != null && this.s.heading != null) return ((this.s.heading - this.f0 + 540) % 360) - 180;
    const g = this.s.gyro ? this.s.yaw - this.y0 : null;
    const c = this.h0 != null && this.compass?.heading != null ? ((this.compass.heading - this.h0 + 540) % 360) - 180 : null;
    // Gyro first (smooth, not disturbed indoors); compass if there is no gyro.
    return g ?? c;
  }
  tick(now = performance.now()) {
    const d = this.delta;
    if (d == null) return;
    const ok = this.want === 'right' ? d >= TURN_AT && d <= 160 : d <= -TURN_AT && d >= -160;
    if (!ok) { this.since = null; return; }
    this.since ??= now;
    if (now - this.since >= 400) { const f = this.onTurn; this.onTurn = () => {}; f(); }
  }
}
