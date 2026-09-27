package com.tealios.errata;

import android.content.Context;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Set;

/**
 * Android TextToSpeech exposed to the WebView as {@code window.ErrataNativeTts}.
 *
 * The Android System WebView has no Web Speech API, so read-aloud had nothing to
 * call. mobile/shell/webspeech-shim.js (injected by MainActivity) builds
 * {@code speechSynthesis} on top of this interface; the web app is unchanged.
 *
 * Events go back to the page as {@code window.__errataSpeech._native(type, id)}.
 */
public class NativeTts implements TextToSpeech.OnInitListener {
    private final WebView webView;
    private final TextToSpeech tts;
    private volatile boolean ready = false;

    public NativeTts(Context context, WebView webView) {
        this.webView = webView;
        this.tts = new TextToSpeech(context.getApplicationContext(), this);
    }

    @Override
    public void onInit(int status) {
        ready = status == TextToSpeech.SUCCESS;
        if (ready) {
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String id) { emit("start", id); }
                @Override public void onDone(String id) { emit("end", id); }
                @Override public void onError(String id) { emit("error", id); }
                @Override public void onError(String id, int errorCode) { emit("error", id); }
            });
        }
        emit("voices", "");
    }

    @JavascriptInterface
    public String getVoices() {
        JSONArray out = new JSONArray();
        if (!ready) return out.toString();
        try {
            Set<Voice> voices = tts.getVoices();
            if (voices == null) return out.toString();
            Voice def = tts.getDefaultVoice();
            List<Voice> sorted = new ArrayList<>(voices);
            Collections.sort(sorted, (a, b) -> a.getName().compareTo(b.getName()));
            for (Voice v : sorted) {
                if (v.getFeatures() != null && v.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)) continue;
                JSONObject o = new JSONObject();
                o.put("name", v.getName());
                o.put("lang", v.getLocale().toLanguageTag());
                o.put("local", !v.isNetworkConnectionRequired());
                o.put("default", def != null && def.getName().equals(v.getName()));
                out.put(o);
            }
        } catch (JSONException | RuntimeException ignored) {
            // An engine that misbehaves here just yields fewer voices.
        }
        return out.toString();
    }

    @JavascriptInterface
    public void speak(String id, String text, String voiceName, float rate, float pitch, float volume) {
        if (!ready) {
            emit("error", id);
            return;
        }
        Voice chosen = null;
        if (voiceName != null && !voiceName.isEmpty()) {
            Set<Voice> voices = tts.getVoices();
            if (voices != null) {
                for (Voice v : voices) {
                    if (v.getName().equals(voiceName)) { chosen = v; break; }
                }
            }
        }
        if (chosen == null) chosen = tts.getDefaultVoice();
        if (chosen != null) tts.setVoice(chosen);
        tts.setSpeechRate(rate);
        tts.setPitch(pitch);
        Bundle params = new Bundle();
        params.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, Math.max(0f, Math.min(1f, volume)));
        int result = tts.speak(text, TextToSpeech.QUEUE_ADD, params, id);
        if (result != TextToSpeech.SUCCESS) emit("error", id);
    }

    @JavascriptInterface
    public void cancel() {
        if (ready) tts.stop();
    }

    public void shutdown() {
        tts.stop();
        tts.shutdown();
    }

    private void emit(String type, String id) {
        final String js = "window.__errataSpeech&&window.__errataSpeech._native("
            + JSONObject.quote(type) + "," + JSONObject.quote(id == null ? "" : id) + ")";
        webView.post(() -> webView.evaluateJavascript(js, null));
    }
}
