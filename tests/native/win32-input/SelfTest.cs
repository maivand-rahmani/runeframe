using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace Runeframe.Win32Input;

/// <summary>
/// Pure checks that need no terminal: marshaled struct layout for
/// INPUT_RECORD/KEY_EVENT_RECORD/MOUSE_EVENT_RECORD and the exact JSON-line
/// protocol shape. In this mode stdout is a plain-text report, not protocol;
/// exit code 0 means all checks passed, 1 means a failure.
/// </summary>
internal static class SelfTest
{
    public static int Run()
    {
        int checks = 0;
        int failures = 0;

        void Check(string name, bool ok, string? detail = null)
        {
            checks++;
            if (ok)
            {
                Console.Out.WriteLine($"self-test ok: {name}");
            }
            else
            {
                failures++;
                Console.Error.WriteLine($"self-test FAIL: {name}{(detail is null ? string.Empty : $" ({detail})")}");
            }
        }

        // ------------------------------------------------------------------
        // Interop struct sizes for the x64 console ABI.
        // ------------------------------------------------------------------
        Check("INPUT_RECORD is 20 bytes", Marshal.SizeOf<INPUT_RECORD>() == 20, $"actual {Marshal.SizeOf<INPUT_RECORD>()}");
        Check("KEY_EVENT_RECORD is 16 bytes", Marshal.SizeOf<KEY_EVENT_RECORD>() == 16, $"actual {Marshal.SizeOf<KEY_EVENT_RECORD>()}");
        Check("MOUSE_EVENT_RECORD is 16 bytes", Marshal.SizeOf<MOUSE_EVENT_RECORD>() == 16, $"actual {Marshal.SizeOf<MOUSE_EVENT_RECORD>()}");
        Check("WINDOW_BUFFER_SIZE_RECORD is 4 bytes", Marshal.SizeOf<WINDOW_BUFFER_SIZE_RECORD>() == 4, $"actual {Marshal.SizeOf<WINDOW_BUFFER_SIZE_RECORD>()}");
        Check("CONSOLE_SCREEN_BUFFER_INFO is 22 bytes", Marshal.SizeOf<CONSOLE_SCREEN_BUFFER_INFO>() == 22, $"actual {Marshal.SizeOf<CONSOLE_SCREEN_BUFFER_INFO>()}");
        Check("COORD is 4 bytes", Marshal.SizeOf<COORD>() == 4, $"actual {Marshal.SizeOf<COORD>()}");
        Check("SMALL_RECT is 8 bytes", Marshal.SizeOf<SMALL_RECT>() == 8, $"actual {Marshal.SizeOf<SMALL_RECT>()}");

        Check("INPUT_RECORD.EventType is at offset 0", Marshal.OffsetOf<INPUT_RECORD>(nameof(INPUT_RECORD.EventType)).ToInt64() == 0);
        Check("INPUT_RECORD.KeyEvent is at offset 4", Marshal.OffsetOf<INPUT_RECORD>(nameof(INPUT_RECORD.KeyEvent)).ToInt64() == 4);
        Check("INPUT_RECORD.MouseEvent is at offset 4", Marshal.OffsetOf<INPUT_RECORD>(nameof(INPUT_RECORD.MouseEvent)).ToInt64() == 4);
        Check("INPUT_RECORD.WindowBufferSizeEvent is at offset 4", Marshal.OffsetOf<INPUT_RECORD>(nameof(INPUT_RECORD.WindowBufferSizeEvent)).ToInt64() == 4);

        Check("KEY_EVENT_RECORD.DownValue (native 4-byte BOOL) is at offset 0", Marshal.OffsetOf<KEY_EVENT_RECORD>(nameof(KEY_EVENT_RECORD.DownValue)).ToInt64() == 0);
        Check("KEY_EVENT_RECORD.RepeatCount is at offset 4", Marshal.OffsetOf<KEY_EVENT_RECORD>(nameof(KEY_EVENT_RECORD.RepeatCount)).ToInt64() == 4);
        Check("KEY_EVENT_RECORD.VirtualKeyCode is at offset 6", Marshal.OffsetOf<KEY_EVENT_RECORD>(nameof(KEY_EVENT_RECORD.VirtualKeyCode)).ToInt64() == 6);
        Check("KEY_EVENT_RECORD.VirtualScanCode is at offset 8", Marshal.OffsetOf<KEY_EVENT_RECORD>(nameof(KEY_EVENT_RECORD.VirtualScanCode)).ToInt64() == 8);
        Check("KEY_EVENT_RECORD.UnicodeChar is at offset 10", Marshal.OffsetOf<KEY_EVENT_RECORD>(nameof(KEY_EVENT_RECORD.UnicodeChar)).ToInt64() == 10);
        Check("KEY_EVENT_RECORD.ControlKeyState is at offset 12", Marshal.OffsetOf<KEY_EVENT_RECORD>(nameof(KEY_EVENT_RECORD.ControlKeyState)).ToInt64() == 12);

        // The managed layout is what the marshaller copies for the explicit-
        // layout INPUT_RECORD (see Win32Interop.cs), so it must equal the
        // native layout byte for byte; size alone is not enough (the old
        // 1-byte-bool layout was also 16 bytes, just shifted).
        Check(
            "KEY_EVENT_RECORD managed size equals native size (16)",
            Unsafe.SizeOf<KEY_EVENT_RECORD>() == 16 && Marshal.SizeOf<KEY_EVENT_RECORD>() == 16,
            $"managed {Unsafe.SizeOf<KEY_EVENT_RECORD>()}, marshalled {Marshal.SizeOf<KEY_EVENT_RECORD>()}");
        Check(
            "INPUT_RECORD managed size equals native size (20)",
            Unsafe.SizeOf<INPUT_RECORD>() == 20 && Marshal.SizeOf<INPUT_RECORD>() == 20,
            $"managed {Unsafe.SizeOf<INPUT_RECORD>()}, marshalled {Marshal.SizeOf<INPUT_RECORD>()}");

        // Native BOOL semantics: any nonzero value is key-down, not only the
        // canonical 1 (the old shifted read produced 0x00010001 here).
        KEY_EVENT_RECORD noncanonicalDown = new KEY_EVENT_RECORD { DownValue = 0x00010001 };
        Check(
            "KEY_EVENT_RECORD decodes a noncanonical nonzero BOOL as Down",
            noncanonicalDown.Down,
            $"DownValue=0x{noncanonicalDown.DownValue:X8}");
        KEY_EVENT_RECORD zeroDown = new KEY_EVENT_RECORD { DownValue = 0 };
        Check("KEY_EVENT_RECORD decodes a zero BOOL as not Down", !zeroDown.Down);
        KEY_EVENT_RECORD canonicalDown = new KEY_EVENT_RECORD { Down = true };
        Check(
            "KEY_EVENT_RECORD.Down setter stores the canonical 4-byte 1",
            canonicalDown.DownValue == 1 && canonicalDown.Down,
            $"DownValue={canonicalDown.DownValue}");

        // ------------------------------------------------------------------
        // Independent native-byte ABI fixtures (hand-built wincon.h bytes).
        // Size/OffsetOf checks above are self-consistent and cannot catch a
        // wrong-but-consistent layout (the historical UnicodeChar-at-offset-8
        // scan-code alias produced H/P/Space-9 in the physical run). These
        // checks anchor both directions to literal bytes instead.
        // ------------------------------------------------------------------
        RunAbiFixtureChecks(Check);

        // ------------------------------------------------------------------
        // Exact protocol lines (deterministic property order, no whitespace).
        // ------------------------------------------------------------------
        Check(
            "ready line is exact",
            Protocol.Ready(7, 507) == "{\"type\":\"ready\",\"originalMode\":7,\"mode\":507}",
            Protocol.Ready(7, 507));

        string keyDownA = Protocol.Key(true, 1, 0x61, 0x41, 0x1E, 0);
        Check(
            "key down 'a' line is exact",
            keyDownA == "{\"type\":\"key\",\"down\":true,\"repeat\":1,\"char\":\"a\",\"virtualKey\":65,\"virtualScanCode\":30,\"control\":0}",
            keyDownA);

        string keyUpNoChar = Protocol.Key(false, 3, 0, 0x41, 0x1E, 0x0008);
        Check(
            "key up without char line is exact",
            keyUpNoChar == "{\"type\":\"key\",\"down\":false,\"repeat\":3,\"char\":\"\",\"virtualKey\":65,\"virtualScanCode\":30,\"control\":8}",
            keyUpNoChar);

        // Arrow keys are the records the physical adapter run failed to
        // translate; the scan code travels next to the virtual key so a
        // consumer can disambiguate without changing existing fields.
        string arrowUpLine = Protocol.Key(true, 1, 0, 0x26, 0x48, 0);
        Check(
            "arrow up line carries virtualKey 38 and virtualScanCode 72",
            arrowUpLine == "{\"type\":\"key\",\"down\":true,\"repeat\":1,\"char\":\"\",\"virtualKey\":38,\"virtualScanCode\":72,\"control\":0}",
            arrowUpLine);

        using (JsonDocument arrowUp = JsonDocument.Parse(arrowUpLine))
        {
            JsonElement root = arrowUp.RootElement;
            Check(
                "arrow up virtualScanCode parses as the number 72",
                root.GetProperty("virtualKey").GetUInt32() == 38
                    && root.GetProperty("virtualScanCode").GetUInt32() == 72);
        }

        string mouseLine = Protocol.Mouse(5, 7, 1, 2, 8, 0, 0);
        Check(
            "mouse line is exact",
            mouseLine == "{\"type\":\"mouse\",\"x\":5,\"y\":7,\"buttons\":1,\"flags\":2,\"control\":8,\"windowLeft\":0,\"windowTop\":0}",
            mouseLine);

        Check(
            "resize line is exact",
            Protocol.Resize(80, 24) == "{\"type\":\"resize\",\"columns\":80,\"rows\":24}",
            Protocol.Resize(80, 24));

        Check(
            "error line is exact",
            Protocol.Error("boom") == "{\"type\":\"error\",\"message\":\"boom\"}",
            Protocol.Error("boom"));

        // ------------------------------------------------------------------
        // Field names, in order, with nothing missing or extra.
        // ------------------------------------------------------------------
        Check("ready line shape", HasShape(Protocol.Ready(7, 507), "type", "originalMode", "mode"));
        Check("key line shape", HasShape(keyDownA, "type", "down", "repeat", "char", "virtualKey", "virtualScanCode", "control"));
        Check("mouse line shape", HasShape(mouseLine, "type", "x", "y", "buttons", "flags", "control", "windowLeft", "windowTop"));
        Check("resize line shape", HasShape(Protocol.Resize(80, 24), "type", "columns", "rows"));
        Check("error line shape", HasShape(Protocol.Error("boom"), "type", "message"));

        // ------------------------------------------------------------------
        // Round-trips for escaped/surrogate characters and DWORD-sized fields.
        // ------------------------------------------------------------------
        Check("ctrl+c char (U+0003) survives JSON escaping", CharRoundTrip(0x0003) == "\u0003", CharRoundTrip(0x0003));
        Check("non-ASCII char (U+00E9) survives JSON escaping", CharRoundTrip(0x00E9) == "\u00e9", CharRoundTrip(0x00E9));

        bool loneSurrogateThrew = false;
        string loneSurrogateLine = string.Empty;
        try
        {
            loneSurrogateLine = Protocol.Key(true, 1, 0xD83D, 0, 0, 0);
        }
        catch (Exception)
        {
            loneSurrogateThrew = true;
        }

        Check(
            "lone surrogate code unit is emitted as an exact escape",
            !loneSurrogateThrew
                && loneSurrogateLine == "{\"type\":\"key\",\"down\":true,\"repeat\":1,\"char\":\"\\uD83D\",\"virtualKey\":0,\"virtualScanCode\":0,\"control\":0}",
            loneSurrogateThrew ? "threw" : loneSurrogateLine);

        // JSON.parse (the consumer is Node) accepts lone surrogate escapes and
        // concatenating the high/low events reconstructs the astral character;
        // System.Text.Json intentionally rejects them, so this stays an exact
        // text check. Verified against Node v22: '\\uD83D' + '\\uDE00' is U+1F600.
        string lowSurrogateLine = Protocol.Key(true, 1, 0xDE00, 0, 0, 0);
        Check(
            "low surrogate code unit is emitted as an exact escape",
            lowSurrogateLine == "{\"type\":\"key\",\"down\":true,\"repeat\":1,\"char\":\"\\uDE00\",\"virtualKey\":0,\"virtualScanCode\":0,\"control\":0}",
            lowSurrogateLine);

        using (JsonDocument wheel = JsonDocument.Parse(Protocol.Mouse(10, 20, 0x00080000, 0x0004, 0, 0, 0)))
        {
            JsonElement root = wheel.RootElement;
            Check(
                "wheel button state keeps the full 32-bit value",
                root.GetProperty("buttons").GetUInt32() == 0x00080000 && root.GetProperty("flags").GetUInt32() == 0x0004);
        }

        // ------------------------------------------------------------------
        // Lines must be single-line (no embedded CR/LF) for line framing.
        // ------------------------------------------------------------------
        string[] lines =
        {
            Protocol.Ready(0, 0),
            keyDownA,
            keyUpNoChar,
            mouseLine,
            Protocol.Resize(80, 24),
            Protocol.Error("boom"),
        };

        Check("protocol lines contain no raw CR/LF", lines.All(line => !line.Contains('\n') && !line.Contains('\r')));

        if (failures == 0)
        {
            Console.Out.WriteLine($"self-test: PASS ({checks} checks)");
            return ExitCodes.Success;
        }

        Console.Error.WriteLine($"self-test: FAIL ({failures} of {checks} checks failed)");
        return ExitCodes.SelfTestFailed;
    }

    /// <summary>
    /// Independent native-byte fixture checks. The expected bytes are literal
    /// wincon.h layout values, not the output of a Marshal round-trip, so a
    /// self-consistent but wrong layout cannot pass. The RecordTranslator is
    /// constructed with IntPtr.Zero and hasScreenBuffer:false and only the key
    /// path is exercised: no console handle is opened or touched.
    /// </summary>
    private static void RunAbiFixtureChecks(Action<string, bool, string?> check)
    {
        byte[] arrowKeyBytes = SelfTestAbiFixture.ArrowKeyEventRecordBytes();
        byte[] arrowRecordBytes = SelfTestAbiFixture.ArrowInputRecordBytes();
        byte[] spaceKeyBytes = SelfTestAbiFixture.SpaceKeyEventRecordBytes();
        byte[] spaceRecordBytes = SelfTestAbiFixture.SpaceInputRecordBytes();

        check(
            "native KEY_EVENT_RECORD fixture is 16 bytes",
            arrowKeyBytes.Length == SelfTestAbiFixture.KeyEventRecordSize,
            $"actual {arrowKeyBytes.Length}");
        check(
            "native INPUT_RECORD fixture is 20 bytes",
            arrowRecordBytes.Length == SelfTestAbiFixture.InputRecordSize,
            $"actual {arrowRecordBytes.Length}");

        // Hand-built native bytes -> PtrToStructure. Each field must land where
        // wincon.h puts it, independent of Marshal.OffsetOf.
        KEY_EVENT_RECORD arrowKey = SelfTestAbiFixture.ReadKeyEventRecord(arrowKeyBytes);
        check(
            "native KEY_EVENT_RECORD bKeyDown reads as TRUE (BOOL int32 at 0)",
            arrowKey.Down,
            $"Down={arrowKey.Down}");
        check(
            "native KEY_EVENT_RECORD wRepeatCount is 1 (offset 4)",
            arrowKey.RepeatCount == 1,
            $"repeat={arrowKey.RepeatCount}");
        check(
            "native KEY_EVENT_RECORD wVirtualKeyCode is 0x26 VK_UP (offset 6)",
            arrowKey.VirtualKeyCode == SelfTestAbiFixture.VirtualKeyUp,
            $"vk=0x{arrowKey.VirtualKeyCode:X4}");
        check(
            "native KEY_EVENT_RECORD wVirtualScanCode is 0x48 (offset 8)",
            arrowKey.VirtualScanCode == SelfTestAbiFixture.ScanCodeUp,
            $"scan=0x{arrowKey.VirtualScanCode:X4}");
        check(
            "native KEY_EVENT_RECORD UnicodeChar is empty (offset 10)",
            arrowKey.UnicodeChar == 0,
            $"char=0x{arrowKey.UnicodeChar:X4}");
        check(
            "native KEY_EVENT_RECORD dwControlKeyState is 0x100 ENHANCED_KEY (offset 12)",
            arrowKey.ControlKeyState == SelfTestAbiFixture.EnhancedKey,
            $"control=0x{arrowKey.ControlKeyState:X8}");

        INPUT_RECORD arrowRecord = SelfTestAbiFixture.ReadInputRecord(arrowRecordBytes);
        check(
            "native INPUT_RECORD EventType is KEY_EVENT 1 at offset 0",
            arrowRecord.EventType == Win32.KEY_EVENT,
            $"EventType=0x{arrowRecord.EventType:X4}");
        check(
            "native INPUT_RECORD KeyEvent union at offset 4 reads VK/scan/char/control",
            arrowRecord.KeyEvent.VirtualKeyCode == SelfTestAbiFixture.VirtualKeyUp
                && arrowRecord.KeyEvent.VirtualScanCode == SelfTestAbiFixture.ScanCodeUp
                && arrowRecord.KeyEvent.UnicodeChar == 0
                && arrowRecord.KeyEvent.ControlKeyState == SelfTestAbiFixture.EnhancedKey,
            $"vk=0x{arrowRecord.KeyEvent.VirtualKeyCode:X4} scan=0x{arrowRecord.KeyEvent.VirtualScanCode:X4} char=0x{arrowRecord.KeyEvent.UnicodeChar:X4} control=0x{arrowRecord.KeyEvent.ControlKeyState:X8}");
        check(
            "arrow UnicodeChar is not aliased to the scan-code byte (historical H/P symptom absent)",
            arrowRecord.KeyEvent.UnicodeChar == 0
                && arrowRecord.KeyEvent.VirtualScanCode == SelfTestAbiFixture.ScanCodeUp,
            $"char=0x{arrowRecord.KeyEvent.UnicodeChar:X4} scan=0x{arrowRecord.KeyEvent.VirtualScanCode:X4}");

        // Reverse direction: StructureToPtr must place each field at the
        // literal native offset (KEY_EVENT_RECORD-relative 8 = scan, 10 = char;
        // absolute in INPUT_RECORD 12 and 14).
        INPUT_RECORD arrowInstance = new INPUT_RECORD
        {
            EventType = Win32.KEY_EVENT,
            KeyEvent = new KEY_EVENT_RECORD
            {
                Down = true,
                RepeatCount = 1,
                VirtualKeyCode = SelfTestAbiFixture.VirtualKeyUp,
                VirtualScanCode = SelfTestAbiFixture.ScanCodeUp,
                UnicodeChar = 0,
                ControlKeyState = SelfTestAbiFixture.EnhancedKey,
            },
        };

        byte[] arrowWritten = SelfTestAbiFixture.WriteInputRecord(arrowInstance);
        string arrowHex = SelfTestAbiFixture.Hex(arrowWritten);
        check(
            "StructureToPtr writes exactly 20 bytes for INPUT_RECORD",
            arrowWritten.Length == SelfTestAbiFixture.InputRecordSize,
            $"actual {arrowWritten.Length}");
        check(
            "StructureToPtr matches the literal arrow fixture byte-for-byte",
            arrowWritten.SequenceEqual(arrowRecordBytes),
            arrowHex);
        check(
            "StructureToPtr EventType 1 at bytes 0..1",
            SelfTestAbiFixture.BytesAt(arrowWritten, 0, 0x01, 0x00),
            arrowHex);
        check(
            "StructureToPtr zero padding at bytes 2..3",
            SelfTestAbiFixture.BytesAt(arrowWritten, 2, 0x00, 0x00),
            arrowHex);
        check(
            "StructureToPtr bKeyDown int32 1 at bytes 4..7",
            SelfTestAbiFixture.BytesAt(arrowWritten, 4, 0x01, 0x00, 0x00, 0x00),
            arrowHex);
        check(
            "StructureToPtr wRepeatCount 1 at bytes 8..9",
            SelfTestAbiFixture.BytesAt(arrowWritten, 8, 0x01, 0x00),
            arrowHex);
        check(
            "StructureToPtr wVirtualKeyCode 0x26 at bytes 10..11",
            SelfTestAbiFixture.BytesAt(arrowWritten, 10, 0x26, 0x00),
            arrowHex);
        check(
            "StructureToPtr wVirtualScanCode 0x48 at bytes 12..13 (record-relative 8)",
            SelfTestAbiFixture.BytesAt(arrowWritten, 12, 0x48, 0x00),
            arrowHex);
        check(
            "StructureToPtr UnicodeChar 0 at bytes 14..15 (record-relative 10)",
            SelfTestAbiFixture.BytesAt(arrowWritten, 14, 0x00, 0x00),
            arrowHex);
        check(
            "StructureToPtr dwControlKeyState 0x100 at bytes 16..19",
            SelfTestAbiFixture.BytesAt(arrowWritten, 16, 0x00, 0x01, 0x00, 0x00),
            arrowHex);

        // Diagnostic probe (not a production shape): the same 20 bytes through
        // a SEQUENTIAL wrapper. If this marshals field-wise while the explicit
        // INPUT_RECORD above does not, the divergence is specific to
        // LayoutKind.Explicit embedding rather than nesting in general.
        SelfTestAbiFixture.SequentialInputRecordProbe probe =
            SelfTestAbiFixture.ReadSequentialProbe(arrowRecordBytes);
        check(
            "diagnostic: sequential wrapper nested KEY_EVENT_RECORD reads VK/scan/char from native offsets",
            probe.EventType == Win32.KEY_EVENT
                && probe.KeyEvent.VirtualKeyCode == SelfTestAbiFixture.VirtualKeyUp
                && probe.KeyEvent.VirtualScanCode == SelfTestAbiFixture.ScanCodeUp
                && probe.KeyEvent.UnicodeChar == 0,
            $"vk=0x{probe.KeyEvent.VirtualKeyCode:X4} scan=0x{probe.KeyEvent.VirtualScanCode:X4} char=0x{probe.KeyEvent.UnicodeChar:X4}");

        var probeInstance = new SelfTestAbiFixture.SequentialInputRecordProbe
        {
            EventType = Win32.KEY_EVENT,
            Padding = 0,
            KeyEvent = arrowInstance.KeyEvent,
        };
        byte[] probeWritten = SelfTestAbiFixture.WriteSequentialProbe(probeInstance);
        check(
            "diagnostic: sequential wrapper StructureToPtr matches the literal fixture",
            probeWritten.SequenceEqual(arrowRecordBytes),
            SelfTestAbiFixture.Hex(probeWritten));

        // Space fixture: the character at native offset 10 (absolute 14) is
        // read and written, not just zero.
        KEY_EVENT_RECORD spaceKey = SelfTestAbiFixture.ReadKeyEventRecord(spaceKeyBytes);
        check(
            "native space KEY_EVENT_RECORD UnicodeChar is 0x20 (offset 10)",
            spaceKey.UnicodeChar == 0x20,
            $"char=0x{spaceKey.UnicodeChar:X4}");
        check(
            "native space KEY_EVENT_RECORD wVirtualScanCode is 0x39 (offset 8)",
            spaceKey.VirtualScanCode == SelfTestAbiFixture.ScanCodeSpace,
            $"scan=0x{spaceKey.VirtualScanCode:X4}");

        INPUT_RECORD spaceInstance = new INPUT_RECORD
        {
            EventType = Win32.KEY_EVENT,
            KeyEvent = new KEY_EVENT_RECORD
            {
                Down = true,
                RepeatCount = 1,
                VirtualKeyCode = SelfTestAbiFixture.VirtualKeySpace,
                VirtualScanCode = SelfTestAbiFixture.ScanCodeSpace,
                UnicodeChar = 0x20,
                ControlKeyState = 0,
            },
        };

        byte[] spaceWritten = SelfTestAbiFixture.WriteInputRecord(spaceInstance);
        check(
            "StructureToPtr space UnicodeChar 0x20 at bytes 14..15 (record-relative 10)",
            SelfTestAbiFixture.BytesAt(spaceWritten, 14, 0x20, 0x00),
            SelfTestAbiFixture.Hex(spaceWritten));
        check(
            "StructureToPtr space matches the literal space fixture byte-for-byte",
            spaceWritten.SequenceEqual(spaceRecordBytes),
            SelfTestAbiFixture.Hex(spaceWritten));

        // RecordTranslator key path: exact protocol line from the hand-built
        // native fixture. IntPtr.Zero + hasScreenBuffer:false means any console
        // access would log/fail here; the key path must not touch a handle.
        var keyLines = new List<string>();
        var keyLogs = new List<string>();
        var translator = new RecordTranslator(IntPtr.Zero, hasScreenBuffer: false, keyLines.Add, keyLogs.Add);
        translator.EmitRecord(arrowRecord);
        translator.EmitRecord(SelfTestAbiFixture.ReadInputRecord(spaceRecordBytes));

        const string expectedArrowLine = "{\"type\":\"key\",\"down\":true,\"repeat\":1,\"char\":\"\",\"virtualKey\":38,\"virtualScanCode\":72,\"control\":256}";
        check(
            "RecordTranslator arrow line is exact (char empty, VK 38, scan 72, repeat 1, control 256)",
            keyLines.Count == 2 && keyLines[0] == expectedArrowLine,
            keyLines.Count > 0 ? keyLines[0] : "no line emitted");

        const string expectedSpaceLine = "{\"type\":\"key\",\"down\":true,\"repeat\":1,\"char\":\" \",\"virtualKey\":32,\"virtualScanCode\":57,\"control\":0}";
        check(
            "RecordTranslator space line is exact (char ' ' at offset 10)",
            keyLines.Count == 2 && keyLines[1] == expectedSpaceLine,
            keyLines.Count > 1 ? keyLines[1] : "no line emitted");

        check(
            "RecordTranslator key path opened no console handle (no log, IntPtr.Zero)",
            keyLogs.Count == 0,
            string.Join(" | ", keyLogs));

        if (keyLines.Count == 2 && keyLines[0] == expectedArrowLine)
        {
            // Independent parse of the emitted line: char is a string, scan is
            // the number 72, control is the number 256.
            using JsonDocument arrowJson = JsonDocument.Parse(keyLines[0]);
            JsonElement root = arrowJson.RootElement;
            check(
                "arrow line char parses as the empty string",
                root.GetProperty("char").GetString() == string.Empty,
                null);
            check(
                "arrow line virtualScanCode parses as the number 72",
                root.GetProperty("virtualScanCode").GetUInt32() == 72,
                null);
            check(
                "arrow line control parses as the number 256",
                root.GetProperty("control").GetUInt32() == 256,
                null);
        }
    }

    private static bool HasShape(string json, params string[] expectedNames)
    {
        try
        {
            using JsonDocument document = JsonDocument.Parse(json);
            if (document.RootElement.ValueKind != JsonValueKind.Object)
            {
                return false;
            }

            var actualNames = new List<string>();
            foreach (JsonProperty property in document.RootElement.EnumerateObject())
            {
                actualNames.Add(property.Name);
            }

            return actualNames.SequenceEqual(expectedNames);
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private static string? CharRoundTrip(ushort unicodeChar)
    {
        using JsonDocument document = JsonDocument.Parse(Protocol.Key(true, 1, unicodeChar, 0, 0, 0));
        return document.RootElement.GetProperty("char").GetString();
    }
}
