package com.superdungeoncrawl.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Fullscreen WebView around the Super Dungeon Crawl webtiles client. The page detects
 * the wrapper (window.SdcNative / "SuperDC" in the user agent) and switches
 * to its mobile UI; the back button is passed to it as window.sdcBack().
 *
 * Local only: crawl runs on the phone (LocalServer + the bundled client and
 * game data) and the page is served from loopback. The app never connects
 * to a remote server.
 */
public class MainActivity extends Activity {
    private static final String SAVE = "saves/player.cs";
    /** Save and stop crawl after this long in the background. */
    private static final long BACKGROUND_SAVE_MS = 60_000;
    private static final int REQ_EXPORT = 1, REQ_IMPORT = 2;
    /**
     * mtime of the bundled game data. crawl's compiled level/database
     * caches (shipped in assets/crawl/cache) are only valid for source files
     * with exactly this mtime; see crossbuild-android.sh build_cache.
     */
    private static final long DATA_MTIME = 1700000000L * 1000;

    private WebView web;
    private boolean errorShown = false;
    private final Handler ui = new Handler(Looper.getMainLooper());

    private LocalServer local;
    private boolean stopping;       // crawl stopped on purpose; don't restart
    private Runnable afterStop;     // runs once crawl has exited
    private final Runnable backgroundSave = this::saveInBackground;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        web = new WebView(this);
        web.setBackgroundColor(0xff000000);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(false);
        s.setUserAgentString(s.getUserAgentString() + " SuperDC/1");

        // no text-selection handles on long-press (the page uses long-press)
        web.setLongClickable(false);
        web.setOnLongClickListener(v -> true);
        web.setHapticFeedbackEnabled(false);

        // chrome://inspect on the PC (USB debugging) can attach to the page,
        // but only in debuggable builds (gradle -PsdcDebug)
        WebView.setWebContentsDebuggingEnabled(
            (getApplicationInfo().flags
             & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0);

        web.addJavascriptInterface(new Bridge(), "SdcNative");
        // page errors pop up as toasts (no devtools on the phone)
        web.setWebChromeClient(new WebChromeClient() {
            private int shown = 0;

            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                if (m.messageLevel() == ConsoleMessage.MessageLevel.ERROR
                    && shown < 5) {
                    shown++;
                    String src = m.sourceId();
                    src = src.substring(src.lastIndexOf('/') + 1);
                    Toast.makeText(MainActivity.this,
                                   m.message() + "\n" + src + ":" + m.lineNumber(),
                                   Toast.LENGTH_LONG).show();
                }
                return false;
            }

            // the client asks "Really save and quit?" when the page goes
            // away mid-game; the app only does that on purpose
            @Override
            public boolean onJsBeforeUnload(WebView view, String url,
                                            String message,
                                            android.webkit.JsResult result) {
                result.confirm();
                return true;
            }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view,
                                                    WebResourceRequest req) {
                // the JS bridge must only be reachable from the app's own
                // loopback server: block every other destination
                return !isLoopback(req.getUrl());
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req,
                                        WebResourceError error) {
                if (req.isForMainFrame())
                    showError(String.valueOf(error.getDescription()));
            }
        });

        startLocal();
        hideBars();
    }

    @SuppressWarnings("deprecation")
    private void hideBars() {
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.statusBars()
                       | WindowInsets.Type.navigationBars());
                c.setSystemBarsBehavior(
                    WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus)
            hideBars();
    }

    // Back = Esc / close the page's overlays. Outside the game (lobby) the
    // page has no handler and the app goes to the background instead.
    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        web.evaluateJavascript(
            "window.sdcBack && document.body.classList.contains('sdc-mobile')"
            + " && document.getElementById('normal')"
            + " ? (window.sdcBack(), '1') : '0'",
            v -> {
                if (!"\"1\"".equals(v))
                    moveTaskToBack(true);
            });
    }

    /** Only the app's own server on 127.0.0.1 may be loaded. */
    private static boolean isLoopback(Uri url) {
        String host = url.getHost();
        return host != null
               && (host.equals("127.0.0.1") || host.equals("localhost"));
    }

    private void showError(String what) {
        if (errorShown)
            return;
        errorShown = true;
        new AlertDialog.Builder(this)
            .setTitle("Couldn't start the game")
            .setMessage(what)
            .setCancelable(false)
            .setPositiveButton("Retry", (d, w) -> {
                errorShown = false;
                web.reload();
            })
            .setNegativeButton("Quit", (d, w) -> finish())
            .show();
    }

    // ---- crawl on the phone ----

    private File crawlDir() {
        return new File(getFilesDir(), "crawl");
    }

    private void startLocal() {
        if (local != null) {
            playLocal();
            return;
        }
        web.loadData("<body style='background:#000;color:#3f3;font:16px monospace;"
                     + "padding:40px'>Preparing the dungeon...</body>",
                     "text/html", "utf-8");
        new Thread(() -> {
            try {
                unpack();
                File libs = new File(getApplicationInfo().nativeLibraryDir);
                LocalServer srv = new LocalServer(
                    path -> getAssets().open(path),
                    new File(libs, "libcrawlhost.so"), new File(libs, "libcrawl.so"),
                    crawlDir(), reason -> ui.post(() -> crawlEnded(reason)));
                srv.start();
                ui.post(() -> {
                    local = srv;
                    playLocal();
                });
            } catch (IOException e) {
                ui.post(() -> showError("Couldn't unpack the game: " + e.getMessage()));
            }
        }).start();
    }

    private void playLocal() {
        stopping = false;
        // the query makes it a new page load even if only the hash matched
        web.loadUrl("http://127.0.0.1:" + local.port() + "/?k=" + local.token()
                    + "&t=" + System.currentTimeMillis() + "#play-local");
    }

    /** Stop crawl (it saves), then run next. */
    private void stopLocal(Runnable next) {
        if (local == null || !local.running()) {
            next.run();
            return;
        }
        stopping = true;
        afterStop = next;
        local.saveAndStop();
    }

    private void crawlEnded(String reason) {
        Runnable next = afterStop;
        afterStop = null;
        if (next != null) {
            next.run();
        } else if (!stopping) {
            // saved & quit, died, or crashed: back to crawl's start menu
            ui.postDelayed(this::playLocal, 1500);
        }
    }

    private void saveInBackground() {
        if (local != null && local.running()) {
            stopping = true;
            local.saveAndStop();
        }
    }

    /**
     * Copy the bundled game data (dat/, docs/, settings/) to the files dir
     * when the APK's copy is newer. Saves, morgues and rcs/ stay; the
     * bundled player.rc is only a starting point.
     */
    private void unpack() throws IOException {
        File dir = crawlDir();
        String bundled = new String(
            LocalServer.readAll(getAssets().open("crawl/VERSION")),
            StandardCharsets.UTF_8);
        File stamp = new File(dir, ".version");
        if (stamp.exists()) {
            try (InputStream in = new FileInputStream(stamp)) {
                if (bundled.equals(new String(LocalServer.readAll(in),
                                              StandardCharsets.UTF_8)))
                    return;
            }
        }
        for (String sub : new String[] {"dat", "docs", "settings"}) {
            deleteTree(new File(dir, sub));
            copyAssets("crawl/" + sub, new File(dir, sub));
        }
        // precompiled caches, so the first start doesn't take minutes
        for (String sub : new String[] {"des", "db"}) {
            deleteTree(new File(dir, "saves/" + sub));
            copyAssets("crawl/cache/" + sub, new File(dir, "saves/" + sub));
        }
        File rc = new File(dir, "rcs/player.rc");
        if (!rc.exists()) {
            try {
                copyAsset("crawl/rcs/player.rc", rc);
            } catch (IOException ignored) {
                // no bundled options file
            }
        }
        new File(dir, "saves").mkdirs();
        try (OutputStream out = new FileOutputStream(stamp)) {
            out.write(bundled.getBytes(StandardCharsets.UTF_8));
        }
    }

    private void copyAssets(String path, File to) throws IOException {
        String[] list = getAssets().list(path);
        if (list == null || list.length == 0) {
            try {
                copyAsset(path, to);
            } catch (java.io.FileNotFoundException e) {
                to.mkdirs(); // an empty directory
            }
            return;
        }
        to.mkdirs();
        for (String name : list)
            copyAssets(path + "/" + name, new File(to, name));
    }

    private void copyAsset(String path, File to) throws IOException {
        to.getParentFile().mkdirs();
        try (InputStream in = getAssets().open(path);
             OutputStream out = new FileOutputStream(to)) {
            copy(in, out);
        }
        to.setLastModified(DATA_MTIME);
    }

    private static void copy(InputStream in, OutputStream out) throws IOException {
        byte[] buf = new byte[65536];
        int n;
        while ((n = in.read(buf)) >= 0)
            out.write(buf, 0, n);
    }

    private static void deleteTree(File f) {
        File[] kids = f.listFiles();
        if (kids != null)
            for (File k : kids)
                deleteTree(k);
        f.delete();
    }

    // ---- save export / import ----

    private void manageSaves() {
        File save = new File(crawlDir(), SAVE);
        new AlertDialog.Builder(this)
            .setTitle("Saved game")
            .setMessage(save.exists()
                        ? "Export the current save (the game is saved first), "
                          + "or import one (a player.cs from another Super "
                          + "Dungeon Crawl install; it replaces the save on "
                          + "the phone)."
                        : "No save on the phone yet. Import one, e.g. a "
                          + "player.cs from another Super Dungeon Crawl install.")
            .setPositiveButton("Import", (d, w) -> {
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                startActivityForResult(i, REQ_IMPORT);
            })
            .setNeutralButton("Export", (d, w) -> stopLocal(() -> {
                Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("application/octet-stream");
                i.putExtra(Intent.EXTRA_TITLE, "player.cs");
                startActivityForResult(i, REQ_EXPORT);
            }))
            .setNegativeButton("Cancel", null)
            .show();
    }

    @Override
    @SuppressWarnings("deprecation")
    protected void onActivityResult(int req, int result, Intent data) {
        super.onActivityResult(req, result, data);
        Uri uri = result == RESULT_OK && data != null ? data.getData() : null;
        File save = new File(crawlDir(), SAVE);
        if (req == REQ_EXPORT) {
            if (uri != null) {
                try (InputStream in = new FileInputStream(save);
                     OutputStream out = getContentResolver().openOutputStream(uri)) {
                    copy(in, out);
                    toast("Save exported");
                } catch (IOException e) {
                    toast("Export failed: " + e.getMessage());
                }
            }
            playLocal();
        } else if (req == REQ_IMPORT && uri != null) {
            stopLocal(() -> {
                File tmp = new File(save.getPath() + ".import");
                try (InputStream in = getContentResolver().openInputStream(uri);
                     OutputStream out = new FileOutputStream(tmp)) {
                    copy(in, out);
                } catch (IOException e) {
                    toast("Import failed: " + e.getMessage());
                    playLocal();
                    return;
                }
                if (save.exists())
                    save.renameTo(new File(save.getPath() + ".bak"));
                tmp.renameTo(save);
                toast("Save imported");
                playLocal();
            });
        }
    }

    private void toast(String text) {
        Toast.makeText(this, text, Toast.LENGTH_LONG).show();
    }

    // ---- lifecycle ----

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onStart() {
        super.onStart();
        ui.removeCallbacks(backgroundSave);
        // saved while in the background: pick the game up again
        if (local != null && !local.running() && stopping && afterStop == null)
            playLocal();
    }

    @Override
    protected void onStop() {
        super.onStop();
        if (local != null)
            ui.postDelayed(backgroundSave, BACKGROUND_SAVE_MS);
    }

    @Override
    protected void onPause() {
        super.onPause();
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        hideBars();
    }

    @Override
    protected void onDestroy() {
        if (local != null)
            local.shutdown(); // crawl saves on the hangup
        web.destroy();
        super.onDestroy();
    }

    private class Bridge {
        @JavascriptInterface
        public boolean isLocal() {
            return true;
        }

        @JavascriptInterface
        public void manageSaves() {
            runOnUiThread(MainActivity.this::manageSaves);
        }
    }
}
