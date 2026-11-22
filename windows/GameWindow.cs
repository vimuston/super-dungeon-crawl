using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace SuperDungeonCrawl;

/// <summary>
/// The game window: a WebView2 control (the Edge runtime that ships with
/// Windows 10/11) showing the local server's page. Closing it saves the game.
/// </summary>
sealed class GameWindow : Form
{
    public const string Title = "Super Dungeon Crawl";

    readonly WebView2 view = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.Black };
    readonly LocalServer server;
    readonly string url;
    bool fullscreen;
    FormWindowState restoreState;

    /// <summary>Set when WebView2 couldn't start (no runtime); the caller falls back.</summary>
    public Exception Failure;

    public GameWindow(LocalServer server, string url)
    {
        this.server = server;
        this.url = url;
        Text = Title;
        Icon = Icon.ExtractAssociatedIcon(Environment.ProcessPath);
        BackColor = Color.Black;
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(1280, 800);
        MinimumSize = new Size(640, 400);
        Controls.Add(view);
        Load += async (_, _) => await Init();
    }

    async Task Init()
    {
        try
        {
            string data = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "SuperDungeonCrawl", "webview");
            var env = await CoreWebView2Environment.CreateAsync(null, data);
            await view.EnsureCoreWebView2Async(env);
        }
        catch (Exception e)
        {
            Failure = e;
            Close();
            return;
        }

        var core = view.CoreWebView2;
        var s = core.Settings;
        s.AreBrowserAcceleratorKeysEnabled = false; // F5, Ctrl+keys etc. belong to the game
        s.AreDefaultContextMenusEnabled = false;
        s.AreDevToolsEnabled = Environment.GetEnvironmentVariable("SDC_DEVTOOLS") == "1";
        s.IsZoomControlEnabled = false;
        s.IsStatusBarEnabled = false;
        s.IsPasswordAutosaveEnabled = false;
        s.IsGeneralAutofillEnabled = false;
        // only ever the local server
        core.NewWindowRequested += (_, e) => e.Handled = true;
        core.NavigationStarting += (_, e) =>
        {
            if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var u) || u.Host != "127.0.0.1")
                e.Cancel = true;
        };
        core.DocumentTitleChanged += (_, _) => Text = Title;
        core.Navigate(url);
        view.Focus();
    }

    protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
    {
        if (keyData == Keys.F11)
        {
            ToggleFullscreen();
            return true;
        }
        return base.ProcessCmdKey(ref msg, keyData);
    }

    void ToggleFullscreen()
    {
        if (!fullscreen)
        {
            restoreState = WindowState;
            FormBorderStyle = FormBorderStyle.None;
            WindowState = FormWindowState.Normal; // re-apply, so Maximized covers the taskbar
            WindowState = FormWindowState.Maximized;
        }
        else
        {
            FormBorderStyle = FormBorderStyle.Sizable;
            WindowState = restoreState;
        }
        fullscreen = !fullscreen;
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        base.OnFormClosing(e);
        if (e.Cancel)
            return;
        Hide();                 // looks closed at once; crawl needs a moment to save
        server.Shutdown();
        view.Dispose();
    }
}
