$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class UtilitiesFolderPicker {
    [ComImport, Guid("42F85136-DB7E-439C-85F1-E4075D135FC8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IFileDialog {
        [PreserveSig] int Show(IntPtr owner);
        void SetFileTypes(uint count, IntPtr types);
        void SetFileTypeIndex(uint index);
        void GetFileTypeIndex(out uint index);
        void Advise(IntPtr events, out uint cookie);
        void Unadvise(uint cookie);
        void SetOptions(uint options);
        void GetOptions(out uint options);
        void SetDefaultFolder(IShellItem folder);
        void SetFolder(IShellItem folder);
        void GetFolder(out IShellItem folder);
        void GetCurrentSelection(out IShellItem selection);
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
        void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string name);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
        void GetResult(out IShellItem result);
        void AddPlace(IShellItem item, uint alignment);
        void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string extension);
        void Close(int result);
        void SetClientGuid(ref Guid guid);
        void ClearClientData();
        void SetFilter(IntPtr filter);
    }
    [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IShellItem {
        void BindToHandler(IntPtr context, ref Guid handler, ref Guid iid, out IntPtr result);
        void GetParent(out IShellItem parent);
        void GetDisplayName(uint kind, out IntPtr name);
        void GetAttributes(uint mask, out uint attributes);
        void Compare(IShellItem other, uint hint, out int order);
    }
    [DllImport("shell32.dll", CharSet=CharSet.Unicode, PreserveSig=false)]
    static extern void SHCreateItemFromParsingName(string path, IntPtr context, ref Guid iid, out IShellItem item);
    [DllImport("user32.dll")]
    static extern IntPtr GetForegroundWindow();
    public static string Pick(string start) {
        // Give the dialog the active browser/window as owner. An unowned shell
        // dialog can reopen on a different monitor at its last saved position.
        IntPtr owner = GetForegroundWindow();
        var dialog = (IFileDialog)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")));
        IShellItem folder = null, result = null;
        try {
            uint options; dialog.GetOptions(out options);
            dialog.SetOptions(options | 0x20U | 0x40U | 0x800U | 0x02000000U | 0x8U);
            dialog.SetTitle("Utilities - Select repository folder");
            dialog.SetOkButtonLabel("Select folder");
            if (!String.IsNullOrEmpty(start)) {
                var iid = new Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE");
                SHCreateItemFromParsingName(start, IntPtr.Zero, ref iid, out folder);
                dialog.SetFolder(folder);
            }
            int status = dialog.Show(owner);
            if (status == unchecked((int)0x800704C7)) return null;
            Marshal.ThrowExceptionForHR(status);
            dialog.GetResult(out result);
            IntPtr name; result.GetDisplayName(0x80058000, out name);
            try { return Marshal.PtrToStringUni(name); } finally { Marshal.FreeCoTaskMem(name); }
        } finally {
            if (result != null) Marshal.FinalReleaseComObject(result);
            if (folder != null) Marshal.FinalReleaseComObject(folder);
            Marshal.FinalReleaseComObject(dialog);
        }
    }
}
'@
$chosen = [UtilitiesFolderPicker]::Pick($env:UTILITIES_PICKER_START)
if ($chosen) { [Console]::WriteLine($chosen) }
