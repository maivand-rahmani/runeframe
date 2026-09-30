using System.Runtime.InteropServices;

namespace Runeframe.Win32Input;

/// <summary>
/// Harness-only additions to the shared <see cref="Win32"/> interop: process
/// creation, console record injection and window control used by the isolated
/// self-test / ConPTY harnesses. These declarations are deliberately kept
/// out of the production project, which compiles only the shared record core.
/// </summary>
internal static partial class Win32
{
    // CreateProcessW creation flags.
    public const uint CREATE_NEW_CONSOLE = 0x00000010;

    // ShowWindow.
    public const int SW_HIDE = 0;

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool WriteConsoleInputW(
        IntPtr hConsoleInput,
        [In] INPUT_RECORD[] lpBuffer,
        uint nLength,
        out uint lpNumberOfEventsWritten);

    /// <summary>Processes attached to this console; used as the isolation proof.</summary>
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint GetConsoleProcessList([Out] uint[] lpdwProcessList, uint dwProcessCount);

    [DllImport("kernel32.dll", SetLastError = false)]
    public static extern IntPtr GetConsoleWindow();

    [DllImport("user32.dll", SetLastError = false)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool CreateProcessW(
        string? lpApplicationName,
        string lpCommandLine,
        IntPtr lpProcessAttributes,
        IntPtr lpThreadAttributes,
        [MarshalAs(UnmanagedType.Bool)] bool bInheritHandles,
        uint dwCreationFlags,
        IntPtr lpEnvironment,
        string? lpCurrentDirectory,
        ref STARTUPINFO lpStartupInfo,
        out PROCESS_INFORMATION lpProcessInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetExitCodeProcess(IntPtr hProcess, out uint lpExitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool TerminateProcess(IntPtr hProcess, uint uExitCode);
}

/// <summary>
/// STARTUPINFO (processthreadsapi.h). Only <c>cb</c> is set by the isolated
/// console self-test; the standard handles are intentionally left unspecified
/// so a CREATE_NEW_CONSOLE child uses its new console's handles and cannot
/// write to the caller's console streams.
/// </summary>
[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
internal struct STARTUPINFO
{
    public int cb;
    public string? lpReserved;
    public string? lpDesktop;
    public string? lpTitle;
    public int dwX;
    public int dwY;
    public int dwXSize;
    public int dwYSize;
    public int dwXCountChars;
    public int dwYCountChars;
    public int dwFillAttribute;
    public int dwFlags;
    public short wShowWindow;
    public short cbReserved2;
    public IntPtr lpReserved2;
    public IntPtr hStdInput;
    public IntPtr hStdOutput;
    public IntPtr hStdError;
}

[StructLayout(LayoutKind.Sequential)]
internal struct PROCESS_INFORMATION
{
    public IntPtr Process;
    public IntPtr Thread;
    public uint ProcessId;
    public uint ThreadId;
}
