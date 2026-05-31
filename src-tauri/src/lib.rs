mod chrome;
mod commands;
mod config;
mod local;
mod sftp;
mod ssh;
mod state;

use config::WindowState;
use state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::get_profiles,
            commands::save_profile,
            commands::delete_profile,
            commands::get_last_profile,
            commands::get_appearance,
            commands::save_appearance,
            commands::set_window_vibrancy,
            commands::encrypt_profile_passphrase,
            commands::decrypt_profile_passphrase,
            commands::detect_agent,
            commands::list_agent_identities,
            commands::probe_host,
            commands::connect_ssh,
            commands::disconnect_ssh,
            commands::open_shell,
            commands::open_ssh_shell,
            commands::detect_local_shells,
            commands::open_local_shell,
            commands::channel_ready,
            commands::close_shell,
            commands::write_to_shell,
            commands::resize_shell,
            commands::ping_session,
            commands::fetch_system_stats,
            commands::fetch_local_stats,
            commands::get_active_sessions,
            commands::get_launch_path,
            commands::sftp_list_dir,
            commands::sftp_realpath,
            commands::sftp_read_file,
            commands::sftp_write_file,
            commands::sftp_mkdir,
            commands::sftp_remove,
            commands::sftp_rename,
            chrome::set_max_button_rect,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let _ = ssh::init_ssh_debug(&handle);

            // win11 acrylic behind the transparent window - the terminal's translucent bg
            // frosts over it. acrylic blurs everything behind (windows + wallpaper).
            #[cfg(target_os = "windows")]
            if let Some(win) = app.get_webview_window("main") {
                use window_vibrancy::apply_acrylic;
                let _ = apply_acrylic(&win, Some((6, 6, 14, 180)));

                // drop the 1px dwm border AND the win11 rounded corners - a cockpit
                // has hard edges. now that decorations are off these are the last two
                // bits of os chrome bleeding into the borderless look.
                if let Ok(hwnd) = win.hwnd() {
                    use windows_sys::Win32::Graphics::Dwm::{
                        DwmSetWindowAttribute, DWMWA_BORDER_COLOR,
                        DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_DONOTROUND,
                    };
                    let none_color: u32 = 0xFFFFFFFE;
                    let corner_pref: u32 = DWMWCP_DONOTROUND as u32;
                    unsafe {
                        DwmSetWindowAttribute(
                            hwnd.0 as _,
                            DWMWA_BORDER_COLOR as u32,
                            &none_color as *const u32 as *const _,
                            std::mem::size_of::<u32>() as u32,
                        );
                        DwmSetWindowAttribute(
                            hwnd.0 as _,
                            DWMWA_WINDOW_CORNER_PREFERENCE as u32,
                            &corner_pref as *const u32 as *const _,
                            std::mem::size_of::<u32>() as u32,
                        );
                    }

                    chrome::init_snap_subclass(win.clone(), hwnd.0 as _);
                }
            }

            // restore window state from our portable config
            if let Ok(cfg) = config::load_config(&handle) {
                if let Some(ws) = cfg.window_state {
                    if let Some(win) = app.get_webview_window("main") {
                        use tauri::PhysicalPosition;
                        use tauri::PhysicalSize;
                        // only restore position if it looks intentional (not default -1,-1)
                        if ws.x >= 0 && ws.y >= 0 {
                            let _ = win.set_position(PhysicalPosition::new(ws.x, ws.y));
                        }
                        let _ = win.set_size(PhysicalSize::new(ws.width, ws.height));
                        if ws.maximized {
                            let _ = win.maximize();
                        }
                    }
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // save window state when the window is about to close
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let maximized = window.is_maximized().unwrap_or(false);
                let pos = window.outer_position().unwrap_or_default();
                let size = window.outer_size().unwrap_or_default();
                let (x, y, width, height) = (pos.x, pos.y, size.width, size.height);

                let ws = WindowState {
                    x,
                    y,
                    width,
                    height,
                    maximized,
                };
                let handle = window.app_handle().clone();

                // save synchronously - we're closing, no rush
                if let Ok(mut cfg) = config::load_config(&handle) {
                    cfg.window_state = Some(ws);
                    let _ = config::save_config(&handle, &cfg);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
