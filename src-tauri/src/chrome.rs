// the win11 snap-layout flyout for a borderless window. decorations are off, so the
// os no longer owns a maximize button to hover - we hand it one back by answering
// WM_NCHITTEST with HTMAXBUTTON over the spot where our html button actually lives.
// the frontend measures that button and reports its rect (physical px, client-relative);
// dwm does the rest. drag-to-edge and win+arrow snap already work without any of this -
// this is purely the hover-the-button zone picker.

#[tauri::command]
pub fn set_max_button_rect(_x: i32, _y: i32, _w: i32, _h: i32) {
    #[cfg(target_os = "windows")]
    if let Ok(mut r) = win::MAX_BTN_RECT.lock() {
        *r = Some((_x, _y, _w, _h));
    }
}

/// the borderless-glass treatment: win11 acrylic + kill the dwm 1px border and the
/// rounded corners. a cockpit has hard edges. shared by the main window and every
/// torn-off one. the snap subclass is NOT in here on purpose - it's a singleton
/// (one set of statics, one max-button rect) and the flyout's deferred anyway, so
/// only the main window gets subclassed.
#[cfg(target_os = "windows")]
pub fn apply_glass_chrome(window: &tauri::WebviewWindow) {
    use window_vibrancy::apply_acrylic;
    use windows_sys::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_WINDOW_CORNER_PREFERENCE,
        DWMWCP_DONOTROUND,
    };

    let _ = apply_acrylic(window, Some((6, 6, 14, 180)));
    if let Ok(hwnd) = window.hwnd() {
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
    }
}

#[cfg(not(target_os = "windows"))]
pub fn apply_glass_chrome(_window: &tauri::WebviewWindow) {}

#[cfg(target_os = "windows")]
pub use win::init as init_snap_subclass;

#[cfg(target_os = "windows")]
mod win {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Mutex, OnceLock};
    use tauri::{Emitter, WebviewWindow};
    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM};
    use windows_sys::Win32::Graphics::Gdi::ScreenToClient;
    use windows_sys::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, IsZoomed, SetWindowLongPtrW, SetWindowPos, ShowWindow, GWL_STYLE,
        HTMAXBUTTON, SWP_FRAMECHANGED, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SW_MAXIMIZE,
        SW_RESTORE, WM_NCHITTEST, WM_NCLBUTTONDOWN, WM_NCLBUTTONUP, WM_NCMOUSELEAVE,
        WM_NCMOUSEMOVE, WS_MAXIMIZEBOX, WS_MINIMIZEBOX,
    };

    pub static MAX_BTN_RECT: Mutex<Option<(i32, i32, i32, i32)>> = Mutex::new(None);
    static WINDOW: OnceLock<WebviewWindow> = OnceLock::new();
    static HOVERING: AtomicBool = AtomicBool::new(false);

    const SUBCLASS_ID: usize = 0x4B4C; // "KL"

    pub fn init(window: WebviewWindow, hwnd: HWND) {
        let _ = WINDOW.set(window);
        unsafe {
            // borderless tao windows drop the maximize box, and dwm refuses to serve the
            // snap flyout without it. add it back - no caption is on, so nothing draws.
            let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
            SetWindowLongPtrW(
                hwnd,
                GWL_STYLE,
                style | (WS_MAXIMIZEBOX | WS_MINIMIZEBOX) as isize,
            );
            SetWindowPos(
                hwnd,
                std::ptr::null_mut(),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED,
            );
            SetWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID, 0);
        }
    }

    fn over_max_button(hwnd: HWND, screen_x: i32, screen_y: i32) -> bool {
        let Some((x, y, w, h)) = MAX_BTN_RECT.lock().ok().and_then(|r| *r) else {
            return false;
        };
        let mut pt = POINT {
            x: screen_x,
            y: screen_y,
        };
        unsafe {
            ScreenToClient(hwnd, &mut pt);
        }
        pt.x >= x && pt.x < x + w && pt.y >= y && pt.y < y + h
    }

    fn set_hover(hovering: bool) {
        if HOVERING.swap(hovering, Ordering::Relaxed) != hovering {
            if let Some(win) = WINDOW.get() {
                let _ = win.emit("kl://max-hover", hovering);
            }
        }
    }

    unsafe extern "system" fn subclass_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _id: usize,
        _ref: usize,
    ) -> LRESULT {
        match msg {
            WM_NCHITTEST => {
                // lparam packs signed screen coords - low word x, high word y
                let x = (lparam & 0xFFFF) as i16 as i32;
                let y = ((lparam >> 16) & 0xFFFF) as i16 as i32;
                if over_max_button(hwnd, x, y) {
                    return HTMAXBUTTON as LRESULT;
                }
            }
            WM_NCMOUSEMOVE => set_hover(wparam as u32 == HTMAXBUTTON),
            WM_NCMOUSELEAVE => set_hover(false),
            // the os owns the button now, so swallow its down and drive the toggle on up
            WM_NCLBUTTONDOWN if wparam as u32 == HTMAXBUTTON => return 0,
            WM_NCLBUTTONUP if wparam as u32 == HTMAXBUTTON => {
                set_hover(false);
                if IsZoomed(hwnd) != 0 {
                    ShowWindow(hwnd, SW_RESTORE);
                } else {
                    ShowWindow(hwnd, SW_MAXIMIZE);
                }
                return 0;
            }
            _ => {}
        }
        DefSubclassProc(hwnd, msg, wparam, lparam)
    }
}
