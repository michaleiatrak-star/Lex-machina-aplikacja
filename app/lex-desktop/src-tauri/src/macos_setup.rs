//! Preparation runs before the runtime, so its UI also works on a clean Mac.
use std::{path::Path, sync::{Arc, Mutex, atomic::{AtomicI32, Ordering}}, process::{Command, Stdio}};
use tauri::Manager;

#[derive(Default)]
pub struct SetupState {
    phase: Mutex<String>,
    pid: AtomicI32,
}
fn root() -> std::path::PathBuf {
    std::env::var_os("HOME").map(std::path::PathBuf::from).unwrap_or_default()
        .join("Library/Application Support/LexMachina/runtime")
}
fn read(path: &Path) -> serde_json::Value {
    std::fs::read(path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or(serde_json::Value::Null)
}
pub fn needed(resource: &Path) -> bool { needed_at(resource, &root()) }
fn needed_at(resource: &Path, components: &Path) -> bool {
    let code = resource.join("runtime");
    if !code.join("bootstrap/macos-online-bootstrap.sh").is_file() { return false; }
    let manifest = read(&code.join("release-source.json"));
    let lock = read(&components.join("component-lock.json"));
    manifest["applicationVersion"].as_str().is_none()
        || manifest["applicationVersion"] != lock["applicationVersion"]
        || !components.join("node/bin/node").is_file()
        || !components.join("python/bin/python3").is_file()
}
#[tauri::command]
pub fn component_setup_status(app: tauri::AppHandle, state: tauri::State<'_, Arc<SetupState>>) -> serde_json::Value {
    let phase = state.phase.lock().unwrap().clone();
    let required = app.path().resource_dir().map(|p| needed(&p)).unwrap_or(true);
    let phase = if phase.is_empty() { if required { "pending" } else { "unneeded" } } else { &phase };
    let progress = if phase == "running" { read(&root().join("setup-progress.json")) } else { serde_json::Value::Null };
    serde_json::json!({"phase": phase, "progress": progress})
}
pub fn start(app: tauri::AppHandle, state: Arc<SetupState>) -> Result<(), String> {
    let code = app.path().resource_dir().map_err(|e| e.to_string())?.join("runtime");
    let mut phase = state.phase.lock().map_err(|_| "SETUP_STATE_FAILED")?;
    if *phase == "running" { return Ok(()); }
    std::fs::create_dir_all(root()).map_err(|e| e.to_string())?;
    let log = std::fs::File::create(root().join("setup.log")).map_err(|e| e.to_string())?;
    let err = log.try_clone().map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(root().join("setup-progress.json"));
    use std::os::unix::process::CommandExt;
    let mut child = Command::new("/bin/bash")
        .arg(code.join("bootstrap/macos-online-bootstrap.sh")).arg(&code).arg(root())
        .process_group(0).stdin(Stdio::null()).stdout(log).stderr(err)
        .spawn().map_err(|e| e.to_string())?;
    state.pid.store(child.id() as i32, Ordering::SeqCst);
    *phase = "running".into();
    drop(phase);
    std::thread::spawn(move || {
        let success = child.wait().is_ok_and(|s| s.success());
        state.pid.store(0, Ordering::SeqCst);
        *state.phase.lock().unwrap() = if success { "done" } else { "failed" }.into();
    });
    Ok(())
}
#[tauri::command]
pub fn component_setup_start(app: tauri::AppHandle, state: tauri::State<'_, Arc<SetupState>>) -> Result<(), String> {
    start(app, Arc::clone(&state))
}
#[tauri::command]
pub fn component_setup_finish(app: tauri::AppHandle, state: tauri::State<'_, Arc<SetupState>>) -> Result<(), String> {
    if *state.phase.lock().map_err(|_| "SETUP_STATE_FAILED")? != "done" { return Err("SETUP_NOT_READY".into()); }
    app.restart();
}
pub fn stop(state: &SetupState) {
    let pid = state.pid.load(Ordering::SeqCst);
    if pid > 0 { let _ = Command::new("/bin/kill").args(["-TERM", "--", &format!("-{pid}")]).status(); }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preparation_is_required_for_new_missing_or_changed_components() {
        let base = std::env::temp_dir().join(format!("lex-setup-native-{}", std::process::id()));
        let resource = base.join("resources");
        let components = base.join("components");
        std::fs::create_dir_all(resource.join("runtime/bootstrap")).unwrap();
        std::fs::write(resource.join("runtime/bootstrap/macos-online-bootstrap.sh"), "").unwrap();
        std::fs::write(resource.join("runtime/release-source.json"), r#"{"applicationVersion":"0.1.70"}"#).unwrap();
        assert!(needed_at(&resource, &components));
        std::fs::create_dir_all(components.join("node/bin")).unwrap();
        std::fs::create_dir_all(components.join("python/bin")).unwrap();
        std::fs::write(components.join("node/bin/node"), "").unwrap();
        std::fs::write(components.join("python/bin/python3"), "").unwrap();
        std::fs::write(components.join("component-lock.json"), r#"{"applicationVersion":"0.1.69"}"#).unwrap();
        assert!(needed_at(&resource, &components));
        std::fs::write(components.join("component-lock.json"), r#"{"applicationVersion":"0.1.70"}"#).unwrap();
        assert!(!needed_at(&resource, &components));
        std::fs::remove_file(components.join("node/bin/node")).unwrap();
        assert!(needed_at(&resource, &components));
        std::fs::remove_dir_all(base).unwrap();
    }
}
