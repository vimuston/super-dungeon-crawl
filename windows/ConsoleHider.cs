using System.Runtime.InteropServices;
using System.Text;

namespace SuperDungeonCrawl;

/// <summary>
/// Cygwin's pty layer gives crawl.exe a console of its own, and Windows shows it
/// (a plain console window, or a Windows Terminal window where that is the
/// default terminal). CreateNoWindow only covers the process we start, not
/// the ones it starts, so this hides any window titled with the path of one of
/// our bin\ executables as soon as it appears.
/// </summary>
static class ConsoleHider
{
    delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);

    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc proc, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd, int cmd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int GetWindowTextW(IntPtr hwnd, StringBuilder text, int max);

    /// <summary>Watch for the life of the process.</summary>
    public static void Start(string binDir)
    {
        string prefix = Path.GetFullPath(binDir).TrimEnd('\\') + "\\";
        var title = new StringBuilder(520);
        EnumProc hide = (hwnd, _) =>
        {
            if (!IsWindowVisible(hwnd))
                return true;
            title.Clear();
            if (GetWindowTextW(hwnd, title, title.Capacity) > 0
                && title.ToString().StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                ShowWindow(hwnd, 0); // SW_HIDE
            return true;
        };
        var t = new Thread(() =>
        {
            for (;;)
            {
                try { EnumWindows(hide, IntPtr.Zero); } catch (Exception) { }
                Thread.Sleep(20);
            }
        }) { IsBackground = true, Name = "console-hider" };
        t.Start();
    }
}
