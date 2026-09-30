using System.Runtime.InteropServices;

namespace Runeframe.Win32Input;

/// <summary>
/// Shared translation layer: turns raw console INPUT_RECORDs into protocol
/// lines. The production record session and the isolated test harnesses both
/// use this class, so the harnesses assert the exact shape of the code that
/// ships.
///
/// Window origin and visible window size are read through the CONOUT$ handle;
/// when it is unavailable the last known origin (initially 0/0) is used and
/// the failure is logged once.
/// </summary>
internal sealed class RecordTranslator
{
    private readonly IntPtr _consoleOutput;
    private readonly bool _hasScreenBuffer;
    private readonly Action<string> _emit;
    private readonly Action<string> _log;

    private short _windowLeft;
    private short _windowTop;
    private bool _screenInfoFailureLogged;

    public RecordTranslator(
        IntPtr consoleOutput,
        bool hasScreenBuffer,
        Action<string> emit,
        Action<string> log)
    {
        _consoleOutput = consoleOutput;
        _hasScreenBuffer = hasScreenBuffer;
        _emit = emit;
        _log = log;
    }

    public short WindowLeft => _windowLeft;

    public short WindowTop => _windowTop;

    public void EmitRecord(INPUT_RECORD record)
    {
        switch (record.EventType)
        {
            case Win32.KEY_EVENT:
                {
                    KEY_EVENT_RECORD key = record.KeyEvent;
                    _emit(Protocol.Key(
                        key.Down,
                        key.RepeatCount,
                        key.UnicodeChar,
                        key.VirtualKeyCode,
                        key.VirtualScanCode,
                        key.ControlKeyState));
                    break;
                }

            case Win32.MOUSE_EVENT:
                {
                    MOUSE_EVENT_RECORD mouse = record.MouseEvent;

                    // Window origin can move (scroll/resize); refresh before
                    // reporting. On failure the last known value, initially 0,
                    // is used (documented in the helper README).
                    RefreshWindowOrigin();

                    _emit(Protocol.Mouse(
                        mouse.MousePosition.X,
                        mouse.MousePosition.Y,
                        mouse.ButtonState,
                        mouse.EventFlags,
                        mouse.ControlKeyState,
                        _windowLeft,
                        _windowTop));
                    break;
                }

            case Win32.WINDOW_BUFFER_SIZE_EVENT:
                {
                    // The protocol reports the visible window size (same source
                    // as Node's stdout.columns/rows), not the scrollback buffer.
                    if (TryRefreshWindowSize(out short columns, out short rows))
                    {
                        _emit(Protocol.Resize(columns, rows));
                    }

                    break;
                }

            default:
                // FOCUS_EVENT (0x0010) and MENU_EVENT (0x0008) are not part of
                // the protocol; consume and drop them so they cannot pile up.
                break;
        }
    }

    public bool TryRefreshWindowSize(out short columns, out short rows)
    {
        columns = 0;
        rows = 0;

        if (!_hasScreenBuffer)
        {
            return false;
        }

        if (!Win32.GetConsoleScreenBufferInfo(_consoleOutput, out CONSOLE_SCREEN_BUFFER_INFO info))
        {
            LogScreenInfoFailureOnce();
            return false;
        }

        _windowLeft = info.Window.Left;
        _windowTop = info.Window.Top;

        int width = info.Window.Right - info.Window.Left + 1;
        int height = info.Window.Bottom - info.Window.Top + 1;
        if (width <= 0 || height <= 0)
        {
            return false;
        }

        columns = (short)Math.Min(width, short.MaxValue);
        rows = (short)Math.Min(height, short.MaxValue);
        return true;
    }

    public void RefreshWindowOrigin()
    {
        if (!_hasScreenBuffer)
        {
            return; // windowLeft/windowTop stay 0 (documented fallback).
        }

        if (!TryRefreshWindowSize(out _, out _))
        {
            LogScreenInfoFailureOnce();
        }
    }

    private void LogScreenInfoFailureOnce()
    {
        if (_screenInfoFailureLogged)
        {
            return;
        }

        _screenInfoFailureLogged = true;
        _log($"GetConsoleScreenBufferInfo(CONOUT$) failed (win32 error {Marshal.GetLastWin32Error()}); reporting windowLeft/windowTop = {_windowLeft}/{_windowTop}");
    }
}
