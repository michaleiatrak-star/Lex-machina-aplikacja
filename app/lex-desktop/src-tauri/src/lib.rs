#[cfg(target_os = "macos")]
mod macos_setup;
#[cfg(target_os = "macos")]
use macos_setup::{component_setup_status, component_setup_start, component_setup_finish};
mod trust_boundary;

use std::{
    env,
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
    // Domyślny program uruchamia się tylko dla dokumentów i obrazów, nigdy dla pliku
    // wykonywalnego (.exe, .bat, .hta, .command) ani dokumentu z makrami.
    extension.is_some_and(|value| OPEN_ALLOWED_EXTENSIONS.contains(&value))
}

// Zgodne z OPEN_ALLOWED_EXTENSIONS w lex-runtime/src/http/workspace-routes.ts.
const OPEN_ALLOWED_EXTENSIONS: &[&str] = &[
    "pdf", "docx", "doc", "odt", "rtf", "txt", "md", "csv", "xlsx", "xls", "ods", "pptx", "ppt",
    "odp", "png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff",
];

fn workspace_open_root() -> PathBuf {
    env::temp_dir().join("LexMachinaOpen")
}

/// Przy zamknięciu aplikacji usuwa odszyfrowane kopie "Otwórz w programie" (best-effort:
/// plik wciąż otwarty w innym programie na Windows zostaje do następnego otwarcia).
fn wipe_workspace_open_copies(root: &Path) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if name.starts_with("open_") && entry.file_type().is_ok_and(|kind| kind.is_file()) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

// Katalog stagingu aktualizacji jak w runtime (os.tmpdir(): najpierw TEMP) i runnerze
// ($env:TEMP). env::temp_dir() czyta najpierw TMP, więc przy różnych TMP i TEMP
// paragon nie był znajdowany (APPLICATION_UPDATE_RECEIPT_MISSING).
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn update_staging_root(temp: Option<std::ffi::OsString>) -> PathBuf {
    temp.filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(env::temp_dir)
        .join("LexMachinaUpdate")
}

// Where the update runner keeps its journal and log (app-update-transaction.ps1): the
// start log of the runner's own process sits next to them.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn update_log_dir(
    local_app_data: Option<std::ffi::OsString>,
    temp: Option<std::ffi::OsString>,
) -> PathBuf {
    match local_app_data.filter(|value| !value.is_empty()) {
        Some(root) => PathBuf::from(root).join("LexMachina"),
        None => update_staging_root(temp),
    }
}

/// The last bytes of the runner's start log, one line, for the error shown to the user.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn start_log_tail(text: &str) -> String {
    let flat: String = text
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    let flat = flat.split_whitespace().collect::<Vec<_>>().join(" ");
    let start = flat
        .char_indices()
        .rev()
        .nth(399)
        .map(|(index, _)| index)
        .unwrap_or(0);
    flat[start..].to_string()
}

/// The plain form of a verbatim Windows path (`\\?\C:\x` -> `C:\x`, `\\?\UNC\s\x` ->
/// `\\s\x`): Tauri's resource directory comes verbatim, and Windows PowerShell 5.1 then has a
/// `$PSScriptRoot` its own `Join-Path` rejects; the update stopped before its first line.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn plain_windows_path(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        return PathBuf::from(rest);
    }
    path.to_path_buf()
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
    let root = workspace_open_root();
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

/// Why the local runtime did not start, the log to send, and whether a repair can run.
#[tauri::command]
fn runtime_start_status(bridge: tauri::State<'_, Arc<RuntimeBridge>>) -> serde_json::Value {
    serde_json::json!({
        "error": bridge.start_error(),
        "logPath": trust_boundary::runtime_log_path().map(|path| path.display().to_string()),
        "repairAvailable": cfg!(target_os = "macos")
    })
}

/// macOS: repair uses the same visible preparation window as first installation.
#[tauri::command]
fn runtime_repair(app: tauri::AppHandle, bridge: tauri::State<'_, Arc<RuntimeBridge>>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        bridge.shutdown()?;
        let state = Arc::clone(&app.state::<Arc<macos_setup::SetupState>>());
        macos_setup::start(app, state)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        let _ = bridge;
        Err("RUNTIME_REPAIR_PLATFORM_UNSUPPORTED".to_string())
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

// Odczyt ciasteczek okna sn.pl jako nagłówek Cookie. Async: na Windows odczyt WebView2
// w komendzie synchronicznej blokuje się (wry#583).
fn sn_cookie_header(app: &tauri::AppHandle) -> Result<String, String> {
    let window = app
        .get_webview_window(SN_VERIFICATION_LABEL)
        .ok_or_else(|| "SN_VERIFICATION_WINDOW_MISSING".to_string())?;
    let url = SN_VERIFICATION_URL
        .parse::<tauri::Url>()
        .map_err(|_| "SN_VERIFICATION_URL_INVALID".to_string())?;
    let cookies = window
        .cookies_for_url(url)
        .map_err(|_| "SN_VERIFICATION_COOKIES_FAILED".to_string())?;
    Ok(cookie_header(
        cookies.iter().map(|cookie| (cookie.name(), cookie.value())),
    ))
}

// Auto-„Gotowe”: odczyt ciasteczek BEZ zamykania okna — aplikacja sonduje nimi snproxy
// i dopiero po potwierdzeniu zamyka okno (sn_verification_close). Pusty wynik = brak sesji.
#[tauri::command]
async fn sn_verification_cookies(app: tauri::AppHandle) -> Result<String, String> {
    sn_cookie_header(&app)
}

// Ręczne „Gotowe”: odczyt ciasteczek i zamknięcie okna (zapas, gdy auto-sonda nie zdążyła).
#[tauri::command]
async fn sn_verification_finish(app: tauri::AppHandle) -> Result<String, String> {
    let header = sn_cookie_header(&app)?;
    if let Some(window) = app.get_webview_window(SN_VERIFICATION_LABEL) {
        let _ = window.close();
    }
    if header.is_empty() {
        return Err("SN_VERIFICATION_NO_COOKIES".to_string());
    }
    Ok(header)
}

// Zamknięcie okna sn.pl po udanej auto-sondzie (sesja już zapisana po stronie runtime).
#[tauri::command]
async fn sn_verification_close(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(SN_VERIFICATION_LABEL) {
        let _ = window.close();
    }
    Ok(())
}

// Weryfikacja wokandy sądu (jak sn.pl): użytkownik sam przechodzi weryfikację przeglądarki
// w oknie strony sądu; aplikacja odczytuje tylko ciasteczka tej sesji i przekazuje je runtime.
// Okno zostaje w domenie tego sądu (sądy powszechne: *.sa|so|sr.gov.pl); strona nie ma IPC.
const WOKANDA_VERIFICATION_LABEL: &str = "wokanda-verification";

fn court_host(host: &str) -> Option<String> {
    let bare = host.strip_prefix("www.").unwrap_or(host).to_ascii_lowercase();
    let mut parts = bare.rsplitn(4, '.');
    let (gov_pl_pl, gov, level, name) = (parts.next()?, parts.next()?, parts.next()?, parts.next()?);
    let valid_name = !name.is_empty()
        && name.len() <= 63
        && name.bytes().all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-');
    (gov_pl_pl == "pl" && gov == "gov" && matches!(level, "sa" | "so" | "sr") && valid_name).then_some(bare)
}

fn wokanda_court_url(raw: &str) -> Result<tauri::Url, String> {
    let url = raw
        .parse::<tauri::Url>()
        .map_err(|_| "WOKANDA_VERIFICATION_URL_INVALID".to_string())?;
    if url.scheme() != "https" || url.host_str().and_then(court_host).is_none() {
        return Err("WOKANDA_VERIFICATION_URL_INVALID".to_string());
    }
    Ok(url)
}

// `minimized`: the court's window opens minimized and unfocused (as the automatic sn.pl check):
// most courts' browser check passes on its own in a real browser engine; the window is shown
// (wokanda_verification_show) only when the user has to act.
#[tauri::command]
async fn wokanda_verification_open(
    app: tauri::AppHandle,
    url: String,
    minimized: Option<bool>,
) -> Result<(), String> {
    let target = wokanda_court_url(&url)?;
    let court = target.host_str().and_then(court_host).unwrap_or_default();
    if let Some(window) = app.get_webview_window(WOKANDA_VERIFICATION_LABEL) {
        let _ = window.close();
    }
    let quiet = minimized.unwrap_or(false);
    let window = tauri::WebviewWindowBuilder::new(
        &app,
        WOKANDA_VERIFICATION_LABEL,
        tauri::WebviewUrl::External(target),
    )
    .title("Weryfikacja wokandy sadu - przejdz weryfikacje, sprawdzenie ponowi sie samo")
    .inner_size(1000.0, 760.0)
    .focused(!quiet)
    .on_navigation(move |next| {
        next.scheme() == "https" && next.host_str().and_then(court_host).as_deref() == Some(court.as_str())
    })
    .build()
    .map_err(|error| format!("WOKANDA_VERIFICATION_WINDOW_FAILED:{error}"))?;
    if quiet {
        let _ = window.minimize();
    }
    Ok(())
}

// The minimized court window brought to the front: its check needs the user.
#[tauri::command]
async fn wokanda_verification_show(app: tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(WOKANDA_VERIFICATION_LABEL)
        .ok_or_else(|| "WOKANDA_VERIFICATION_WINDOW_MISSING".to_string())?;
    let _ = window.unminimize();
    window
        .set_focus()
        .map_err(|_| "WOKANDA_VERIFICATION_WINDOW_FAILED".to_string())
}

// Ciasteczka okna sądu dla adresu tego sądu, jako nagłówek Cookie (bez zamykania okna).
#[tauri::command]
async fn wokanda_verification_cookies(app: tauri::AppHandle, url: String) -> Result<String, String> {
    let target = wokanda_court_url(&url)?;
    let window = app
        .get_webview_window(WOKANDA_VERIFICATION_LABEL)
        .ok_or_else(|| "WOKANDA_VERIFICATION_WINDOW_MISSING".to_string())?;
    let cookies = window
        .cookies_for_url(target)
        .map_err(|_| "WOKANDA_VERIFICATION_COOKIES_FAILED".to_string())?;
    Ok(cookie_header(
        cookies.iter().map(|cookie| (cookie.name(), cookie.value())),
    ))
}

#[tauri::command]
async fn wokanda_verification_close(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(WOKANDA_VERIFICATION_LABEL) {
        let _ = window.close();
    }
    Ok(())
}

// Official law sources behind a bot check (as sn.pl and the courts' wokanda): the user passes the check
// in the source's own window; the application reads only that host's cookies. Closed list of hosts,
// kept in step with lex-runtime/src/eli/law-source-sessions.ts; the window stays on that host.
const LAW_SOURCE_VERIFICATION_LABEL: &str = "law-source-verification";
const LAW_SOURCE_HOSTS: &[&str] = &[
    "www.nysenate.gov",
    "nmonesource.com",
    "leginfo.legislature.ca.gov",
    "www.oscn.net",
    "www.capitol.hawaii.gov",
    // Google search on the user's session (consent page and captcha passed by the user).
    "www.google.com",
];

fn law_source_url(raw: &str) -> Result<(tauri::Url, &'static str), String> {
    let url = raw
        .parse::<tauri::Url>()
        .map_err(|_| "LAW_SOURCE_URL_INVALID".to_string())?;
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    let known = LAW_SOURCE_HOSTS
        .iter()
        .find(|item| host == **item || host == format!("www.{item}") || format!("www.{host}") == **item)
        .copied();
    match known {
        Some(item) if url.scheme() == "https" => Ok((url, item)),
        _ => Err("LAW_SOURCE_URL_INVALID".to_string()),
    }
}

fn law_source_same_site(next: &tauri::Url, item: &str) -> bool {
    let host = next.host_str().unwrap_or_default().to_ascii_lowercase();
    let bare = item.strip_prefix("www.").unwrap_or(item);
    next.scheme() == "https" && (host == bare || host.ends_with(&format!(".{bare}")))
}

#[tauri::command]
async fn law_source_verification_open(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let (target, item) = law_source_url(&url)?;
    if let Some(window) = app.get_webview_window(LAW_SOURCE_VERIFICATION_LABEL) {
        let _ = window.close();
    }
    tauri::WebviewWindowBuilder::new(
        &app,
        LAW_SOURCE_VERIFICATION_LABEL,
        tauri::WebviewUrl::External(target),
    )
    .title("Weryfikacja zrodla prawa - przejdz weryfikacje, pytanie ponowi sie samo")
    .inner_size(1000.0, 760.0)
    // The check's own pages load from other hosts inside the page; top-level navigation stays on the source.
    .on_navigation(move |next| law_source_same_site(next, item))
    .build()
    .map_err(|error| format!("LAW_SOURCE_VERIFICATION_WINDOW_FAILED:{error}"))?;
    Ok(())
}

// Cookies of the source's window for that source, as a Cookie header (the window stays open).
#[tauri::command]
async fn law_source_verification_cookies(app: tauri::AppHandle, url: String) -> Result<String, String> {
    let (target, _) = law_source_url(&url)?;
    let window = app
        .get_webview_window(LAW_SOURCE_VERIFICATION_LABEL)
        .ok_or_else(|| "LAW_SOURCE_VERIFICATION_WINDOW_MISSING".to_string())?;
    let cookies = window
        .cookies_for_url(target)
        .map_err(|_| "LAW_SOURCE_VERIFICATION_COOKIES_FAILED".to_string())?;
    Ok(cookie_header(
        cookies.iter().map(|cookie| (cookie.name(), cookie.value())),
    ))
}

#[tauri::command]
async fn law_source_verification_close(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(LAW_SOURCE_VERIFICATION_LABEL) {
        let _ = window.close();
    }
    Ok(())
}

#[tauri::command]
fn open_workspace_file(token: String) -> Result<(), String> {
    let target = authorized_workspace_open_path(&token)?;
    launch_default_handler(&target)
}

// macOS: the runtime staged a verified .pkg next to its receipt; the receipt names it and its
// SHA-256 (from the GitHub release digest). The file is hashed again before it is opened.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn pkg_from_receipt(staging: &Path, receipt_token: &str) -> Result<PathBuf, String> {
    use sha2::Digest;
    if !valid_update_receipt_token(receipt_token) {
        return Err("APPLICATION_UPDATE_RECEIPT_TOKEN_INVALID".to_string());
    }
    let receipt_path = staging.join(receipt_token);
    let receipt: serde_json::Value = std::fs::read_to_string(&receipt_path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .ok_or_else(|| "APPLICATION_UPDATE_RECEIPT_MISSING".to_string())?;
    let installer = receipt
        .get("installerToken")
        .and_then(|value| value.as_str())
        .unwrap_or_default();
    let expected = receipt
        .get("sha256")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    // The installer token is the receipt token with .pkg: nothing else in the folder is opened.
    if installer != receipt_token.replace(".json", ".pkg") || expected.len() != 64 {
        return Err("APPLICATION_UPDATE_RECEIPT_INVALID".to_string());
    }
    let package = staging.join(installer);
    use std::io::Read;
    let mut file = std::fs::File::open(&package)
        .map_err(|_| "APPLICATION_UPDATE_INSTALLER_MISSING".to_string())?;
    let mut hash = sha2::Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let count = file.read(&mut buffer).map_err(|_| "APPLICATION_UPDATE_INSTALLER_READ_FAILED".to_string())?;
        if count == 0 { break; }
        hash.update(&buffer[..count]);
    }
    let digest = hash.finalize();
    let actual: String = digest.iter().map(|byte| format!("{byte:02x}")).collect();
    if actual != expected {
        return Err("APPLICATION_UPDATE_SHA256_MISMATCH".to_string());
    }
    Ok(package)
}

#[tauri::command]
fn install_application_update(
    app: tauri::AppHandle,
    receipt_token: String,
) -> Result<(), String> {
    // macOS: the verified .pkg opens in the system Installer; the app closes so the installer
    // can replace it (the user confirms the steps of the installer).
    #[cfg(target_os = "macos")]
    {
        let package = pkg_from_receipt(&update_staging_root(env::var_os("TEMP")), &receipt_token)?;
        launch_default_handler(&package)?;
        app.exit(0);
        return Ok(());
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
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

        let receipt = update_staging_root(env::var_os("TEMP"))
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

        // The runner outlives this process (it waits for it to exit, installs and starts the
        // new version): its own hidden console, its own process group, out of any job the app
        // runs in (a job closed with the app would end the runner too, and the update with it).
        // Not DETACHED_PROCESS: powershell.exe without any console can end before the script's
        // first line (0.1.54 -> 0.1.55 left neither journal nor log).
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
        // The runner's own output goes to a start log: a PowerShell stopped before the script's
        // first line (execution policy set by Group Policy, an antivirus) left no trace at all.
        let log_dir = update_log_dir(env::var_os("LOCALAPPDATA"), env::var_os("TEMP"));
        let _ = std::fs::create_dir_all(&log_dir);
        let start_log = log_dir.join("update-runner-start.log");
        let mut log = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&start_log)
            .map_err(|error| format!("APPLICATION_UPDATE_START_LOG_FAILED:{error}"))?;
        {
            use std::io::Write;
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|value| value.as_secs())
                .unwrap_or(0);
            let _ = writeln!(
                log,
                "--- {now} start {} receipt {}",
                runner.display(),
                receipt_token
            );
        }
        let output = |log: &std::fs::File| -> Result<(std::process::Stdio, std::process::Stdio), String> {
            let out = log
                .try_clone()
                .map_err(|error| format!("APPLICATION_UPDATE_START_LOG_FAILED:{error}"))?;
            let err = log
                .try_clone()
                .map_err(|error| format!("APPLICATION_UPDATE_START_LOG_FAILED:{error}"))?;
            Ok((out.into(), err.into()))
        };
        let runner_command = |flags: u32, stdout: std::process::Stdio, stderr: std::process::Stdio| {
            let mut command = Command::new(&powershell);
            command
                .creation_flags(flags)
                .stdin(std::process::Stdio::null())
                .stdout(stdout)
                .stderr(stderr);
            command
        };
        let detached = CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP;
        let (stdout, stderr) = output(&log)?;
        let mut command = runner_command(detached | CREATE_BREAKAWAY_FROM_JOB, stdout, stderr);
        let mut child = match configure_runner(&mut command, &runner, &receipt, &runtime_root, &install_root, &executable).spawn() {
            Ok(child) => child,
            // A job that forbids breakaway: start it detached all the same.
            Err(_) => {
                let (stdout, stderr) = output(&log)?;
                let mut fallback = runner_command(detached, stdout, stderr);
                configure_runner(&mut fallback, &runner, &receipt, &runtime_root, &install_root, &executable)
                    .spawn()
                    .map_err(|error| format!("APPLICATION_UPDATE_RUNNER_START_FAILED:{error}"))?
            }
        };
        drop(log);

        // The runner waits for this process to exit before it does anything to the installation:
        // one that ended within seconds never ran the script. The app then stays open and says why.
        for _ in 0..30 {
            std::thread::sleep(std::time::Duration::from_millis(100));
            if let Ok(Some(status)) = child.try_wait() {
                let text = std::fs::read(&start_log)
                    .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
                    .unwrap_or_default();
                let last = text.rsplit("--- ").next().unwrap_or("");
                let detail = last.split_once('\n').map(|(_, rest)| rest).unwrap_or("");
                return Err(format!(
                    "APPLICATION_UPDATE_RUNNER_EXITED:{}:{}",
                    status.code().map(|code| code.to_string()).unwrap_or_else(|| "?".to_string()),
                    start_log_tail(detail)
                ));
            }
        }

        app.exit(0);
        Ok(())
    }
}

#[cfg(target_os = "windows")]
fn configure_runner<'a>(
    command: &'a mut Command,
    runner: &Path,
    receipt: &Path,
    runtime_root: &Path,
    install_root: &Path,
    executable: &Path,
) -> &'a mut Command {
    command
        .arg("-NoProfile")
        .arg("-NonInteractive")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-WindowStyle")
        .arg("Hidden")
        .arg("-File")
        .arg(plain_windows_path(runner))
        .arg("-ReceiptPath")
        .arg(plain_windows_path(receipt))
        .arg("-RuntimeRoot")
        .arg(plain_windows_path(runtime_root))
        .arg("-InstallRoot")
        .arg(plain_windows_path(install_root))
        .arg("-AppExecutable")
        .arg(plain_windows_path(executable))
        .arg("-ParentPid")
        .arg(std::process::id().to_string())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn component_setup_status() -> serde_json::Value { serde_json::json!({"phase": "unneeded"}) }
#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn component_setup_start() -> Result<(), String> { Err("SETUP_PLATFORM_UNSUPPORTED".into()) }
#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn component_setup_finish() -> Result<(), String> { Err("SETUP_PLATFORM_UNSUPPORTED".into()) }

pub fn run() {
    let bridge = Arc::new(
        RuntimeBridge::new()
            .expect("failed to initialize desktop trust boundary")
    );
    let protocol_bridge = Arc::clone(&bridge);
    let setup_bridge = Arc::clone(&bridge);
    let status_bridge = Arc::clone(&bridge);
    let exit_bridge = Arc::clone(&bridge);

    let app = tauri::Builder::default()
        .manage(status_bridge)
        .invoke_handler(
            tauri::generate_handler![
                open_external_url,
                open_workspace_file,
                install_application_update,
                sn_verification_open,
                sn_verification_cookies,
                sn_verification_finish,
                sn_verification_close,
                wokanda_verification_open,
                wokanda_verification_cookies,
                wokanda_verification_close,
                wokanda_verification_show,
                law_source_verification_open,
                law_source_verification_cookies,
                law_source_verification_close,
                runtime_start_status,
                runtime_repair,
                component_setup_status,
                component_setup_start,
                component_setup_finish
            ]
        )
        .register_asynchronous_uri_scheme_protocol(
            "lex-api",
            move |context, request, responder| {
                // Schemat jest rejestrowany dla wszystkich webview aplikacji, także dla
                // okna sn.pl (zewnętrzna strona). API z sesją użytkownika tylko dla okna głównego.
                if context.webview_label() != trust_boundary::MAIN_WEBVIEW_LABEL {
                    responder.respond(trust_boundary::foreign_webview_response());
                    return;
                }
                let bridge = Arc::clone(&protocol_bridge);
                std::thread::spawn(move || {
                    responder.respond(
                        bridge.handle(request)
                    );
                });
            },
        )
        .setup(move |app| {
            let resource_dir = app.path().resource_dir()?;
            #[cfg(target_os = "macos")]
            {
                app.manage(Arc::new(macos_setup::SetupState::default()));
                if macos_setup::needed(&resource_dir) {
                    // The .pkg opens the app before the components exist; they may then be prepared
                    // outside this window (a headless bootstrap, a terminal). A second "open" only
                    // brings this instance forward, so it starts the runtime itself once they are ready.
                    let bridge = Arc::clone(&setup_bridge);
                    let resources = resource_dir.clone();
                    std::thread::spawn(move || {
                        while !macos_setup::ready(&resources) {
                            std::thread::sleep(std::time::Duration::from_secs(2));
                        }
                        let started = bridge
                            .start(&resources)
                            .and_then(|_| bridge.ensure_managed_identity().map(|_| ()));
                        if let Err(error) = started {
                            bridge.record_start_error(error);
                        }
                    });
                    return Ok(());
                }
            }
            // A runtime that does not start (macOS: components missing for this user,
            // a failed bootstrap) is reported on the sign-in screen with its log, not
            // a crash: Tauri closed the app at launch without a word.
            let started = setup_bridge
                .start(&resource_dir)
                .and_then(|_| setup_bridge.ensure_managed_identity().map(|_| ()));
            if let Err(error) = started {
                setup_bridge.record_start_error(error);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Lex Machina desktop");

    app.run(move |_app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            #[cfg(target_os = "macos")]
            macos_setup::stop(&_app_handle.state::<Arc<macos_setup::SetupState>>());
            let _ = exit_bridge.shutdown();
            wipe_workspace_open_copies(&workspace_open_root());
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{
        cookie_header,
        court_host,
        law_source_same_site,
        law_source_url,
        is_allowed_external_url,
        is_sn_url,
        pkg_from_receipt,
        plain_windows_path,
        start_log_tail,
        update_log_dir,
        update_staging_root,
        valid_update_receipt_token,
        valid_workspace_open_token,
        wokanda_court_url,
    };
    use std::path::{Path, PathBuf};

    #[test]
    fn pkg_from_receipt_opens_only_the_hashed_package_named_by_the_receipt() {
        let staging = std::env::temp_dir().join(format!("lex-pkg-test-{}", std::process::id()));
        std::fs::create_dir_all(&staging).unwrap();
        let token = "update_0-1-47_0123456789abcdef.json";
        std::fs::write(staging.join("update_0-1-47_0123456789abcdef.pkg"), b"pkg").unwrap();
        // A digest other than the file's.
        let sha = "2a3c4b3ad5c4ec8a6dc4ab8d3f1f2e2fcc4a8dd16b1a5d3ae2cbff1e6a63c8a7";
        let receipt = |installer: &str, digest: &str| {
            std::fs::write(
                staging.join(token),
                format!("{{\"installerToken\":\"{installer}\",\"sha256\":\"{digest}\"}}"),
            )
            .unwrap();
        };
        let real = {
            use sha2::Digest;
            sha2::Sha256::digest(b"pkg").iter().map(|b| format!("{b:02x}")).collect::<String>()
        };
        receipt("update_0-1-47_0123456789abcdef.pkg", &real);
        assert!(pkg_from_receipt(&staging, token).unwrap().ends_with("update_0-1-47_0123456789abcdef.pkg"));
        receipt("update_0-1-47_0123456789abcdef.pkg", sha);
        assert_eq!(pkg_from_receipt(&staging, token).unwrap_err(), "APPLICATION_UPDATE_SHA256_MISMATCH");
        receipt("../other.pkg", &real);
        assert_eq!(pkg_from_receipt(&staging, token).unwrap_err(), "APPLICATION_UPDATE_RECEIPT_INVALID");
        assert_eq!(pkg_from_receipt(&staging, "../x.json").unwrap_err(), "APPLICATION_UPDATE_RECEIPT_TOKEN_INVALID");
        std::fs::remove_dir_all(&staging).unwrap();
    }

    #[test]
    fn plain_windows_path_drops_the_verbatim_prefix() {
        assert_eq!(
            plain_windows_path(Path::new(r"\\?\C:\Users\Mi\AppData\Local\Lex Machina\runtime\bootstrap\x.ps1")),
            PathBuf::from(r"C:\Users\Mi\AppData\Local\Lex Machina\runtime\bootstrap\x.ps1")
        );
        assert_eq!(plain_windows_path(Path::new(r"\\?\UNC\srv\share\a")), PathBuf::from(r"\\srv\share\a"));
        assert_eq!(plain_windows_path(Path::new(r"C:\plain")), PathBuf::from(r"C:\plain"));
    }

    #[test]
    fn update_log_dir_matches_the_runner_journal() {
        let local = std::env::temp_dir().join("lex-local-app-data");
        assert_eq!(
            update_log_dir(Some(local.clone().into_os_string()), None),
            local.join("LexMachina")
        );
        let temp = std::env::temp_dir().join("lex-temp-variable");
        assert_eq!(
            update_log_dir(None, Some(temp.clone().into_os_string())),
            temp.join("LexMachinaUpdate")
        );
    }

    #[test]
    fn start_log_tail_is_one_line_of_the_last_400_characters() {
        assert_eq!(start_log_tail("a\r\nb\tc  "), "a b c");
        let long = "ż".repeat(1000);
        assert_eq!(start_log_tail(&long).chars().count(), 400);
    }

    #[test]
    fn update_staging_root_prefers_temp_like_runtime_and_runner() {
        let temp = std::env::temp_dir().join("lex-temp-variable");
        assert_eq!(
            update_staging_root(Some(temp.clone().into_os_string())),
            temp.join("LexMachinaUpdate")
        );
        assert_eq!(
            update_staging_root(Some(std::ffi::OsString::new())),
            std::env::temp_dir().join("LexMachinaUpdate")
        );
        assert_eq!(
            update_staging_root(None),
            std::env::temp_dir().join("LexMachinaUpdate")
        );
    }

    #[test]
    fn external_url_requires_https() {
        assert!(is_allowed_external_url("https://example.com/path"));
        assert!(!is_allowed_external_url("http://example.com"));
        assert!(!is_allowed_external_url("file:///C:/secret.txt"));
        assert!(!is_allowed_external_url("https://example.com\r\nX-Test: 1"));
    }

    #[test]
    fn law_source_verification_only_for_listed_sources() {
        assert!(law_source_url("https://www.nysenate.gov/legislation/laws/PEN/125.27").is_ok());
        assert!(law_source_url("https://nmonesource.com/nmos/nmsa/en/nav_date.do").is_ok());
        assert!(law_source_url("https://leginfo.legislature.ca.gov/faces/codes.xhtml").is_ok());
        assert!(law_source_url("https://www.oscn.net/applications/oscn/index.asp").is_ok());
        assert!(law_source_url("https://www.capitol.hawaii.gov/docs/HRS.htm").is_ok());
        assert!(law_source_url("http://www.nysenate.gov/").is_err());
        assert!(law_source_url("https://evil.example/").is_err());
        assert!(law_source_url("https://www.google.com/search?q=kodeks+karny&hl=pl").is_ok());
        assert!(law_source_url("https://www.google.evil.example/").is_err());
        assert!(law_source_url("https://nysenate.gov.evil.example/").is_err());
        let (_, item) = law_source_url("https://www.nysenate.gov/").unwrap();
        assert!(law_source_same_site(&"https://www.nysenate.gov/legislation".parse().unwrap(), item));
        assert!(!law_source_same_site(&"https://example.com/".parse().unwrap(), item));
    }

    #[test]
    fn wokanda_verification_stays_on_a_common_court() {
        assert_eq!(court_host("www.krakow.so.gov.pl").as_deref(), Some("krakow.so.gov.pl"));
        assert_eq!(court_host("bielsko-biala.sr.gov.pl").as_deref(), Some("bielsko-biala.sr.gov.pl"));
        assert!(court_host("krakow.so.gov.pl.example.com").is_none());
        assert!(court_host("so.gov.pl").is_none());
        assert!(court_host("evil.gov.pl").is_none());
        assert!(wokanda_court_url("https://olsztyn.so.gov.pl/wokanda").is_ok());
        assert!(wokanda_court_url("http://olsztyn.so.gov.pl/wokanda").is_err());
        assert!(wokanda_court_url("https://www.sn.pl/").is_err());
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
        assert!(!valid_workspace_open_token(
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
    fn workspace_open_token_never_launches_executables() {
        for extension in ["exe", "bat", "cmd", "hta", "command", "app", "js", "vbs", "docm", "lnk"] {
            assert!(!valid_workspace_open_token(&format!(
                "open_0123456789abcdef0123456789abcdef.{extension}"
            )));
        }
        assert!(valid_workspace_open_token(
            "open_0123456789abcdef0123456789abcdef.docx"
        ));
    }

    #[test]
    fn exit_wipes_only_open_copies() {
        let root = std::env::temp_dir().join(format!("lex-open-wipe-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("open_0123456789abcdef0123456789abcdef.pdf"), b"x").unwrap();
        std::fs::write(root.join("inny.txt"), b"y").unwrap();
        super::wipe_workspace_open_copies(&root);
        assert!(!root.join("open_0123456789abcdef0123456789abcdef.pdf").exists());
        assert!(root.join("inny.txt").exists());
        let _ = std::fs::remove_dir_all(&root);
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
