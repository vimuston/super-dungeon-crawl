package com.superdungeoncrawl.app;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * The webtiles server, cut down to one local player: serves the bundled
 * client over http://127.0.0.1:port/ and runs crawl (through crawlhost) for
 * the page's WebSocket. Mirrors what ws_handler.py / process_handler.py do
 * for a player, minus accounts, lobby, spectators and chat.
 *
 * No Android imports, so it can be run and tested on a desktop JVM.
 */
public class LocalServer {
    public interface Assets {
        InputStream open(String path) throws IOException;
    }

    public interface Listener {
        /** crawl exited; reason as crawl reported it ("quit", "saved", "dead"...) */
        void gameEnded(String reason);
    }

    private final Assets assets;
    private final File host;      // crawlhost executable
    private final File crawl;     // crawl executable
    private final File workdir;   // crawl's dir: dat/, saves/, rcs/
    private final Listener listener;

    private ServerSocket server;
    private Process process;
    private Writer processIn;
    private Socket ws;            // the page's socket (one at a time)
    private String exitReason;
    private final Object lock = new Object();
    /** log message traffic to stdout (desktop testing) */
    public static boolean debug = false;

    public LocalServer(Assets assets, File host, File crawl, File workdir,
                       Listener listener) {
        this.assets = assets;
        this.host = host;
        this.crawl = crawl;
        this.workdir = workdir;
        this.listener = listener;
    }

    public int start() throws IOException {
        return start("127.0.0.1");
    }

    /** bind: "0.0.0.0" for testing from another machine */
    public int start(String bind) throws IOException {
        server = new ServerSocket(0, 50, InetAddress.getByName(bind));
        Thread t = new Thread(() -> {
            while (!server.isClosed()) {
                try {
                    Socket s = server.accept();
                    new Thread(() -> serve(s), "http").start();
                } catch (IOException e) {
                    return;
                }
            }
        }, "accept");
        t.setDaemon(true);
        t.start();
        return server.getLocalPort();
    }

    public int port() {
        return server.getLocalPort();
    }

    public boolean running() {
        synchronized (lock) {
            return process != null;
        }
    }

    /** Hang crawl up: it saves and exits (gameEnded follows). */
    public void saveAndStop() {
        synchronized (lock) {
            if (processIn != null) {
                try {
                    processIn.close();
                } catch (IOException ignored) {
                }
                processIn = null;
            }
        }
    }

    public void shutdown() {
        saveAndStop();
        try {
            server.close();
        } catch (IOException ignored) {
        }
    }

    // ---- HTTP ----

    private void serve(Socket s) {
        try {
            s.setTcpNoDelay(true);
            InputStream in = s.getInputStream();
            OutputStream out = s.getOutputStream();
            for (;;) {
                String request = readLine(in);
                if (request == null || request.isEmpty())
                    break;
                Map<String, String> headers = new HashMap<>();
                String h;
                while ((h = readLine(in)) != null && !h.isEmpty()) {
                    int c = h.indexOf(':');
                    if (c > 0)
                        headers.put(h.substring(0, c).trim().toLowerCase(Locale.ROOT),
                                    h.substring(c + 1).trim());
                }
                String[] parts = request.split(" ");
                if (parts.length < 2)
                    break;
                String path = parts[1];
                int q = path.indexOf('?');
                if (q >= 0)
                    path = path.substring(0, q);
                if ("websocket".equalsIgnoreCase(headers.get("upgrade"))) {
                    websocket(s, in, out, headers);
                    return;
                }
                if (!file(out, path, headers.get("host")))
                    break;
                if ("close".equalsIgnoreCase(headers.get("connection")))
                    break;
            }
        } catch (IOException ignored) {
        }
        try {
            s.close();
        } catch (IOException ignored) {
        }
    }

    private static final Map<String, String> TYPES = new HashMap<>();
    static {
        TYPES.put("html", "text/html; charset=utf-8");
        TYPES.put("js", "application/javascript; charset=utf-8");
        TYPES.put("css", "text/css; charset=utf-8");
        TYPES.put("json", "application/json");
        TYPES.put("png", "image/png");
        TYPES.put("gif", "image/gif");
        TYPES.put("jpg", "image/jpeg");
        TYPES.put("svg", "image/svg+xml");
        TYPES.put("ico", "image/x-icon");
        TYPES.put("ttf", "font/ttf");
        TYPES.put("woff", "font/woff");
        TYPES.put("woff2", "font/woff2");
        TYPES.put("txt", "text/plain; charset=utf-8");
    }

    private String assetPath(String path) {
        if (path.equals("/") || path.equals("/index.html"))
            return "web/index.html";
        if (path.startsWith("/static/"))
            return "web/static/" + path.substring(8);
        if (path.startsWith("/gamedata/")) {
            // /gamedata/<version>/<file>: there's only the bundled version
            int slash = path.indexOf('/', 10);
            if (slash > 0)
                return "web/gamedata/" + path.substring(slash + 1);
        }
        return null;
    }

    /** Returns false if the connection should be closed. */
    private boolean file(OutputStream out, String path, String hostHeader)
        throws IOException {
        String asset = assetPath(path);
        byte[] body = null;
        if (asset != null && !asset.contains("..") && !asset.contains("\\")
            && !asset.contains("//") && !asset.contains("%")
            && !asset.contains("\0")) {
            try (InputStream a = assets.open(asset)) {
                body = readAll(a);
            } catch (IOException e) {
                body = null;
            }
        }
        if (body == null) {
            byte[] msg = "not found".getBytes(StandardCharsets.UTF_8);
            out.write(("HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\n"
                       + "Content-Length: " + msg.length + "\r\n\r\n")
                      .getBytes(StandardCharsets.US_ASCII));
            out.write(msg);
            out.flush();
            return true;
        }
        if (asset.equals("web/index.html")) {
            String html = new String(body, StandardCharsets.UTF_8)
                .replace("@SOCKET_SERVER@", "ws://"
                         + (hostHeader != null ? hostHeader : "127.0.0.1:" + port())
                         + "/socket");
            body = html.getBytes(StandardCharsets.UTF_8);
        }
        String ext = asset.substring(asset.lastIndexOf('.') + 1)
            .toLowerCase(Locale.ROOT);
        String type = TYPES.get(ext);
        out.write(("HTTP/1.1 200 OK\r\n"
                   + "Content-Type: " + (type != null ? type : "application/octet-stream") + "\r\n"
                   + "Content-Length: " + body.length + "\r\n"
                   // bundled files change with app updates; loopback is cheap
                   + "Cache-Control: no-store\r\n\r\n")
                  .getBytes(StandardCharsets.US_ASCII));
        out.write(body);
        out.flush();
        return true;
    }

    // ---- WebSocket (RFC 6455, text frames) ----

    private void websocket(Socket s, InputStream in, OutputStream out,
                           Map<String, String> headers) throws IOException {
        String key = headers.get("sec-websocket-key");
        String accept;
        try {
            MessageDigest sha1 = MessageDigest.getInstance("SHA-1");
            accept = Base64.getEncoder().encodeToString(sha1.digest(
                (key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
                .getBytes(StandardCharsets.US_ASCII)));
        } catch (Exception e) {
            throw new IOException(e);
        }
        String proto = headers.get("sec-websocket-protocol");
        out.write(("HTTP/1.1 101 Switching Protocols\r\n"
                   + "Upgrade: websocket\r\nConnection: Upgrade\r\n"
                   + "Sec-WebSocket-Accept: " + accept + "\r\n"
                   + (proto != null ? "Sec-WebSocket-Protocol: " + proto.split(",")[0].trim() + "\r\n" : "")
                   + "\r\n").getBytes(StandardCharsets.US_ASCII));
        out.flush();

        Socket old;
        synchronized (lock) {
            old = ws;
            ws = s;
        }
        if (old != null)
            old.close(); // a reload replaces the page

        ByteArrayOutputStream message = new ByteArrayOutputStream();
        try {
            for (;;) {
                int b0 = in.read(), b1 = in.read();
                if (b0 < 0 || b1 < 0)
                    break;
                int opcode = b0 & 0x0f;
                long len = b1 & 0x7f;
                if (len == 126)
                    len = (in.read() << 8) | in.read();
                else if (len == 127) {
                    len = 0;
                    for (int i = 0; i < 8; i++)
                        len = (len << 8) | in.read();
                }
                byte[] mask = new byte[4];
                if ((b1 & 0x80) != 0)
                    readFully(in, mask);
                byte[] payload = new byte[(int) len];
                readFully(in, payload);
                if ((b1 & 0x80) != 0)
                    for (int i = 0; i < payload.length; i++)
                        payload[i] ^= mask[i & 3];
                if (opcode == 8)
                    break;
                if (opcode == 9) {
                    frame(s, 0xA, payload);
                    continue;
                }
                if (opcode == 0xA)
                    continue;
                message.write(payload);
                if ((b0 & 0x80) != 0) {
                    clientMessage(message.toString("UTF-8"));
                    message.reset();
                }
            }
        } finally {
            synchronized (lock) {
                if (ws == s)
                    ws = null;
            }
            s.close();
        }
    }

    private void frame(Socket s, int opcode, byte[] payload) throws IOException {
        ByteArrayOutputStream f = new ByteArrayOutputStream(payload.length + 10);
        f.write(0x80 | opcode);
        if (payload.length < 126)
            f.write(payload.length);
        else if (payload.length < 65536) {
            f.write(126);
            f.write(payload.length >> 8);
            f.write(payload.length & 0xff);
        } else {
            f.write(127);
            for (int i = 7; i >= 0; i--)
                f.write(i >= 4 ? 0 : (payload.length >> (8 * i)) & 0xff);
        }
        f.write(payload);
        synchronized (s) {
            OutputStream out = s.getOutputStream();
            f.writeTo(out);
            out.flush();
        }
    }

    private void send(String msg) {
        Socket s;
        synchronized (lock) {
            s = ws;
        }
        if (s == null)
            return;
        try {
            frame(s, 1, msg.getBytes(StandardCharsets.UTF_8));
        } catch (IOException e) {
            try {
                s.close();
            } catch (IOException ignored) {
            }
        }
    }

    private void sendMsg(String type, String... kv) {
        StringBuilder b = new StringBuilder("{\"msg\":").append(Json.quote(type));
        for (int i = 0; i + 1 < kv.length; i += 2)
            b.append(',').append(Json.quote(kv[i])).append(':').append(kv[i + 1]);
        send(b.append('}').toString());
    }

    // ---- page <-> crawl ----

    private void clientMessage(String text) {
        if (debug)
            System.out.println("page> " + text.substring(0, Math.min(120, text.length())));
        Object parsed;
        try {
            parsed = Json.parse(text);
        } catch (RuntimeException e) {
            return;
        }
        if (!(parsed instanceof Map))
            return;
        Map<?, ?> obj = (Map<?, ?>) parsed;
        Object type = obj.get("msg");
        if ("play".equals(type)) {
            play();
        } else if ("input".equals(type)) {
            // like process_handler: "input" goes to crawl's terminal
            StringBuilder data = new StringBuilder();
            Object codes = obj.get("data");
            if (codes instanceof List)
                for (Object c : (List<?>) codes)
                    data.appendCodePoint(((Number) c).intValue());
            Object t = obj.get("text");
            if (t instanceof String)
                data.append((String) t);
            byte[] bytes = data.toString().getBytes(StandardCharsets.UTF_8);
            StringBuilder hex = new StringBuilder("I");
            for (byte b : bytes)
                hex.append(String.format("%02x", b & 0xff));
            toHost(hex.toString());
        } else if ("pong".equals(type) || "go_lobby".equals(type)
                   || "login".equals(type) || "token_login".equals(type)
                   || "set_login_cookie".equals(type)
                   || "forget_login_cookie".equals(type)
                   || "chat_msg".equals(type) || "watch".equals(type)) {
            // server/lobby messages with nothing to do here
        } else {
            toHost("S" + text);
        }
    }

    private void toHost(String line) {
        synchronized (lock) {
            if (processIn == null)
                return;
            try {
                processIn.write(line);
                processIn.write('\n');
                processIn.flush();
            } catch (IOException ignored) {
            }
        }
    }

    private void play() {
        synchronized (lock) {
            if (process != null) {
                // page reloaded mid-game: resend the client, then have
                // crawl resend everything as it does for a new spectator
                sendMsg("game_started");
                sendClient();
                toHost("S{\"msg\":\"spectator_joined\"}");
                return;
            }
            exitReason = null;
            // The client first: the page queues game messages only once it
            // has it. (crawl announces a client_path only when built with
            // WEB_DIR_PATH; the server otherwise sends its configured one.)
            sendMsg("game_started");
            sendClient();
            List<String> cmd = new ArrayList<>();
            cmd.add(host.getAbsolutePath());
            cmd.add(workdir.getAbsolutePath());
            cmd.add(crawl.getAbsolutePath());
            // data + saves live here, not next to the executable
            cmd.add("-dir");
            cmd.add(workdir.getAbsolutePath() + "/");
            cmd.add("-name");
            cmd.add("player");
            File rc = new File(workdir, "rcs/player.rc");
            if (rc.exists()) {
                cmd.add("-rc");
                cmd.add(rc.getAbsolutePath());
            }
            cmd.add("-macro");
            cmd.add(new File(workdir, "rcs/player.macro").getAbsolutePath());
            cmd.add("-morgue");
            cmd.add(new File(workdir, "morgue").getAbsolutePath());
            new File(workdir, "rcs/player.macro").mkdirs();
            new File(workdir, "morgue").mkdirs();
            try {
                process = new ProcessBuilder(cmd).directory(workdir)
                    .redirectErrorStream(false).start();
            } catch (IOException e) {
                sendMsg("game_ended", "reason", Json.quote("error"),
                        "message", Json.quote("Couldn't start crawl: " + e.getMessage()));
                return;
            }
            processIn = new OutputStreamWriter(process.getOutputStream(),
                                               StandardCharsets.UTF_8);
            Process p = process;
            Thread t = new Thread(() -> pump(p), "crawl");
            t.setDaemon(true);
            t.start();
            drain(p.getErrorStream());
        }
    }

    private void sendClient() {
        try (InputStream a = assets.open("web/game.html")) {
            String html = new String(readAll(a), StandardCharsets.UTF_8);
            sendMsg("game_client", "version", Json.quote("local"),
                    "content", Json.quote(html));
        } catch (IOException e) {
            sendMsg("game_ended", "reason", Json.quote("error"),
                    "message", Json.quote("game.html missing"));
        }
    }

    private void pump(Process p) {
        try (BufferedReader r = new BufferedReader(
                 new InputStreamReader(p.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = r.readLine()) != null) {
                if (debug)
                    System.out.println("crawl> " + line.substring(0, Math.min(120, line.length())));
                if (line.startsWith("X ")) {
                    break;
                } else if (line.startsWith("*")) {
                    special(line.substring(1));
                } else if (!line.trim().isEmpty()) {
                    send(line);
                }
            }
        } catch (IOException ignored) {
        }
        try {
            p.waitFor();
        } catch (InterruptedException ignored) {
        }
        String reason;
        synchronized (lock) {
            if (process == p) {
                process = null;
                processIn = null;
            }
            reason = exitReason != null ? exitReason : "unknown";
        }
        sendMsg("game_ended", "reason", Json.quote(reason));
        if (listener != null)
            listener.gameEnded(reason);
    }

    private void special(String json) {
        Object parsed;
        try {
            parsed = Json.parse(json);
        } catch (RuntimeException e) {
            return;
        }
        if (!(parsed instanceof Map))
            return;
        Map<?, ?> obj = (Map<?, ?>) parsed;
        Object type = obj.get("msg");
        if ("exit_reason".equals(type))
            synchronized (lock) {
                exitReason = String.valueOf(obj.get("type"));
            }
        // client_path (sent at start instead), flush_messages, dump,
        // milestone: nothing to do with one player
    }

    private static void drain(InputStream err) {
        Thread t = new Thread(() -> {
            byte[] buf = new byte[4096];
            try {
                while (err.read(buf) >= 0) {
                }
            } catch (IOException ignored) {
            }
        }, "crawl-err");
        t.setDaemon(true);
        t.start();
    }

    // ---- helpers ----

    private static String readLine(InputStream in) throws IOException {
        StringBuilder b = new StringBuilder();
        int c;
        while ((c = in.read()) >= 0) {
            if (c == '\n') {
                int n = b.length();
                if (n > 0 && b.charAt(n - 1) == '\r')
                    b.setLength(n - 1);
                return b.toString();
            }
            b.append((char) c);
        }
        return b.length() > 0 ? b.toString() : null;
    }

    private static void readFully(InputStream in, byte[] buf) throws IOException {
        int off = 0;
        while (off < buf.length) {
            int n = in.read(buf, off, buf.length - off);
            if (n < 0)
                throw new IOException("eof");
            off += n;
        }
    }

    static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        byte[] buf = new byte[65536];
        int n;
        while ((n = in.read(buf)) >= 0)
            b.write(buf, 0, n);
        return b.toByteArray();
    }

    /** Just enough JSON for the page's messages. */
    static final class Json {
        private final String s;
        private int i;

        private Json(String s) {
            this.s = s;
        }

        static Object parse(String s) {
            Json j = new Json(s);
            Object v = j.value();
            return v;
        }

        static String quote(String v) {
            StringBuilder b = new StringBuilder(v.length() + 2).append('"');
            for (int k = 0; k < v.length(); k++) {
                char c = v.charAt(k);
                switch (c) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                default:
                    if (c < 0x20)
                        b.append(String.format("\\u%04x", (int) c));
                    else
                        b.append(c);
                }
            }
            return b.append('"').toString();
        }

        private void ws() {
            while (i < s.length() && Character.isWhitespace(s.charAt(i)))
                i++;
        }

        private Object value() {
            ws();
            char c = s.charAt(i);
            if (c == '{') {
                Map<String, Object> m = new HashMap<>();
                i++;
                ws();
                if (s.charAt(i) == '}') {
                    i++;
                    return m;
                }
                for (;;) {
                    ws();
                    String k = string();
                    ws();
                    i++; // ':'
                    m.put(k, value());
                    ws();
                    if (s.charAt(i++) == '}')
                        return m;
                }
            }
            if (c == '[') {
                List<Object> l = new ArrayList<>();
                i++;
                ws();
                if (s.charAt(i) == ']') {
                    i++;
                    return l;
                }
                for (;;) {
                    l.add(value());
                    ws();
                    if (s.charAt(i++) == ']')
                        return l;
                }
            }
            if (c == '"')
                return string();
            if (s.startsWith("true", i)) {
                i += 4;
                return Boolean.TRUE;
            }
            if (s.startsWith("false", i)) {
                i += 5;
                return Boolean.FALSE;
            }
            if (s.startsWith("null", i)) {
                i += 4;
                return null;
            }
            int start = i;
            while (i < s.length() && "+-0123456789.eE".indexOf(s.charAt(i)) >= 0)
                i++;
            if (start == i)
                throw new IllegalArgumentException("bad json at " + i);
            return Double.parseDouble(s.substring(start, i));
        }

        private String string() {
            StringBuilder b = new StringBuilder();
            i++; // opening quote
            for (;;) {
                char c = s.charAt(i++);
                if (c == '"')
                    return b.toString();
                if (c != '\\') {
                    b.append(c);
                    continue;
                }
                char e = s.charAt(i++);
                switch (e) {
                case 'n': b.append('\n'); break;
                case 't': b.append('\t'); break;
                case 'r': b.append('\r'); break;
                case 'b': b.append('\b'); break;
                case 'f': b.append('\f'); break;
                case 'u':
                    b.append((char) Integer.parseInt(s.substring(i, i + 4), 16));
                    i += 4;
                    break;
                default: b.append(e);
                }
            }
        }
    }
}
