mod commands;
mod config;
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
            commands::encrypt_profile_passphrase,
            commands::decrypt_profile_passphrase,
            commands::detect_agent,
            commands::list_agent_identities,
            commands::probe_host,
            commands::connect_ssh,
            commands::disconnect_ssh,
            commands::open_shell,
            commands::close_shell,
            commands::write_to_shell,
            commands::resize_shell,
            commands::ping_session,
            commands::fetch_system_stats,
        ])
        .setup(|app| {
            // restore window state from our portable config
            let handle = app.handle().clone();
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
                // grab position/size from before maximize so we restore to the right spot
                let (x, y, width, height) = if maximized {
                    // when maximized, the current pos/size is the maximized one -
                    // not super useful, but better than nothing. on next launch
                    // we'll restore maximized anyway
                    let pos = window.outer_position().unwrap_or_default();
                    let size = window.outer_size().unwrap_or_default();
                    (pos.x, pos.y, size.width, size.height)
                } else {
                    let pos = window.outer_position().unwrap_or_default();
                    let size = window.outer_size().unwrap_or_default();
                    (pos.x, pos.y, size.width, size.height)
                };

                let ws = WindowState { x, y, width, height, maximized };
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
