package com.hannielvinu.pahunch;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognitionSupport;
import android.speech.RecognitionSupportCallback;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.view.WindowManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Pahunch on Android: the app itself is served on this phone by Termux (localhost:8080, with the on-device
 * LLM and Whisper next to it); this shell shows it full screen and gives it what a browser can't:
 *  - Android's own speech recogniser (Google's, the engine Gboard voice typing uses), offline when the
 *    language pack is on the phone: on-device recogniser first, then the default one with "prefer offline"
 *  - Android text-to-speech, satellite GPS that works in airplane mode, screen kept on
 * The page talks to it through window.PahunchNative; answers come back through window.__pahunch(type, data).
 */
public class MainActivity extends Activity {
    static final String APP = "http://localhost:8080/index.html";
    static final String[] PERMS = {
        Manifest.permission.RECORD_AUDIO, Manifest.permission.CAMERA,
        Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION,
        "com.termux.permission.RUN_COMMAND",
    };
    static final String[] ERRORS = {"", "NETWORK_TIMEOUT", "NETWORK", "AUDIO", "SERVER", "CLIENT", "SPEECH_TIMEOUT",
        "NO_MATCH", "RECOGNIZER_BUSY", "INSUFFICIENT_PERMISSIONS", "TOO_MANY_REQUESTS", "SERVER_DISCONNECTED",
        "LANGUAGE_NOT_SUPPORTED", "LANGUAGE_UNAVAILABLE", "CANNOT_CHECK_SUPPORT", "CANNOT_LISTEN_TO_DOWNLOAD_EVENTS"};

    final Handler main = new Handler(Looper.getMainLooper());
    WebView web;
    SpeechRecognizer rec;
    TextToSpeech tts;
    boolean ttsReady, pageUp, engineAsked;
    LocationManager lm;
    Location last;
    String pending = "";   // hash to open once the page is up (partner hand-over)
    int tries;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        web = new WebView(this);
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUserAgentString(s.getUserAgentString() + " PahunchApp/1");
        WebView.setWebContentsDebuggingEnabled(true);
        web.addJavascriptInterface(new Bridge(), "PahunchNative");
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest r) { main.post(() -> r.grant(r.getResources())); }
            @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback cb) { cb.invoke(origin, true, false); }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override public void onReceivedError(WebView v, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) engineDown();
            }
            @Override public void onPageFinished(WebView v, String url) {
                if (url.startsWith("http")) { pageUp = true; tries = 0; }
            }
        });
        tts = new TextToSpeech(this, st -> ttsReady = st == TextToSpeech.SUCCESS);
        lm = (LocationManager) getSystemService(LOCATION_SERVICE);
        handOver(getIntent());
        List<String> need = new ArrayList<>();
        for (String p : PERMS) if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) need.add(p);
        if (!need.isEmpty()) requestPermissions(need.toArray(new String[0]), 1);
        else startGps();
        open();
    }

    void open() { web.loadUrl(APP + "?app=1" + pending); }

    // pahunch://go?text=...&mode=ambulance -> index.html#go=...&mode=ambulance
    void handOver(Intent i) {
        Uri u = i == null ? null : i.getData();
        if (u == null || !"pahunch".equals(u.getScheme())) return;
        String text = u.getQueryParameter("text");
        String mode = u.getQueryParameter("mode");
        if (text == null) return;
        pending = "#go=" + Uri.encode(text) + "&mode=" + (mode == null ? "delivery" : Uri.encode(mode));
    }

    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        handOver(i);
        if (!pending.isEmpty()) open();
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        startGps();
        if (pageUp) web.reload(); // camera/mic just allowed: let the page ask again
    }

    // The engine (Termux) isn't serving yet: ask Termux to start it once, show a calm screen, retry.
    void engineDown() {
        pageUp = false;
        if (!engineAsked) { engineAsked = true; startEngine(); }
        String html = "<html><body style=\"font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:90vh;color:#1c1c1c;text-align:center;padding:24px\">"
            + "<div style=\"width:64px;height:64px;border-radius:18px;background:#e23744\"></div>"
            + "<h2 style=\"margin:18px 0 6px\">Starting Pahunch on this phone…</h2>"
            + "<p style=\"color:#6b6f76;max-width:320px\">Loading the on-device engine. If this takes long, open Termux and run:<br><code>cd ~/Pahunch &amp;&amp; bash tools/start.sh --bg</code></p></body></html>";
        web.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
        if (tries++ < 90) main.postDelayed(this::open, 2000);
    }

    void startEngine() {
        try {
            Intent i = new Intent("com.termux.RUN_COMMAND");
            i.setClassName("com.termux", "com.termux.app.RunCommandService");
            i.putExtra("com.termux.RUN_COMMAND_PATH", "/data/data/com.termux/files/usr/bin/bash");
            i.putExtra("com.termux.RUN_COMMAND_ARGUMENTS", new String[]{"-c", "cd ~/Pahunch && bash tools/start.sh --bg"});
            i.putExtra("com.termux.RUN_COMMAND_WORKDIR", "/data/data/com.termux/files/home");
            i.putExtra("com.termux.RUN_COMMAND_BACKGROUND", true);
            startForegroundService(i);
        } catch (Exception ignored) { /* Termux missing or external apps not allowed: the screen says what to do */ }
    }

    // ---------- GPS: satellites work in airplane mode; network location is used too when there is one ----------
    final LocationListener gps = new LocationListener() {
        @Override public void onLocationChanged(Location l) {
            if (last == null || l.getAccuracy() <= last.getAccuracy() + 5 || l.getTime() - last.getTime() > 15000) { last = l; emit("location", loc(l)); }
        }
        @Override public void onStatusChanged(String p, int s, Bundle e) {}
        @Override public void onProviderEnabled(String p) {}
        @Override public void onProviderDisabled(String p) {}
    };

    void startGps() {
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) return;
        try {
            for (String p : new String[]{LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER}) {
                if (!lm.isProviderEnabled(p)) continue;
                Location k = lm.getLastKnownLocation(p);
                if (k != null && (last == null || k.getTime() > last.getTime())) last = k;
                lm.requestLocationUpdates(p, 1000, 0, gps, Looper.getMainLooper());
            }
        } catch (Exception ignored) {}
    }

    JSONObject loc(Location l) {
        JSONObject o = new JSONObject();
        try {
            o.put("lat", l.getLatitude()).put("lon", l.getLongitude()).put("acc", Math.round(l.getAccuracy()))
             .put("at", l.getTime()).put("provider", l.getProvider());
        } catch (Exception ignored) {}
        return o;
    }

    // ---------- Speech recognition ----------
    void listen(String lang, boolean onDevice) {
        if (rec != null) { rec.destroy(); rec = null; }
        final boolean dev = onDevice && Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(this);
        if (!dev && !SpeechRecognizer.isRecognitionAvailable(this)) { emit("speech", obj("type", "error", "code", "NO_RECOGNIZER")); return; }
        rec = dev ? SpeechRecognizer.createOnDeviceSpeechRecognizer(this) : SpeechRecognizer.createSpeechRecognizer(this);
        final String engine = dev ? "on-device" : "google";
        Intent it = intent(lang);
        rec.setRecognitionListener(new RecognitionListener() {
            boolean heard;
            long rmsAt;
            @Override public void onReadyForSpeech(Bundle p) { emit("speech", obj("type", "ready", "engine", engine)); }
            @Override public void onBeginningOfSpeech() { heard = true; emit("speech", obj("type", "start", "engine", engine)); }
            @Override public void onRmsChanged(float db) {
                long now = System.currentTimeMillis();
                if (now - rmsAt < 90) return; // ~10 a second is plenty for the waveform
                rmsAt = now;
                emit("speech", obj("type", "level", "db", String.valueOf(db)));
            }
            @Override public void onBufferReceived(byte[] b) {}
            @Override public void onEndOfSpeech() { emit("speech", obj("type", "end", "engine", engine)); }
            @Override public void onError(int e) {
                String code = e > 0 && e < ERRORS.length ? ERRORS[e] : "ERROR_" + e;
                // The on-device recogniser has no pack for this language: same request through Google's default one.
                if (dev && !heard && (e == 12 || e == 13 || e == 5 || e == 4)) { main.post(() -> listen(lang, false)); return; }
                emit("speech", obj("type", "error", "code", code, "engine", engine));
            }
            @Override public void onResults(Bundle r) { emit("speech", obj("type", "final", "text", best(r), "engine", engine)); }
            @Override public void onPartialResults(Bundle r) { String t = best(r); if (!t.isEmpty()) emit("speech", obj("type", "partial", "text", t, "engine", engine)); }
            @Override public void onEvent(int t, Bundle p) {}
        });
        rec.startListening(it);
    }

    Intent intent(String lang) {
        Intent it = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        it.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        it.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
        it.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, lang);
        it.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        it.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        it.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
        it.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 2500);
        it.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 2000);
        it.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getPackageName());
        return it;
    }

    static String best(Bundle r) {
        ArrayList<String> l = r == null ? null : r.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        return l == null || l.isEmpty() || l.get(0) == null ? "" : l.get(0);
    }

    // Which languages the on-device recogniser has installed (Android 13+), for the setup screen.
    void languages(String lang) {
        if (Build.VERSION.SDK_INT < 33 || !SpeechRecognizer.isOnDeviceRecognitionAvailable(this)) {
            emit("languages", obj("lang", lang));
            return;
        }
        final SpeechRecognizer r = SpeechRecognizer.createOnDeviceSpeechRecognizer(this);
        r.checkRecognitionSupport(intent(lang), getMainExecutor(), new RecognitionSupportCallback() {
            @Override public void onSupportResult(RecognitionSupport s) {
                JSONObject o = new JSONObject();
                try {
                    o.put("lang", lang).put("known", true)
                     .put("installed", new JSONArray(s.getInstalledOnDeviceLanguages()))
                     .put("pending", new JSONArray(s.getPendingOnDeviceLanguages()))
                     .put("supported", new JSONArray(s.getSupportedOnDeviceLanguages()));
                } catch (Exception ignored) {}
                emit("languages", o);
                r.destroy();
            }
            @Override public void onError(int e) { emit("languages", obj("lang", lang, "code", String.valueOf(e))); r.destroy(); }
        });
    }

    void download(String lang) {
        if (Build.VERSION.SDK_INT < 33 || !SpeechRecognizer.isOnDeviceRecognitionAvailable(this)) return;
        SpeechRecognizer r = SpeechRecognizer.createOnDeviceSpeechRecognizer(this);
        r.triggerModelDownload(intent(lang));
        main.postDelayed(r::destroy, 3000);
    }

    // ---------- Speech out ----------
    void speak(String text, String lang) {
        if (!ttsReady) return;
        tts.setLanguage(Locale.forLanguageTag(lang));
        tts.setSpeechRate(0.96f);
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "p" + System.nanoTime());
    }

    // ---------- Page <-> phone ----------
    static JSONObject obj(String... kv) {
        JSONObject o = new JSONObject();
        try { for (int i = 0; i + 1 < kv.length; i += 2) o.put(kv[i], kv[i + 1]); } catch (Exception ignored) {}
        return o;
    }

    void emit(String type, JSONObject data) {
        final String js = "window.__pahunch&&window.__pahunch(" + JSONObject.quote(type) + "," + data + ")";
        main.post(() -> web.evaluateJavascript(js, null));
    }

    class Bridge {
        @JavascriptInterface public String info() {
            JSONObject o = new JSONObject();
            try {
                o.put("app", "1.0").put("sdk", Build.VERSION.SDK_INT).put("model", Build.MODEL)
                 .put("onDevice", Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(MainActivity.this))
                 .put("recognizer", SpeechRecognizer.isRecognitionAvailable(MainActivity.this))
                 .put("tts", ttsReady);
            } catch (Exception ignored) {}
            return o.toString();
        }
        @JavascriptInterface public void listen(String lang) { main.post(() -> MainActivity.this.listen(lang, true)); }
        @JavascriptInterface public void listenWith(String lang, boolean onDevice) { main.post(() -> MainActivity.this.listen(lang, onDevice)); }
        @JavascriptInterface public void stop() { main.post(() -> { if (rec != null) rec.stopListening(); }); }
        @JavascriptInterface public void cancel() { main.post(() -> { if (rec != null) { rec.cancel(); rec.destroy(); rec = null; } }); }
        @JavascriptInterface public void speak(String text, String lang) { main.post(() -> MainActivity.this.speak(text, lang)); }
        @JavascriptInterface public void stopSpeaking() { main.post(() -> { if (tts != null) tts.stop(); }); }
        @JavascriptInterface public String location() { return last == null ? "" : loc(last).toString(); }
        @JavascriptInterface public void languages(String lang) { main.post(() -> MainActivity.this.languages(lang)); }
        @JavascriptInterface public void download(String lang) { main.post(() -> MainActivity.this.download(lang)); }
        @JavascriptInterface public void startEngine() { main.post(MainActivity.this::startEngine); }
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (rec != null) rec.destroy();
        if (tts != null) tts.shutdown();
        try { lm.removeUpdates(gps); } catch (Exception ignored) {}
        web.destroy();
        super.onDestroy();
    }
}
