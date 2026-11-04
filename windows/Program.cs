using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.Win32;

namespace SuperDungeonCrawl;

/// <summary>
/// Super Dungeon Crawl for Windows: starts the bundled server, opens the game
/// in a WebView2 window (Edge/Chrome app window if WebView2 is missing) and,
/// when that window closes, saves the game and exits.
///
///   super-dungeon-crawl.exe [--port N] [--dir PATH] [--no-browser] [--browser PATH] [--debug]
///
/// The exe carries the game (see Payload) and unpacks it to --dir, default
/// %LOCALAPPDATA%\SuperDungeonCrawl\game: bin\ (crawl.exe, crawlhost.exe,
/// Cygwin DLLs), crawl\ (game data, saves\, rcs\, morgue\), web\ (the client).
/// Without a payload it uses those folders next to the exe.
/// </summary>
static class Program
{
    const int DefaultPort = 47268; // fixed so the browser keeps its settings (localStorage)

    [STAThread]
    static int Main(string[] args)
    {
        int port = DefaultPort;
        bool openBrowser = true, debug = false;
        string browser = null, dataDir = Payload.DefaultDir;
        for (int i = 0; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--port": port = int.Parse(args[++i]); break;
                case "--dir": dataDir = Path.GetFullPath(args[++i]); break;
                case "--no-browser": openBrowser = false; break;
                case "--browser": browser = args[++i]; break;
                case "--debug": debug = true; break;
            }
        }

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);

        // one copy at a time: a second start just opens another window
        using var single = new Mutex(true, "Local\\SuperDungeonCrawl-" + port, out bool first);
        if (!first)
        {
            // bring the running window forward
            IntPtr hwnd = FindWindowW(null, GameWindow.Title);
            if (hwnd != IntPtr.Zero)
            {
                ShowWindow(hwnd, 9); // SW_RESTORE
                SetForegroundWindow(hwnd);
            }
            return 0;
        }

        string baseDir;
        try { baseDir = Payload.Prepare(dataDir); }
        catch (Exception e)
        {
            Fail("Couldn't unpack the game files to " + dataDir + ": " + e.Message);
            return 1;
        }
        string bin = Path.Combine(baseDir, "bin");
        string crawl = Path.Combine(bin, "crawl.exe");
        string host = Path.Combine(bin, "crawlhost.exe");
        if (!File.Exists(crawl) || !File.Exists(host))
        {
            Fail("The game files are missing (bin\\crawl.exe).");
            return 1;
        }

        var server = new LocalServer(Path.Combine(baseDir, "web"), host, crawl,
                                     Path.Combine(baseDir, "crawl")) { Debug = debug };
        try
        {
            port = server.Start(port);
        }
        catch (Exception e)
        {
            Fail("Couldn't start the local server: " + e.Message);
            return 1;
        }
        server.PrepareData();

        string url = "http://127.0.0.1:" + port + "/?k=" + server.Token + "#play-local";
        if (debug || !openBrowser)
            Console.WriteLine(url); // the token in it is the only way in

        if (openBrowser && browser == null)
        {
            // the normal way: our own window around WebView2
            var win = new GameWindow(server, url);
            Application.Run(win);
            if (win.Failure == null)
                return 0;
            // no WebView2 runtime: fall back to an Edge/Chrome app window
            if (debug)
                Console.WriteLine("WebView2: " + win.Failure.Message);
        }

        Process window = null;
        if (openBrowser)
            window = OpenWindow(browser, url, baseDir);

        // Quit when the window closes (fallback and --no-browser). If we couldn't watch the browser
        // process (it handed over to a running instance, or it's the default
        // browser), quit once the page has been gone a while with no game.
        var gone = Stopwatch.StartNew();
        bool everConnected = false;
        for (;;)
        {
            Thread.Sleep(500);
            if (window != null && window.HasExited && !server.PageConnected)
                break;
            if (server.PageConnected)
            {
                everConnected = true;
                gone.Restart();
            }
            else if (everConnected && gone.Elapsed.TotalSeconds > 20)
                break;
        }
        server.Shutdown();
        return 0;
    }

    static void Fail(string msg)
    {
        Console.Error.WriteLine(msg);
        MessageBox.Show(msg, GameWindow.Title, MessageBoxButtons.OK, MessageBoxIcon.Error);
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr FindWindowW(string cls, string title);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd, int cmd);

    /// <summary>Edge or Chrome in --app mode with a private profile (so closing
    /// the window ends that process); otherwise the default browser.</summary>
    static Process OpenWindow(string explicitBrowser, string url, string baseDir)
    {
        string exe = explicitBrowser ?? FindBrowser();
        if (exe != null)
        {
            string profile = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "SuperDungeonCrawl", "browser");
            var psi = new ProcessStartInfo(exe) { UseShellExecute = false };
            psi.ArgumentList.Add("--app=" + url);
            psi.ArgumentList.Add("--user-data-dir=" + profile);
            psi.ArgumentList.Add("--no-first-run");
            psi.ArgumentList.Add("--no-default-browser-check");
            psi.ArgumentList.Add("--window-size=1280,860");
            try { return Process.Start(psi); } catch (Exception) { }
        }
        Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        return null;
    }

    static string FindBrowser()
    {
        string[] keys =
        {
            @"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe",
            @"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe",
        };
        foreach (var key in keys)
            foreach (var hive in new[] { Registry.LocalMachine, Registry.CurrentUser })
            {
                try
                {
                    using var k = hive.OpenSubKey(key);
                    if (k?.GetValue(null) is string p && File.Exists(p))
                        return p;
                }
                catch (Exception) { }
            }
        string pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        string edge = Path.Combine(pf86, "Microsoft", "Edge", "Application", "msedge.exe");
        return File.Exists(edge) ? edge : null;
    }
}
