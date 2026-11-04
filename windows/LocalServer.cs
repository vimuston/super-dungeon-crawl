using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace SuperDungeonCrawl;

/// <summary>
/// The webtiles server, cut down to one local player (the desktop twin of
/// android/.../LocalServer.java): serves the bundled client over
/// http://127.0.0.1:port/ and runs crawl, through crawlhost.exe, for the
/// page's WebSocket. No accounts, lobby, spectators or chat.
///
/// Access control: any web page in a browser can reach 127.0.0.1 too. Every
/// launch makes a random token; the page URL carries it (?k=...), index.html
/// is only served with it, and the WebSocket needs it plus a loopback Host and
/// Origin (no DNS rebinding, no cross-site pages). Message sizes are capped.
/// </summary>
sealed class LocalServer
{
    const int MaxMessage = 8 * 1024 * 1024;   // one WebSocket message
    public readonly string Token = Convert.ToHexString(RandomNumberGenerator.GetBytes(24)).ToLowerInvariant();

    readonly string webDir;      // index.html, game.html, static/, gamedata/
    readonly string hostExe;     // crawlhost.exe (Cygwin)
    readonly string crawlExe;    // crawl.exe (Cygwin)
    readonly string workDir;     // crawl's dir: dat/, saves/, rcs/
    readonly object gate = new();
    readonly SemaphoreSlim sendLock = new(1, 1);

    TcpListener listener;
    Process process;
    StreamWriter processIn;
    WebSocket ws;
    string exitReason;
    Task prepared = Task.CompletedTask;   // game data cache build

    public bool Debug;
    public int Port => ((IPEndPoint)listener.LocalEndpoint).Port;
    public bool GameRunning { get { lock (gate) return process != null; } }
    public bool PageConnected { get { lock (gate) return ws != null; } }
    public event Action<string> GameEnded;

    public LocalServer(string webDir, string hostExe, string crawlExe, string workDir)
    {
        this.webDir = webDir;
        this.hostExe = hostExe;
        this.crawlExe = crawlExe;
        this.workDir = workDir;
    }

    /// <summary>Wanted port if free, else any free one.</summary>
    public int Start(int wanted)
    {
        try
        {
            listener = new TcpListener(IPAddress.Loopback, wanted);
            listener.Start();
        }
        catch (SocketException) when (wanted != 0)
        {
            listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
        }
        _ = Task.Run(AcceptLoop);
        ConsoleHider.Start(Path.GetDirectoryName(hostExe));
        return Port;
    }

    /// <summary>Crawl compiles dat/des and the text databases into saves/ on
    /// first start; do it up front so "play" doesn't take a minute.</summary>
    public void PrepareData()
    {
        string marker = Path.Combine(workDir, "saves", ".prepared");
        if (File.Exists(marker))
            return;
        prepared = Task.Run(() =>
        {
            try
            {
                var psi = HostStart(crawlExe, "-dir", CygPath(workDir) + "/", "-builddb");
                using var p = Process.Start(psi);
                p.StandardOutput.ReadToEnd();
                p.WaitForExit();
                if (p.ExitCode == 0)
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(marker));
                    File.WriteAllText(marker, "");
                }
            }
            catch (Exception e) { Log("builddb: " + e.Message); }
        });
    }

    /// <summary>Hang crawl up: it saves and exits.</summary>
    public void SaveAndStop()
    {
        lock (gate)
        {
            try { processIn?.Close(); } catch (IOException) { }
            processIn = null;
        }
    }

    public bool WaitForGameEnd(int ms)
    {
        Process p;
        lock (gate) p = process;
        return p == null || p.WaitForExit(ms);
    }

    public void Shutdown()
    {
        SaveAndStop();
        WaitForGameEnd(10000);
        try { listener.Stop(); } catch { }
    }

    void Log(string s)
    {
        if (Debug) Console.WriteLine(s);
    }

    // ---- HTTP ----

    async Task AcceptLoop()
    {
        for (;;)
        {
            TcpClient c;
            try { c = await listener.AcceptTcpClientAsync(); }
            catch { return; }
            _ = Task.Run(() => Serve(c));
        }
    }

    static readonly Dictionary<string, string> Types = new()
    {
        ["html"] = "text/html; charset=utf-8",
        ["js"] = "application/javascript; charset=utf-8",
        ["css"] = "text/css; charset=utf-8",
        ["json"] = "application/json",
        ["png"] = "image/png",
        ["gif"] = "image/gif",
        ["jpg"] = "image/jpeg",
        ["svg"] = "image/svg+xml",
        ["ico"] = "image/x-icon",
        ["ttf"] = "font/ttf",
        ["woff"] = "font/woff",
        ["woff2"] = "font/woff2",
        ["txt"] = "text/plain; charset=utf-8",
    };

    async Task Serve(TcpClient c)
    {
        using (c)
        {
            try
            {
                c.NoDelay = true;
                var stream = c.GetStream();
                for (;;)
                {
                    string request = await ReadLine(stream);
                    if (string.IsNullOrEmpty(request))
                        break;
                    var headers = new Dictionary<string, string>();
                    string h;
                    while (!string.IsNullOrEmpty(h = await ReadLine(stream)))
                    {
                        int i = h.IndexOf(':');
                        if (i > 0)
                            headers[h[..i].Trim().ToLowerInvariant()] = h[(i + 1)..].Trim();
                    }
                    string[] parts = request.Split(' ');
                    if (parts.Length < 2)
                        break;
                    string path = parts[1], query = null;
                    int q = path.IndexOf('?');
                    if (q >= 0)
                    {
                        query = path[(q + 1)..];
                        path = path[..q];
                    }
                    if (!HostOk(headers.GetValueOrDefault("host")))
                    {
                        await Forbidden(stream);
                        break;
                    }
                    if (headers.TryGetValue("upgrade", out var up)
                        && up.Equals("websocket", StringComparison.OrdinalIgnoreCase))
                    {
                        if (path != "/socket" || !TokenOk(query)
                            || !OriginOk(headers.GetValueOrDefault("origin")))
                        {
                            await Forbidden(stream);
                            break;
                        }
                        await Socket(stream, headers);
                        return;
                    }
                    if (AssetPath(path) == "index.html" && !TokenOk(query))
                    {
                        await Forbidden(stream);
                        break;
                    }
                    await File_(stream, path);
                    if (headers.GetValueOrDefault("connection", "")
                        .Equals("close", StringComparison.OrdinalIgnoreCase))
                        break;
                }
            }
            catch (Exception e) when (e is IOException or SocketException or ObjectDisposedException) { }
        }
    }

    bool TokenOk(string query)
    {
        if (query == null)
            return false;
        var want = Encoding.ASCII.GetBytes(Token);
        foreach (var kv in query.Split('&'))
            if (kv.StartsWith("k=")
                && CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(kv[2..]), want))
                return true;
        return false;
    }

    // Host must name this server by its loopback address (DNS rebinding)
    bool HostOk(string host) => host == "127.0.0.1:" + Port || host == "localhost:" + Port;

    // browsers send Origin on WebSocket upgrades: only our own page
    bool OriginOk(string origin) =>
        origin == "http://127.0.0.1:" + Port || origin == "http://localhost:" + Port;

    static async Task Forbidden(Stream s) =>
        await s.WriteAsync(Encoding.ASCII.GetBytes(
            "HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\n"
            + "Content-Length: 9\r\nConnection: close\r\n\r\nforbidden"));

    string AssetPath(string path)
    {
        if (path == "/" || path == "/index.html")
            return "index.html";
        if (path.StartsWith("/static/"))
            return "static/" + path[8..];
        if (path.StartsWith("/gamedata/"))
        {
            // /gamedata/<version>/<file>: only the bundled version exists
            int slash = path.IndexOf('/', 10);
            if (slash > 0)
                return "gamedata/" + path[(slash + 1)..];
        }
        return null;
    }

    async Task File_(Stream s, string path)
    {
        string asset = AssetPath(path);
        byte[] body = null;
        if (asset != null && !asset.Contains("..") && !asset.Contains('\\')
            && !asset.Contains("//") && !asset.Contains('%') && !asset.Contains('\0'))
        {
            string file = Path.Combine(webDir, asset.Replace('/', Path.DirectorySeparatorChar));
            if (File.Exists(file))
                body = await File.ReadAllBytesAsync(file);
        }
        if (body == null)
        {
            byte[] msg = Encoding.UTF8.GetBytes("not found");
            await s.WriteAsync(Encoding.ASCII.GetBytes(
                "HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\n"
                + "Content-Length: " + msg.Length + "\r\n\r\n"));
            await s.WriteAsync(msg);
            return;
        }
        if (asset == "index.html")
        {
            string html = Encoding.UTF8.GetString(body).Replace("@SOCKET_SERVER@",
                "ws://127.0.0.1:" + Port + "/socket?k=" + Token);
            body = Encoding.UTF8.GetBytes(html);
        }
        string ext = asset[(asset.LastIndexOf('.') + 1)..].ToLowerInvariant();
        string type = Types.GetValueOrDefault(ext, "application/octet-stream");
        await s.WriteAsync(Encoding.ASCII.GetBytes(
            "HTTP/1.1 200 OK\r\nContent-Type: " + type + "\r\n"
            + "Content-Length: " + body.Length + "\r\n"
            + "Cache-Control: no-store\r\n\r\n"));
        await s.WriteAsync(body);
    }

    static async Task<string> ReadLine(Stream s)
    {
        var b = new StringBuilder();
        var one = new byte[1];
        while (await s.ReadAsync(one) == 1)
        {
            if (one[0] == '\n')
            {
                if (b.Length > 0 && b[^1] == '\r')
                    b.Length--;
                return b.ToString();
            }
            b.Append((char)one[0]);
            if (b.Length > 16384)
                throw new IOException("header too long");
        }
        return b.Length > 0 ? b.ToString() : null;
    }

    // ---- WebSocket ----

    async Task Socket(Stream stream, Dictionary<string, string> headers)
    {
        string key = headers.GetValueOrDefault("sec-websocket-key");
        if (key == null)
            return;
        string accept = Convert.ToBase64String(SHA1.HashData(Encoding.ASCII.GetBytes(
            key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")));
        string proto = headers.GetValueOrDefault("sec-websocket-protocol")?.Split(',')[0].Trim();
        await stream.WriteAsync(Encoding.ASCII.GetBytes(
            "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
            + "Sec-WebSocket-Accept: " + accept + "\r\n"
            + (proto != null ? "Sec-WebSocket-Protocol: " + proto + "\r\n" : "")
            + "\r\n"));
        var socket = WebSocket.CreateFromStream(stream, true, proto, TimeSpan.FromSeconds(30));

        WebSocket old;
        lock (gate) { old = ws; ws = socket; }
        old?.Abort(); // a reload replaces the page

        var buf = new byte[64 * 1024];
        var message = new MemoryStream();
        try
        {
            for (;;)
            {
                var r = await socket.ReceiveAsync(buf, CancellationToken.None);
                if (r.MessageType == WebSocketMessageType.Close)
                    break;
                message.Write(buf, 0, r.Count);
                if (message.Length > MaxMessage)
                    break; // oversized: drop the connection
                if (r.EndOfMessage)
                {
                    ClientMessage(Encoding.UTF8.GetString(message.ToArray()));
                    message.SetLength(0);
                }
            }
        }
        catch (Exception e) when (e is WebSocketException or IOException or ObjectDisposedException) { }
        finally
        {
            lock (gate) { if (ws == socket) ws = null; }
            socket.Abort();
        }
    }

    void Send(string msg)
    {
        WebSocket s;
        lock (gate) s = ws;
        if (s == null || s.State != WebSocketState.Open)
            return;
        sendLock.Wait();
        try
        {
            s.SendAsync(Encoding.UTF8.GetBytes(msg), WebSocketMessageType.Text, true,
                        CancellationToken.None).GetAwaiter().GetResult();
        }
        catch (Exception) { s.Abort(); }
        finally { sendLock.Release(); }
    }

    void SendMsg(string type, params (string, string)[] kv)
    {
        var b = new StringBuilder("{\"msg\":").Append(JsonSerializer.Serialize(type));
        foreach (var (k, v) in kv)
            b.Append(',').Append(JsonSerializer.Serialize(k)).Append(':').Append(v);
        Send(b.Append('}').ToString());
    }

    static string Q(string s) => JsonSerializer.Serialize(s);

    // ---- page <-> crawl ----

    void ClientMessage(string text)
    {
        Log("page> " + (text.Length > 120 ? text[..120] : text));
        string type;
        JsonElement root;
        try
        {
            using var doc = JsonDocument.Parse(text);
            root = doc.RootElement.Clone();
            if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("msg", out var t))
                return;
            type = t.GetString();
        }
        catch (JsonException) { return; }

        switch (type)
        {
            case "play":
                Play();
                break;
            case "input":
            {
                // like process_handler: "input" goes to crawl's terminal
                var data = new StringBuilder();
                if (root.TryGetProperty("data", out var codes) && codes.ValueKind == JsonValueKind.Array)
                    foreach (var c in codes.EnumerateArray())
                        if (c.ValueKind == JsonValueKind.Number && c.TryGetInt32(out int cp)
                            && cp >= 0 && cp <= 0x10FFFF && (cp < 0xD800 || cp > 0xDFFF))
                            data.Append(char.ConvertFromUtf32(cp));
                if (root.TryGetProperty("text", out var t) && t.ValueKind == JsonValueKind.String)
                    data.Append(t.GetString());
                ToHost("I" + Convert.ToHexString(Encoding.UTF8.GetBytes(data.ToString())).ToLowerInvariant());
                break;
            }
            case "pong": case "go_lobby": case "login": case "token_login":
            case "set_login_cookie": case "forget_login_cookie": case "chat_msg": case "watch":
                break; // server/lobby messages with nothing to do here
            default:
                ToHost("S" + text);
                break;
        }
    }

    void ToHost(string line)
    {
        lock (gate)
        {
            if (processIn == null)
                return;
            try
            {
                processIn.Write(line);
                processIn.Write('\n');
                processIn.Flush();
            }
            catch (IOException) { }
        }
    }

    ProcessStartInfo HostStart(string exe, params string[] args)
    {
        var psi = new ProcessStartInfo(hostExe)
        {
            WorkingDirectory = workDir,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardInputEncoding = new UTF8Encoding(false),
            StandardOutputEncoding = new UTF8Encoding(false),
        };
        // crawlhost <workdir> <crawl> [crawl args...]
        psi.ArgumentList.Add(CygPath(workDir));
        psi.ArgumentList.Add(CygPath(exe));
        foreach (var a in args)
            psi.ArgumentList.Add(a);
        // Cygwin runtime finds its root from cygwin1.dll; terminfo lives under it
        psi.Environment["PATH"] = Path.GetDirectoryName(hostExe) + ";" + psi.Environment["PATH"];
        psi.Environment["CYGWIN"] = "nodosfilewarning";
        return psi;
    }

    /// <summary>C:\a\b -> /cygdrive/c/a/b (what the Cygwin binaries expect).</summary>
    public static string CygPath(string p)
    {
        p = Path.GetFullPath(p).Replace('\\', '/');
        if (p.Length >= 2 && p[1] == ':')
            return "/cygdrive/" + char.ToLowerInvariant(p[0]) + p[2..];
        return p;
    }

    void Play()
    {
        lock (gate)
        {
            if (process != null)
            {
                // page reloaded mid-game: resend the client, then have crawl
                // resend everything as it does for a new spectator
                SendMsg("game_started");
                SendClient();
                ToHost("S{\"msg\":\"spectator_joined\"}");
                return;
            }
            exitReason = null;
            // The client first: the page queues game messages only once it has it.
            SendMsg("game_started");
            SendClient();
            Directory.CreateDirectory(Path.Combine(workDir, "rcs", "player.macro"));
            Directory.CreateDirectory(Path.Combine(workDir, "morgue"));
            string rc = Path.Combine(workDir, "rcs", "player.rc");
            var args = new List<string> { "-dir", CygPath(workDir) + "/", "-name", "player" };
            if (File.Exists(rc))
            {
                args.Add("-rc");
                args.Add(CygPath(rc));
            }
            args.AddRange(new[] { "-macro", CygPath(Path.Combine(workDir, "rcs", "player.macro")),
                                  "-morgue", CygPath(Path.Combine(workDir, "morgue")) });
            try
            {
                prepared.Wait();
                process = Process.Start(HostStart(crawlExe, args.ToArray()));
            }
            catch (Exception e)
            {
                SendMsg("game_ended", ("reason", Q("error")),
                        ("message", Q("Couldn't start crawl: " + e.Message)));
                return;
            }
            processIn = process.StandardInput;
            var p = process;
            new Thread(() => Pump(p)) { IsBackground = true, Name = "crawl" }.Start();
            _ = Task.Run(() => p.StandardError.ReadToEnd());
        }
    }

    void SendClient()
    {
        try
        {
            string html = File.ReadAllText(Path.Combine(webDir, "game.html"), Encoding.UTF8);
            SendMsg("game_client", ("version", Q("local")), ("content", Q(html)));
        }
        catch (IOException)
        {
            SendMsg("game_ended", ("reason", Q("error")), ("message", Q("game.html missing")));
        }
    }

    void Pump(Process p)
    {
        try
        {
            string line;
            while ((line = p.StandardOutput.ReadLine()) != null)
            {
                Log("crawl> " + (line.Length > 120 ? line[..120] : line));
                if (line.StartsWith("X "))
                    break;
                if (line.StartsWith("*"))
                    Special(line[1..]);
                else if (line.Trim().Length > 0)
                    Send(line);
            }
        }
        catch (IOException) { }
        p.WaitForExit();
        string reason;
        lock (gate)
        {
            if (process == p) { process = null; processIn = null; }
            reason = exitReason ?? "unknown";
        }
        SendMsg("game_ended", ("reason", Q(reason)));
        GameEnded?.Invoke(reason);
    }

    void Special(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var r = doc.RootElement;
            if (r.TryGetProperty("msg", out var m) && m.GetString() == "exit_reason"
                && r.TryGetProperty("type", out var t))
                lock (gate) exitReason = t.ToString();
        }
        catch (JsonException) { }
        // client_path (sent at start instead), flush_messages, dump,
        // milestone: nothing to do with one player
    }
}
