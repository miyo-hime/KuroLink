// "Open KuroLink here" lives entirely in the user's own registry hive (HKCU), so there's
// no admin prompt, no installer, and the portable exe stays portable. flip it on from
// settings, flip it back off, move the exe and re-flip - all from the ui.
//
// on win11 this lands under "show more options" rather than the top-level menu. the new
// menu only reads entries from a signed msix package fronted by an IExplorerCommand com
// handler - a worse trade for a single portable binary than living one click deeper.

#[derive(serde::Serialize)]
pub struct ContextMenuStatus {
    pub registered: bool,
    // a portable exe can move; if the registered command points elsewhere the menu is
    // stale and would launch the wrong (or a gone) binary. re-register fixes it.
    pub stale: bool,
}

#[cfg(target_os = "windows")]
const MENU_LABEL: &str = "Open KuroLink here";

// the two ways a folder gets right-clicked: on the folder itself, and in its empty space.
#[cfg(target_os = "windows")]
const SHELL_KEYS: [&str; 2] = [
    r"Software\Classes\Directory\shell\KuroLink",
    r"Software\Classes\Directory\Background\shell\KuroLink",
];

#[cfg(target_os = "windows")]
fn exe_path() -> Result<String, String> {
    std::env::current_exe()
        .map_err(|e| format!("can't read exe path: {e}"))?
        .to_str()
        .map(str::to_string)
        .ok_or_else(|| "exe path isn't valid utf-8".to_string())
}

#[tauri::command]
pub fn context_menu_status() -> Result<ContextMenuStatus, String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let exe = exe_path()?;
        let mut registered = true;
        let mut stale = false;
        for base in SHELL_KEYS {
            match hkcu.open_subkey(format!(r"{base}\command")) {
                Ok(cmd) => {
                    let val: String = cmd.get_value("").unwrap_or_default();
                    if !val.contains(&exe) {
                        stale = true;
                    }
                }
                Err(_) => registered = false,
            }
        }
        Ok(ContextMenuStatus {
            registered,
            stale: registered && stale,
        })
    }
    #[cfg(not(target_os = "windows"))]
    Ok(ContextMenuStatus {
        registered: false,
        stale: false,
    })
}

#[tauri::command]
pub fn register_context_menu() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let exe = exe_path()?;
        let command = format!("\"{exe}\" --path \"%V\"");
        let oops = |e: std::io::Error| format!("registry write failed: {e}");

        for base in SHELL_KEYS {
            let (key, _) = hkcu.create_subkey(base).map_err(oops)?;
            key.set_value("", &MENU_LABEL).map_err(oops)?;
            key.set_value("Icon", &exe).map_err(oops)?;
            let (cmd, _) = key.create_subkey("command").map_err(oops)?;
            cmd.set_value("", &command).map_err(oops)?;
        }
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    Err("context menu integration is windows-only".to_string())
}

#[tauri::command]
pub fn unregister_context_menu() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        for base in SHELL_KEYS {
            match hkcu.delete_subkey_all(base) {
                Ok(()) => {}
                // already gone is the state we wanted anyway
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(format!("registry delete failed: {e}")),
            }
        }
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    Err("context menu integration is windows-only".to_string())
}
