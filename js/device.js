// What this phone's browser can do: WebGPU adapter, f16 shaders, memory, sensors.
// Shown on the home screen; the LLM loader uses it to pick a model and dtype.

export async function deviceReport() {
  const r = { webgpu: false, f16: false, adapter: null, maxBufferMB: 0, cores: navigator.hardwareConcurrency || null, memoryGB: navigator.deviceMemory || null };
  r.sensors = { orientation: 'ondeviceorientationabsolute' in window || 'ondeviceorientation' in window, vibrate: 'vibrate' in navigator, speech: 'speechSynthesis' in window, camera: !!navigator.mediaDevices?.getUserMedia };
  if (!navigator.gpu) return r;
  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return r;
    const info = adapter.info || (await adapter.requestAdapterInfo?.()) || {};
    r.webgpu = true;
    r.f16 = adapter.features.has('shader-f16');
    r.adapter = [info.vendor, info.architecture, info.device, info.description].filter(Boolean).join(' ') || 'unknown GPU';
    r.maxBufferMB = Math.round(adapter.limits.maxBufferSize / 2 ** 20);
  } catch (e) {
    r.error = e.message;
  }
  return r;
}

export function describeDevice(r) {
  const gpu = r.webgpu ? `WebGPU ✓ ${r.adapter}${r.f16 ? ' · f16 ✓' : ' · f16 ✗'} · max buffer ${r.maxBufferMB} MB` : `WebGPU ✗${r.error ? ` (${r.error})` : ''}`;
  const s = r.sensors;
  const flags = [['camera', s.camera], ['compass', s.orientation], ['vibrate', s.vibrate], ['voice', s.speech]].map(([k, ok]) => `${k} ${ok ? '✓' : '✗'}`).join(' · ');
  return `${gpu}\n${r.cores ?? '?'} CPU threads · ${r.memoryGB ? `≥${r.memoryGB} GB RAM (browser-reported)` : 'RAM n/a'}\n${flags}`;
}
