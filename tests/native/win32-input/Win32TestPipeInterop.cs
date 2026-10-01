using System.Runtime.InteropServices;

namespace Runeframe.Win32Input;

/// <summary>
/// Test-only anonymous-pipe and byte-stream interop shared by the isolated
/// console and headless ConPTY harnesses. These declarations are deliberately
/// kept out of the production project, which compiles only the shared record
/// core; nothing here is part of any product transport. Every call is checked
/// by the caller and nothing here throws by itself.
/// </summary>
internal static class Win32TestPipe
{
    // SetHandleInformation.
    public const uint HANDLE_FLAG_INHERIT = 0x00000001;

    // STARTUPINFO.dwFlags.
    public const int STARTF_USESTDHANDLES = 0x00000100;

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool ReadFile(
        IntPtr hFile,
        ref byte lpBuffer,
        uint nNumberOfBytesToRead,
        out uint lpNumberOfBytesRead,
        IntPtr lpOverlapped);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool WriteFile(
        IntPtr hFile,
        ref byte lpBuffer,
        uint nNumberOfBytesToWrite,
        out uint lpNumberOfBytesWritten,
        IntPtr lpOverlapped);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool CreatePipe(
        out IntPtr hReadPipe,
        out IntPtr hWritePipe,
        ref SECURITY_ATTRIBUTES lpPipeAttributes,
        uint nSize);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetHandleInformation(IntPtr hObject, uint dwMask, uint dwFlags);

    /// <summary>
    /// Writes every byte, looping over partial writes. Returns false with the
    /// Win32 error when the stream is gone; the caller stops the harness.
    /// </summary>
    public static bool WriteBytesToHandle(IntPtr handle, byte[] buffer, int count, out int error)
    {
        error = 0;
        int offset = 0;

        while (offset < count)
        {
            if (!WriteFile(handle, ref buffer[offset], (uint)(count - offset), out uint written, IntPtr.Zero))
            {
                error = Marshal.GetLastWin32Error();
                return false;
            }

            if (written == 0)
            {
                error = Win32.ERROR_BROKEN_PIPE;
                return false;
            }

            offset += (int)written;
        }

        return true;
    }
}

[StructLayout(LayoutKind.Sequential)]
internal struct SECURITY_ATTRIBUTES
{
    public int nLength;
    public IntPtr lpSecurityDescriptor;

    [MarshalAs(UnmanagedType.Bool)]
    public bool bInheritHandle;
}
