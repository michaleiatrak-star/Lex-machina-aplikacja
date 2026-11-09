using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Windows.Forms;

internal static class OfflineSelfExtractor
{
    private const string FooterMagic = "LEXOFF01";
    private const int FooterSize = 8 + 8 + 8 + 32;
    private const string InstallerName = "LexMachina-Offline-Setup.exe";
    private const string RuntimeName = "LexMachina-Offline-Runtime.zip";

    [STAThread]
    private static int Main(string[] args)
    {
        var silent = args.Any(a => string.Equals(a, "/S", StringComparison.OrdinalIgnoreCase));
        var workRoot = Path.Combine(Path.GetTempPath(), "LexMachinaOffline-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(workRoot);

        try
        {
            var self = Assembly.GetExecutingAssembly().Location;
            var packageRoot = Path.Combine(workRoot, "package");

            // Stage 1 of 3: extraction, with its own progress bar (copy, SHA-256 check, unpacking).
            Exception failure = null;
            if (silent)
            {
                Extract(self, workRoot, packageRoot, null);
            }
            else
            {
                Application.EnableVisualStyles();
                using (var form = new ExtractionForm())
                {
                    var worker = new System.Threading.Thread(() =>
                    {
                        try { Extract(self, workRoot, packageRoot, form.Report); }
                        catch (Exception ex) { failure = ex; }
                        finally { form.Finish(); }
                    });
                    worker.IsBackground = true;
                    form.Shown += (sender, e) => worker.Start();
                    Application.Run(form);
                    worker.Join();
                }
                if (failure != null) throw failure;
            }

            var installer = Path.Combine(packageRoot, InstallerName);
            var runtime = Path.Combine(packageRoot, RuntimeName);
            if (!File.Exists(installer))
                throw new InvalidDataException("OFFLINE_WRAPPER_INSTALLER_MISSING");
            if (!File.Exists(runtime))
                throw new InvalidDataException("OFFLINE_WRAPPER_RUNTIME_MISSING");

            var start = new ProcessStartInfo
            {
                FileName = installer,
                WorkingDirectory = packageRoot,
                UseShellExecute = false,
                Arguments = JoinArguments(args)
            };
            start.EnvironmentVariables["LEX_STANDALONE_OFFLINE_WRAPPER"] = "1";

            using (var child = Process.Start(start))
            {
                if (child == null)
                    throw new InvalidOperationException("OFFLINE_WRAPPER_INSTALLER_START_FAILED");
                child.WaitForExit();
                return child.ExitCode;
            }
        }
        catch (Exception ex)
        {
            var diagnostic = Path.Combine(Path.GetTempPath(), "LexMachinaOfflineSelfExtract-error.log");
            try { File.WriteAllText(diagnostic, ex.ToString(), new UTF8Encoding(false)); } catch { }
            if (!silent)
            {
                MessageBox.Show(
                    "Lex Machina: nie można uruchomić instalatora offline.\n\n" + ex.Message +
                    "\n\nSzczegóły: " + diagnostic,
                    "Instalator Lex Machina",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
            }
            return 70;
        }
        finally
        {
            try { Directory.Delete(workRoot, true); } catch { }
        }
    }

    // Shares of the extraction bar: copying the payload out of this file, checking its SHA-256, unpacking.
    private const double CopyShare = 0.40;
    private const double HashShare = 0.15;

    private static void Extract(string self, string workRoot, string packageRoot, Action<string, double> report)
    {
        var payloadZip = Path.Combine(workRoot, "payload.zip");
        ExtractAndVerifyPayload(self, payloadZip, report);
        Directory.CreateDirectory(packageRoot);
        Unpack(payloadZip, packageRoot, report);
        try { File.Delete(payloadZip); } catch { }
        if (report != null) report("Wyodrębnianie zakończone", 1.0);
    }

    private static void Unpack(string payloadZip, string packageRoot, Action<string, double> report)
    {
        var root = Path.GetFullPath(packageRoot).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        using (var zip = ZipFile.OpenRead(payloadZip))
        {
            long total = zip.Entries.Sum(e => e.Length);
            long done = 0;
            var buffer = new byte[4 * 1024 * 1024];
            foreach (var entry in zip.Entries)
            {
                if (string.IsNullOrEmpty(entry.Name)) continue;
                var target = Path.GetFullPath(Path.Combine(packageRoot, entry.FullName));
                if (!target.StartsWith(root, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("OFFLINE_WRAPPER_ENTRY_UNSAFE:" + entry.FullName);
                Directory.CreateDirectory(Path.GetDirectoryName(target));
                using (var input = entry.Open())
                using (var output = new FileStream(target, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                {
                    int read;
                    while ((read = input.Read(buffer, 0, buffer.Length)) > 0)
                    {
                        output.Write(buffer, 0, read);
                        done += read;
                        if (report != null && total > 0)
                            report("Rozpakowywanie składników instalatora…", CopyShare + HashShare + (1 - CopyShare - HashShare) * done / total);
                    }
                }
            }
        }
    }

    private static long FindFooterStart(FileStream source)
    {
        var magic = Encoding.ASCII.GetBytes(FooterMagic);

        // An Authenticode certificate table is a few KiB; 1 MiB of slack covers
        // that with room to spare while keeping the scan bounded.
        var scan = (int)Math.Min(source.Length, 1024L * 1024L);
        var window = new byte[scan];
        source.Seek(source.Length - scan, SeekOrigin.Begin);

        var filled = 0;
        while (filled < scan)
        {
            var read = source.Read(window, filled, scan - filled);
            if (read <= 0)
                throw new EndOfStreamException("OFFLINE_WRAPPER_FOOTER_UNREADABLE");
            filled += read;
        }

        var windowStart = source.Length - scan;
        for (var i = scan - FooterSize; i >= 0; i--)
        {
            var hit = true;
            for (var j = 0; j < magic.Length; j++)
            {
                if (window[i + j] != magic[j])
                {
                    hit = false;
                    break;
                }
            }

            if (hit)
                return windowStart + i;
        }

        return -1;
    }

    private static void ExtractAndVerifyPayload(string selfPath, string destination, Action<string, double> report)
    {
        long payloadOffset;
        long payloadLength;
        byte[] expectedHash;

        using (var source = new FileStream(selfPath, FileMode.Open, FileAccess.Read, FileShare.Read))
        {
            if (source.Length <= FooterSize)
                throw new InvalidDataException("OFFLINE_WRAPPER_FOOTER_MISSING");

            // Authenticode appends the certificate table to the end of the
            // file, so the footer is only the last bytes of an UNSIGNED
            // wrapper. Locate it by scanning backwards instead of assuming it
            // sits exactly at EOF, otherwise signing the wrapper breaks it.
            var footerStart = FindFooterStart(source);
            if (footerStart < 0)
                throw new InvalidDataException("OFFLINE_WRAPPER_MAGIC_INVALID");

            source.Seek(footerStart, SeekOrigin.Begin);
            using (var reader = new BinaryReader(source, Encoding.ASCII, true))
            {
                reader.ReadBytes(8);
                payloadOffset = reader.ReadInt64();
                payloadLength = reader.ReadInt64();
                expectedHash = reader.ReadBytes(32);
            }

            if (payloadOffset < 1 || payloadLength < 1 || payloadOffset + payloadLength != footerStart)
                throw new InvalidDataException("OFFLINE_WRAPPER_LAYOUT_INVALID");

            source.Seek(payloadOffset, SeekOrigin.Begin);
            using (var output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                var buffer = new byte[4 * 1024 * 1024];
                long remaining = payloadLength;
                while (remaining > 0)
                {
                    var requested = (int)Math.Min(buffer.Length, remaining);
                    var read = source.Read(buffer, 0, requested);
                    if (read <= 0)
                        throw new EndOfStreamException("OFFLINE_WRAPPER_PAYLOAD_TRUNCATED");
                    output.Write(buffer, 0, read);
                    remaining -= read;
                    if (report != null)
                        report("Wyodrębnianie pakietu instalacyjnego…", CopyShare * (payloadLength - remaining) / payloadLength);
                }
            }
        }

        byte[] actualHash;
        using (var sha = SHA256.Create())
        using (var payload = File.OpenRead(destination))
        {
            var buffer = new byte[4 * 1024 * 1024];
            long hashed = 0;
            int read;
            while ((read = payload.Read(buffer, 0, buffer.Length)) > 0)
            {
                sha.TransformBlock(buffer, 0, read, null, 0);
                hashed += read;
                if (report != null)
                    report("Sprawdzanie sumy kontrolnej SHA-256…", CopyShare + HashShare * hashed / payloadLength);
            }
            sha.TransformFinalBlock(new byte[0], 0, 0);
            actualHash = sha.Hash;
        }

        if (!actualHash.SequenceEqual(expectedHash))
            throw new InvalidDataException("OFFLINE_WRAPPER_PAYLOAD_HASH_MISMATCH");
    }

    private static string JoinArguments(string[] args)
    {
        return string.Join(" ", args.Select(QuoteArgument));
    }

    private static string QuoteArgument(string value)
    {
        if (string.IsNullOrEmpty(value))
            return "\"\"";
        if (!value.Any(char.IsWhiteSpace) && value.IndexOf('"') < 0)
            return value;

        var result = new StringBuilder();
        result.Append('"');
        var backslashes = 0;
        foreach (var c in value)
        {
            if (c == '\\')
            {
                backslashes++;
                continue;
            }
            if (c == '"')
            {
                result.Append('\\', backslashes * 2 + 1);
                result.Append('"');
                backslashes = 0;
                continue;
            }
            result.Append('\\', backslashes);
            backslashes = 0;
            result.Append(c);
        }
        result.Append('\\', backslashes * 2);
        result.Append('"');
        return result.ToString();
    }
}

// Stage 1 of 3 window: one bar filled by the bytes copied, checked and unpacked.
internal sealed class ExtractionForm : Form
{
    private readonly Label stage = new Label();
    private readonly Label detail = new Label();
    private readonly ProgressBar bar = new ProgressBar();
    private readonly Label percent = new Label();
    private int lastValue = -1;
    private bool finished;

    public ExtractionForm()
    {
        Text = "Instalacja Lex Machina";
        ClientSize = new System.Drawing.Size(540, 190);
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        ControlBox = false;
        stage.SetBounds(24, 18, 490, 26);
        stage.Font = new System.Drawing.Font("Segoe UI", 12, System.Drawing.FontStyle.Bold);
        stage.Text = "Etap 1 z 3: wyodrębnianie";
        detail.SetBounds(24, 50, 490, 24);
        detail.Font = new System.Drawing.Font("Segoe UI", 10);
        detail.Text = "Wyodrębnianie pakietu instalacyjnego…";
        bar.SetBounds(24, 84, 490, 22);
        bar.Minimum = 0;
        bar.Maximum = 1000;
        bar.Style = ProgressBarStyle.Continuous;
        percent.SetBounds(24, 116, 490, 22);
        percent.Text = "0%";
        var hint = new Label();
        hint.SetBounds(24, 144, 490, 36);
        hint.Text = "Następnie: etap 2 z 3 — przygotowanie, etap 3 z 3 — właściwa instalacja.";
        Controls.AddRange(new Control[] { stage, detail, bar, percent, hint });
        FormClosing += (sender, e) => { if (!finished) e.Cancel = true; };
    }

    public void Report(string text, double fraction)
    {
        var value = (int)Math.Max(0, Math.Min(1000, Math.Round(fraction * 1000)));
        if (value == lastValue) return;
        lastValue = value;
        if (!IsHandleCreated) return;
        BeginInvoke((Action)(() =>
        {
            detail.Text = text;
            bar.Value = value;
            percent.Text = (value / 10) + "%";
        }));
    }

    public void Finish()
    {
        if (!IsHandleCreated) { finished = true; return; }
        BeginInvoke((Action)(() => { finished = true; Close(); }));
    }
}
