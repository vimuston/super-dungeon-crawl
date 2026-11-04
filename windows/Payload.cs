using System.IO.Compression;

namespace SuperDungeonCrawl;

/// <summary>
/// The single-exe package: build-windows.ps1 appends a zip of the game files
/// (bin\, usr\, web\, crawl\) to the launcher followed by a 32-byte trailer
/// [zip length: int64][id: 16 bytes][magic: "SDCPAYLD"]. On first start (or
/// after an update) the zip is unpacked into the data directory, leaving the
/// player's saves, rcs and morgue alone.
/// </summary>
static class Payload
{
    const string Magic = "SDCPAYLD";
    const int TrailerSize = 32;

    public static string DefaultDir => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "SuperDungeonCrawl", "game");

    /// <summary>The directory holding bin\, web\ and crawl\: the unpacked
    /// payload, or the exe's own folder when it carries none (dev layout).</summary>
    public static string Prepare(string dir)
    {
        string exe = Environment.ProcessPath;
        if (!Find(exe, out long start, out long length, out string id))
            return AppContext.BaseDirectory;

        string stamp = Path.Combine(dir, ".payload");
        if (File.Exists(stamp) && File.ReadAllText(stamp) == id
            && File.Exists(Path.Combine(dir, "bin", "crawl.exe")))
            return dir;

        Exception error = null;
        var label = new Label
        {
            Text = "Unpacking game files (first start only)...",
            AutoSize = false, Dock = DockStyle.Top, Height = 44,
            TextAlign = ContentAlignment.MiddleCenter, ForeColor = Color.Gainsboro,
        };
        var bar = new ProgressBar { Dock = DockStyle.Top, Style = ProgressBarStyle.Marquee, Height = 18 };
        var form = new Form
        {
            Text = GameWindow.Title, BackColor = Color.Black,
            Icon = Icon.ExtractAssociatedIcon(exe),
            FormBorderStyle = FormBorderStyle.FixedDialog, ControlBox = false,
            MaximizeBox = false, MinimizeBox = false, StartPosition = FormStartPosition.CenterScreen,
            ClientSize = new Size(380, 70),
        };
        form.Controls.Add(bar);
        form.Controls.Add(label);
        form.Shown += async (_, _) =>
        {
            try { await Task.Run(() => Extract(exe, start, length, dir, id, stamp)); }
            catch (Exception e) { error = e; }
            form.Close();
        };
        Application.Run(form);
        if (error != null)
            throw error;
        return dir;
    }

    static void Extract(string exe, long start, long length, string dir, string id, string stamp)
    {
        Directory.CreateDirectory(dir);
        File.Delete(stamp);
        // program files are replaced; what the player made (saves, rcs, morgue) stays,
        // but the compiled data caches are rebuilt from the new data
        foreach (var d in new[] { "bin", "usr", "web", @"crawl\dat", @"crawl\docs",
                                  @"crawl\settings", @"crawl\saves\des", @"crawl\saves\db" })
        {
            string p = Path.Combine(dir, d);
            if (Directory.Exists(p))
                Directory.Delete(p, true);
        }
        string prepared = Path.Combine(dir, "crawl", "saves", ".prepared");
        if (File.Exists(prepared))
            File.Delete(prepared);

        using var fs = new FileStream(exe, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
        using var zip = new ZipArchive(new Slice(fs, start, length), ZipArchiveMode.Read);
        string root = Path.GetFullPath(dir) + Path.DirectorySeparatorChar;
        foreach (var e in zip.Entries)
        {
            if (e.FullName.EndsWith('/') || e.FullName.EndsWith('\\'))
                continue;
            string target = Path.GetFullPath(Path.Combine(dir, e.FullName));
            if (!target.StartsWith(root, StringComparison.OrdinalIgnoreCase))
                continue; // never write outside the data dir
            // starter config files are only seeded, so later edits survive an update
            bool seed = e.FullName.Replace('\\', '/').StartsWith("crawl/rcs/");
            if (seed && File.Exists(target))
                continue;
            Directory.CreateDirectory(Path.GetDirectoryName(target));
            e.ExtractToFile(target, true);
        }
        File.WriteAllText(stamp, id);
    }

    static bool Find(string exe, out long start, out long length, out string id)
    {
        start = length = 0;
        id = null;
        try
        {
            using var fs = new FileStream(exe, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
            if (fs.Length < TrailerSize)
                return false;
            var t = new byte[TrailerSize];
            fs.Seek(-TrailerSize, SeekOrigin.End);
            for (int got = 0, n; got < t.Length; got += n)
                if ((n = fs.Read(t, got, t.Length - got)) <= 0)
                    return false;
            if (System.Text.Encoding.ASCII.GetString(t, 24, 8) != Magic)
                return false;
            length = BitConverter.ToInt64(t, 0);
            id = new Guid(t.AsSpan(8, 16)).ToString("N");
            start = fs.Length - TrailerSize - length;
            return length > 0 && start > 0;
        }
        catch (IOException) { return false; }
    }

    /// <summary>Read-only view of part of a seekable stream.</summary>
    sealed class Slice : Stream
    {
        readonly Stream inner;
        readonly long start, length;
        long pos;

        public Slice(Stream inner, long start, long length)
        {
            this.inner = inner;
            this.start = start;
            this.length = length;
        }

        public override bool CanRead => true;
        public override bool CanSeek => true;
        public override bool CanWrite => false;
        public override long Length => length;
        public override long Position { get => pos; set => pos = value; }
        public override void Flush() { }

        public override int Read(byte[] buffer, int offset, int count)
        {
            count = (int)Math.Min(count, Math.Max(0, length - pos));
            if (count == 0)
                return 0;
            inner.Position = start + pos;
            int n = inner.Read(buffer, offset, count);
            pos += n;
            return n;
        }

        public override long Seek(long offset, SeekOrigin origin) => pos = origin switch
        {
            SeekOrigin.Begin => offset,
            SeekOrigin.Current => pos + offset,
            _ => length + offset,
        };

        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }
}
