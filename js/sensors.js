// Phone sensors the browser can read, fused for guidance:
//   gyroscope  -> yaw (turns), integrated around the gravity axis so it works held upright or flat;
//                 unlike the compass it isn't thrown off by steel and wiring indoors
//   accelerometer (linear) -> walking steps and distance since the last landmark
//   gravity, rotation vector (absolute orientation), GPS watch, ambient light (sensor or camera brightness)
// Light, proximity, IR and raw magnetometer have no web API in Chrome by default: reported as "native only".

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
    tryS('AmbientLightSensor', { frequency: 2 }, (s) => { this.lux = s.illuminance; });
    this.avail.Magnetometer = 'Magnetometer' in window;
    this.avail.Proximity = 'ProximitySensor' in window;
    this.watchGps();
  }

  watchGps() {
    if (!navigator.geolocation) { this.gpsError = 'no GPS API'; return; }
    navigator.geolocation.clearWatch?.(this._watch);
    const ok = (p) => { this.pos = { lat: p.coords.latitude, lon: p.coords.longitude, acc: Math.round(p.coords.accuracy), at: Date.now() }; this.gpsError = null; };
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
      if (m > 1.6 && !this._peak && t - this._lastStep > 330) { this._peak = true; this._lastStep = t; this.steps++; }
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

// Gyro-based turn detector: same contract as guide.js TurnDetector (delta, tick, want), so the overlay arc works.
export class GyroTurn {
  constructor(sensors, compass, want, onTurn) {
    this.s = sensors; this.compass = compass; this.want = want; this.onTurn = onTurn;
    this.y0 = sensors.yaw;
    this.h0 = compass?.heading ?? null;
    this.since = null;
  }
  get delta() {
    const g = this.s.gyro ? this.s.yaw - this.y0 : null;
    const c = this.h0 != null && this.compass?.heading != null ? ((this.compass.heading - this.h0 + 540) % 360) - 180 : null;
    // Gyro first (smooth, not disturbed indoors); compass if there is no gyro.
    return g ?? c;
  }
  tick(now = performance.now()) {
    const d = this.delta;
    if (d == null) return;
    const ok = this.want === 'right' ? d >= 55 && d <= 150 : d <= -55 && d >= -150;
    if (!ok) { this.since = null; return; }
    this.since ??= now;
    if (now - this.since >= 500) { const f = this.onTurn; this.onTurn = () => {}; f(); }
  }
}
