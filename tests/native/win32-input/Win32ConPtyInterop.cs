using System.Runtime.InteropServices;

namespace Runeframe.Win32Input;

/// <summary>
/// kernel32 pseudoconsole (ConPTY) interop for the headless
/// <c>--self-test-conpty-records</c> harness. Requires Windows 10 1809 or newer; every
/// call is checked by the caller and nothing here throws by itself (an
/// unavailable entry point surfaces as the usual DllImport exception, which
/// the harness catches and reports).
///
/// Only ConPTY-specific declarations live here. Shared types
/// (<see cref="COORD"/>, <see cref="STARTUPINFO"/>, <see cref="SECURITY_ATTRIBUTES"/>,
/// <see cref="PROCESS_INFORMATION"/>) and the general kernel32 surface are
/// reused from <see cref="Win32"/> and <see cref="Win32TestPipe"/>.
/// </summary>
internal static class Win32ConPty
{
    /// <summary>CreateProcessW flag: STARTUPINFOEXW with a proc-thread attribute list.</summary>
    public const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;

    /// <summary>ProcThreadAttributePseudoConsole (processthreadsapi.h): HPCON to attach the child to.</summary>
    public static readonly IntPtr PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE = new(0x00020016);

    /// <summary>
    /// ProcThreadAttributeHandleList: restricts inheritance to exactly the
    /// listed handles (all of which must be inheritable).
    /// </summary>
    public static readonly IntPtr PROC_THREAD_ATTRIBUTE_HANDLE_LIST = new(0x00020002);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool InitializeProcThreadAttributeList(
        IntPtr lpAttributeList,
        int dwAttributeCount,
        int dwFlags,
        ref IntPtr lpSize);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool UpdateProcThreadAttribute(
        IntPtr lpAttributeList,
        uint dwFlags,
        IntPtr attribute,
        IntPtr lpValue,
        IntPtr cbSize,
        IntPtr lpPreviousValue,
        IntPtr lpReturnSize);

    [DllImport("kernel32.dll", SetLastError = false)]
    public static extern void DeleteProcThreadAttributeList(IntPtr lpAttributeList);

    /// <summary>
    /// CreateProcessW overload taking STARTUPINFOEXW so the pseudoconsole and
    /// handle-list attributes can be supplied. The general overload in
    /// <see cref="Win32"/> is left untouched.
    /// </summary>
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
        ref STARTUPINFOEXW lpStartupInfo,
        out PROCESS_INFORMATION lpProcessInformation);

    /// <summary>
    /// Creates a pseudoconsole of the requested character size.
    /// <paramref name="hInput"/> is the read end of the input pipe the
    /// pseudoconsole reads host input from; <paramref name="hOutput"/> is the
    /// write end of the output pipe it renders to. The handles are duplicated
    /// into the pseudoconsole and may be closed by the caller afterwards.
    /// Returns an HRESULT (negative = failure).
    /// </summary>
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern int CreatePseudoConsole(
        COORD size,
        IntPtr hInput,
        IntPtr hOutput,
        uint dwFlags,
        out IntPtr phPC);

    /// <summary>Closes the pseudoconsole session and releases its pipe references.</summary>
    [DllImport("kernel32.dll", SetLastError = false)]
    public static extern void ClosePseudoConsole(IntPtr hPC);
}

/// <summary>
/// STARTUPINFOEXW (processthreadsapi.h): the STARTUPINFO layout followed by
/// the attribute-list pointer used with EXTENDED_STARTUPINFO_PRESENT.
/// </summary>
[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
internal struct STARTUPINFOEXW
{
    public STARTUPINFO StartupInfo;
    public IntPtr lpAttributeList;
}
