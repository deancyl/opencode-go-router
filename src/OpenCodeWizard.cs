using System;
using System.Diagnostics;
using System.IO;

namespace OpenCodeWizard
{
    class Program
    {
        static void Main(string[] args)
        {
            string rootDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
            if (!File.Exists(Path.Combine(rootDir, "setup-wizard.ps1")))
            {
                string userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
                string candidate = Path.Combine(userProfile, ".opencode-go-router");
                if (File.Exists(Path.Combine(candidate, "setup-wizard.ps1")))
                {
                    rootDir = candidate;
                }
            }

            string wizardScript = Path.Combine(rootDir, "setup-wizard.ps1");
            string arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + wizardScript + "\"";
            if (args.Length > 0)
            {
                arguments += " " + string.Join(" ", args);
            }

            ProcessStartInfo psi = new ProcessStartInfo("powershell.exe", arguments);
            psi.WorkingDirectory = rootDir;
            psi.UseShellExecute = false;

            Process proc = Process.Start(psi);
            if (proc != null)
            {
                proc.WaitForExit();
            }
        }
    }
}
