package com.tealios.errata;

import android.os.Bundle;
import android.util.Log;
import android.webkit.WebView;

import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;

public class MainActivity extends BridgeActivity {
    /** The on-device Errata server the loader hands off to (mobile/node/boot.cjs DEFAULT_PORT). */
    private static final String APP_ORIGIN = "http://127.0.0.1:7739";

    private NativeTts nativeTts;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        installWebSpeech(bridge.getWebView());
    }

    /**
     * Read-aloud: the System WebView has no Web Speech API, so expose Android TTS and
     * inject a speechSynthesis shim into the app page (mobile/shell/webspeech-shim.js).
     */
    private void installWebSpeech(WebView webView) {
        final String shim;
        try {
            shim = readAsset("public/webspeech-shim.js");
        } catch (IOException e) {
            Log.w("Errata", "webspeech shim missing; read aloud unavailable", e);
            return;
        }
        nativeTts = new NativeTts(this, webView);
        webView.addJavascriptInterface(nativeTts, "ErrataNativeTts");

        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(webView, shim, Collections.singleton(APP_ORIGIN));
        } else {
            // Older WebViews: install after load. The shim is idempotent.
            bridge.addWebViewListener(new WebViewListener() {
                @Override
                public void onPageLoaded(WebView view) {
                    String url = view.getUrl();
                    if (url != null && url.startsWith(APP_ORIGIN)) view.evaluateJavascript(shim, null);
                }
            });
        }
    }

    private String readAsset(String path) throws IOException {
        try (InputStream in = getAssets().open(path); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
            return out.toString(StandardCharsets.UTF_8.name());
        }
    }

    @Override
    public void onDestroy() {
        if (nativeTts != null) nativeTts.shutdown();
        super.onDestroy();
    }
}
