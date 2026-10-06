mod trust_boundary;

use std::{
    env,
    io,
    path::{Path, PathBuf},
    process::Command,
    sync::Arc,
};
use tauri::Manager;
use trust_boundary::RuntimeBridge;

fn is_allowed_external_url(url: &str) -> bool {
    let normalized = url.trim().to_ascii_lowercase();
    normalized.starts_with("https://")
        && !normalized.contains('\r')
        && !normalized.contains('\n')
}

fn valid_workspace_open_token(token: &str) -> bool {
    if token.contains('/')
        || token.contains('\\')
        || token.contains('\r')
        || token.contains('\n')
        || token.contains("..")
    {
        return false;
    }
    let Some(rest) = token.strip_prefix("open_") else {
        return false;
    };
    let (hex, extension) = match rest.split_once('.') {
        Some((hex, extension)) => (hex, Some(extension)),
        None => (rest, None),
    };
    if hex.len() != 32
        || !hex.bytes().all(|value| value.is_ascii_hexdigit())
    {
        return false;
    }
    extension.map_or(true, |value| {
        !value.is_empty()
            && value.len() <= 10
            && value
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
    })
}

fn valid_update_receipt_token(token: &str) -> bool {
    if token.len() < 16
        || token.len() > 180
        || !token.starts_with("update_")
        || !token.ends_with(".json")
        || token.contains('/')
        || token.contains('\\')
        || token.contains(':')
        || token.contains("..")
        || token.contains('\r')
        || token.contains('\n')
    {
        return false;
    }
    token.bytes().all(|byte| {
        byte.is_ascii_alphanumeric()
            || matches!(byte, b'_' | b'-' | b'.')
    })
}

fn authorized_workspace_open_path(token: &str) -> Result<PathBuf, String> {
    if !valid_workspace_open_token(token) {
        return Err("WORKSPACE_OPEN_TOKEN_INVALID".to_string());
    }
    let root = env::temp_dir().join("LexMachinaOpen");
    let root = root
        .canonicalize()
        .map_err(|_| "WORKSPACE_OPEN_ROOT_MISSING".to_string())?;
    let target = root.join(token);
    let target = target
        .canonicalize()
        .map_err(|_| "WORKSPACE_OPEN_FILE_MISSING".to_string())?;
    if !target.starts_with(&root) || !target.is_file() {
        return Err("WORKSPACE_OPEN_PATH_NOT_ALLOWED".to_string());
    }
    Ok(target)
}

fn launch_default_handler(target: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let status = Command::new("rundll32.exe")
        .arg("url.dll,FileProtocolHandler")
        .arg(target)
        .status();

    #[cfg(target_os = "macos")]
    let status = Command::new("open")
        .arg(target)
        .status();

    #[cfg(all(unix, not(target_os = "macos")))]
    let status = Command::new("xdg-open")
        .arg(target)
        .status();

    let status = status
        .map_err(|_| "DEFAULT_HANDLER_LAUNCH_FAILED".to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err("DEFAULT_HANDLER_LAUNCH_FAILED".to_string())
    }
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    if !is_allowed_external_url(&url) {
        return Err("EXTERNAL_URL_NOT_ALLOWED".to_string());
    }

    #[cfg(target_os = "windows")]
    let status = Command::new("rundll32.exe")
        .arg("url.dll,FileProtocolHandler")
        .arg(&url)
        .status();

    #[cfg(target_os = "macos")]
    let status = Command::new("open")
        .arg(&url)
        .status();

    #[cfg(all(unix, not(target_os = "macos")))]
    let status = Command::new("xdg-open")
        .arg(&url)
        .status();

    let status = status
        .map_err(|_| "EXTERNAL_BROWSER_LAUNCH_FAILED".to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err("EXTERNAL_BROWSER_LAUNCH_FAILED".to_string())
    }
}

// Weryfikacja sn.pl: użytkownik sam rozwiązuje captcha (Imperva) w oknie sn.pl; aplikacja
// odczytuje tylko ciasteczka tej sesji i przekazuje je konektorowi SN. Strona zdalna nie ma IPC.
const SN_VERIFICATION_LABEL: &str = "sn-verification";
const SN_VERIFICATION_URL: &str = "https://www.sn.pl/pl/wyszukiwarka-orzeczen";

fn is_sn_url(url: &tauri::Url) -> bool {
    url.scheme() == "https"
        && matches!(url.host_str(), Some("www.sn.pl") | Some("sn.pl"))
}

fn valid_cookie_part(name: &str, value: &str) -> bool {
    !name.is_empty()
        && name.len() <= 128
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.'))
        && value.len() <= 4096
        && !value
            .bytes()
            .any(|byte| matches!(byte, b';' | b'\r' | b'\n'))
}

fn cookie_header<'a>(pairs: impl Iterator<Item = (&'a str, &'a str)>) -> String {
    pairs
        .filter(|(name, value)| valid_cookie_part(name, value))
        .map(|(name, value)| format!("{name}={value}"))
        .collect::<Vec<_>>()
        .join("; ")
}

#[tauri::command]
async fn sn_verification_open(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(SN_VERIFICATION_LABEL) {
        let _ = window.unminimize();
        return window
            .set_focus()
            .map_err(|_| "SN_VERIFICATION_WINDOW_FAILED".to_string());
    }
    let url = SN_VERIFICATION_URL
        .parse::<tauri::Url>()
        .map_err(|_| "SN_VERIFICATION_URL_INVALID".to_string())?;
    tauri::WebviewWindowBuilder::new(
        &app,
        SN_VERIFICATION_LABEL,
        tauri::WebviewUrl::External(url),
    )
    .title("Weryfikacja sn.pl - rozwiaz captcha, potem kliknij Gotowe w Lex Machina")
    .inner_size(1000.0, 760.0)
    .on_navigation(is_sn_url)
    .build()
    .map_err(|error| format!("SN_VERIFICATION_WINDOW_FAILED:{error}"))?;
    Ok(())
}

// Async: na Windows odczyt ciasteczek WebView2 w komendzie synchronicznej blokuje się (wry#583).
#[tauri::command]
async fn sn_verification_finish(app: tauri::AppHandle) -> Result<String, String> {
    let window = app
        .get_webview_window(SN_VERIFICATION_LABEL)
        .ok_or_else(|| "SN_VERIFICATION_WINDOW_MISSING".to_string())?;
    let url = SN_VERIFICATION_URL
        .parse::<tauri::Url>()
        .map_err(|_| "SN_VERIFICATION_URL_INVALID".to_string())?;
    let cookies = window
        .cookies_for_url(url)
        .map_err(|_| "SN_VERIFICATION_COOKIES_FAILED".to_string())?;
    let header = cookie_header(
        cookies.iter().map(|cookie| (cookie.name(), cookie.value())),
    );
    let _ = window.close();
    if header.is_empty() {
        return Err("SN_VERIFICATION_NO_COOKIES".to_string());
    }
    Ok(header)
}

#[tauri::command]
fn open_workspace_file(token: String) -> Result<(), String> {
    let target = authorized_workspace_open_path(&token)?;
    launch_default_handler(&target)
}

#[tauri::command]
fn install_application_update(
    app: tauri::AppHandle,
    receipt_token: String,
) -> Result<(), String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        let _ = receipt_token;
        return Err("APPLICATION_UPDATE_PLATFORM_UNSUPPORTED".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        if !valid_update_receipt_token(&receipt_token) {
            return Err("APPLICATION_UPDATE_RECEIPT_TOKEN_INVALID".to_string());
        }

        let resource_dir = app
            .path()
            .resource_dir()
            .map_err(|_| "APPLICATION_UPDATE_RESOURCE_DIR_MISSING".to_string())?;
        let runtime_root = resource_dir.join("runtime");
        let runner = runtime_root
            .join("bootstrap")
            .join("app-update-transaction.ps1");
        if !runner.is_file() {
            return Err("APPLICATION_UPDATE_RUNNER_MISSING".to_string());
        }

        let receipt = env::temp_dir()
            .join("LexMachinaUpdate")
            .join(&receipt_token);
        if !receipt.is_file() {
            return Err("APPLICATION_UPDATE_RECEIPT_MISSING".to_string());
        }

        let executable = env::current_exe()
            .map_err(|_| "APPLICATION_UPDATE_EXECUTABLE_MISSING".to_string())?;
        let install_root = executable
            .parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| "APPLICATION_UPDATE_INSTALL_ROOT_MISSING".to_string())?;
        let powershell = env::var_os("SystemRoot")
            .map(PathBuf::from)
            .map(|root| {
                root.join("System32")
                    .join("WindowsPowerShell")
                    .join("v1.0")
                    .join("powershell.exe")
            })
            .unwrap_or_else(|| PathBuf::from("powershell.exe"));

        Command::new(powershell)
            .arg("-NoProfile")
            .arg("-NonInteractive")
            .arg("-ExecutionPolicy")
            .arg("Bypass")
            .arg("-WindowStyle")
            .arg("Hidden")
            .arg("-File")
            .arg(&runner)
            .arg("-ReceiptPath")
            .arg(&receipt)
            .arg("-RuntimeRoot")
            .arg(&runtime_root)
            .arg("-InstallRoot")
            .arg(&install_root)
            .arg("-AppExecutable")
            .arg(&executable)
            .arg("-ParentPid")
            .arg(std::process::id().to_string())
            .spawn()
            .map_err(|error| format!("APPLICATION_UPDATE_RUNNER_START_FAILED:{error}"))?;

        app.exit(0);
        Ok(())
    }
}

pub fn run() {
    let bridge = Arc::new(
        RuntimeBridge::new()
            .expect("failed to initialize desktop trust boundary")
    );
    let protocol_bridge = Arc::clone(&bridge);
    let setup_bridge = Arc::clone(&bridge);
    let exit_bridge = Arc::clone(&bridge);

    let app = tauri::Builder::default()
        .invoke_handler(
            tauri::generate_handler![
                open_external_url,
                open_workspace_file,
                install_application_update,
                sn_verification_open,
                sn_verification_finish
            ]
        )
        .register_asynchronous_uri_scheme_protocol(
            "lex-api",
            move |_context, request, responder| {
                let bridge = Arc::clone(&protocol_bridge);
                std::thread::spawn(move || {
                    responder.respond(
                        bridge.handle(request)
                    );
                });
            },
        )
        .setup(move |app| {
            let resource_dir =
                app.path().resource_dir()?;
            setup_bridge
                .start(&resource_dir)
                .map_err(io::Error::other)?;
            setup_bridge
                .ensure_managed_identity()
                .map_err(io::Error::other)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Lex Machina desktop");

    app.run(move |_app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            let _ = exit_bridge.shutdown();
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{
        cookie_header,
        is_allowed_external_url,
        is_sn_url,
        valid_update_receipt_token,
        valid_workspace_open_token,
    };

    #[test]
    fn external_url_requires_https() {
        assert!(is_allowed_external_url("https://example.com/path"));
        assert!(!is_allowed_external_url("http://example.com"));
        assert!(!is_allowed_external_url("file:///C:/secret.txt"));
        assert!(!is_allowed_external_url("https://example.com\r\nX-Test: 1"));
    }

    #[test]
    fn sn_verification_stays_on_sn_pl_and_keeps_valid_cookies() {
        assert!(is_sn_url(&"https://www.sn.pl/pl/wyszukiwarka-orzeczen".parse().unwrap()));
        assert!(!is_sn_url(&"http://www.sn.pl/".parse().unwrap()));
        assert!(!is_sn_url(&"https://sn.pl.example.com/".parse().unwrap()));
        assert_eq!(
            cookie_header(
                [("incap_ses_1", "a"), ("bad name", "x"), ("visid_incap_1", "b;c"), ("nlbi_1", "d")]
                    .into_iter()
            ),
            "incap_ses_1=a; nlbi_1=d"
        );
    }

    #[test]
    fn workspace_open_token_cannot_escape_temp_root() {
        assert!(valid_workspace_open_token(
            "open_0123456789abcdef0123456789abcdef.pdf"
        ));
        assert!(valid_workspace_open_token(
            "open_0123456789abcdef0123456789abcdef"
        ));
        assert!(!valid_workspace_open_token("../secret.pdf"));
        assert!(!valid_workspace_open_token(
            "open_0123456789abcdef0123456789abcdef/secret.pdf"
        ));
        assert!(!valid_workspace_open_token(
            "open_0123456789abcdef0123456789abcdef.PDF"
        ));
    }

    #[test]
    fn update_receipt_token_cannot_escape_staging_root() {
        assert!(valid_update_receipt_token(
            "update_0-1-4_0123456789abcdef.json"
        ));
        assert!(!valid_update_receipt_token("../update.json"));
        assert!(!valid_update_receipt_token("update_a/b.json"));
        assert!(!valid_update_receipt_token("update_a\\b.json"));
        assert!(!valid_update_receipt_token("receipt.json"));
    }
}
