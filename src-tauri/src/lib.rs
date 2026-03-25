mod commands;
mod config;
mod ssh;
mod state;

use state::AppState;

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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
