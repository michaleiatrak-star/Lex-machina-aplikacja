use sha2::{Digest, Sha256};
use std::{
    env,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, ExitCode, Stdio},
};

fn required_file(path: PathBuf, code: &str) -> Result<PathBuf, String> {
    if path.is_file() { Ok(path) } else { Err(format!("{code}:{}", path.display())) }
}

fn required_dir(path: PathBuf, code: &str) -> Result<PathBuf, String> {
    if path.is_dir() { Ok(path) } else { Err(format!("{code}:{}", path.display())) }
}

fn runtime_root() -> Result<PathBuf, String> {
    let executable = env::current_exe()
        .map_err(|error| format!("SIDECAR_CURRENT_EXE_FAILED:{error}"))?;
    executable.parent().map(Path::to_path_buf)
        .ok_or_else(|| "SIDECAR_RUNTIME_ROOT_MISSING".to_string())
}

/// Downloaded components (node, python, models, component lock). On Windows they
/// live next to the code in the install directory; on macOS the code is inside
/// the signed app bundle, so the online bootstrap puts them in the user's
/// Application Support directory instead.
fn components_root(code_root: &Path) -> PathBuf {
    if let Some(configured) = env::var_os("LEX_COMPONENTS_ROOT") {
        return PathBuf::from(configured);
    }
    #[cfg(target_os = "macos")]
    {
        if let Some(home) = env::var_os("HOME") {
            return PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join("LexMachina")
                .join("runtime");
        }
    }
    code_root.to_path_buf()
}

#[cfg(windows)]
fn node_executable(components: &Path) -> PathBuf { components.join("node").join("node.exe") }
#[cfg(not(windows))]
fn node_executable(components: &Path) -> PathBuf { components.join("node").join("bin").join("node") }

#[cfg(windows)]
fn npm_executable(components: &Path) -> PathBuf { components.join("node").join("npm.cmd") }
#[cfg(not(windows))]
fn npm_executable(components: &Path) -> PathBuf { components.join("node").join("bin").join("npm") }

#[cfg(windows)]
fn python_executable(components: &Path) -> PathBuf { components.join("python").join("python.exe") }
#[cfg(not(windows))]
fn python_executable(components: &Path) -> PathBuf { components.join("python").join("bin").join("python3") }

#[cfg(windows)]
fn uvx_executable(components: &Path) -> PathBuf { components.join("python").join("Scripts").join("uvx.exe") }
#[cfg(not(windows))]
fn uvx_executable(components: &Path) -> PathBuf { components.join("python").join("bin").join("uvx") }

#[cfg(windows)]
fn runtime_search_path(components: &Path) -> Vec<PathBuf> {
    vec![components.join("node"), components.join("python").join("Scripts"), components.join("python")]
}
#[cfg(not(windows))]
fn runtime_search_path(components: &Path) -> Vec<PathBuf> {
    vec![components.join("node").join("bin"), components.join("python").join("bin")]
}

#[cfg(windows)]
const SIDECAR_FILE: &str = "lex-runtime-sidecar.exe";
#[cfg(not(windows))]
const SIDECAR_FILE: &str = "lex-runtime-sidecar";

// Component-lock paths under these roots belong to the downloaded components;
// the others (app, corpus, workers, sidecar) to the code root.
const COMPONENT_DIRS: [&str; 3] = ["node", "python", "models"];

fn safe_relative_path(code_root: &Path, components: &Path, relative: &str) -> Result<PathBuf, String> {
    if relative.is_empty() || relative.starts_with('/') || relative.starts_with('\\') || relative.contains(':') {
        return Err("SIDECAR_LOCK_PATH_INVALID".to_string());
    }
    let parts: Vec<&str> = relative.split(['/', '\\']).collect();
    if parts.iter().any(|part| part.is_empty() || *part == "." || *part == "..") {
        return Err("SIDECAR_LOCK_PATH_INVALID".to_string());
    }
    let base = if COMPONENT_DIRS.contains(&parts[0]) { components } else { code_root };
    Ok(parts.iter().fold(base.to_path_buf(), |path, part| path.join(part)))
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path)
        .map_err(|error| format!("SIDECAR_HASH_OPEN_FAILED:{error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)
            .map_err(|error| format!("SIDECAR_HASH_READ_FAILED:{error}"))?;
        if read == 0 { break; }
        hasher.update(&buffer[..read]);
    }
    buffer.fill(0);
    Ok(format!("{:x}", hasher.finalize()))
}

fn validate_component_lock(root: &Path, components_dir: &Path) -> Result<usize, String> {
    let lock_path = required_file(components_dir.join("component-lock.json"), "SIDECAR_COMPONENT_LOCK_MISSING")?;
    let raw = fs::read(&lock_path)
        .map_err(|error| format!("SIDECAR_COMPONENT_LOCK_READ_FAILED:{error}"))?;
    let lock: serde_json::Value = serde_json::from_slice(&raw)
        .map_err(|error| format!("SIDECAR_COMPONENT_LOCK_INVALID:{error}"))?;

    if lock.get("networkRequiredAtInstall").and_then(|value| value.as_bool()).is_none() {
        return Err("SIDECAR_COMPONENT_LOCK_INSTALL_NETWORK_POLICY".to_string());
    }
    if lock.get("runtimeNetworkRequiredAfterBootstrap").and_then(|value| value.as_bool()) != Some(false) {
        return Err("SIDECAR_COMPONENT_LOCK_RUNTIME_NETWORK_POLICY".to_string());
    }
    if lock.get("expectedUserActionAfterInstall").and_then(|value| value.as_str())
        != Some("PROVIDER_API_KEY_OR_OPTIONAL_LOCAL_AI_SETUP")
    {
        return Err("SIDECAR_COMPONENT_LOCK_USER_ACTION_POLICY".to_string());
    }
    if lock
        .get("localAi")
        .and_then(|value| value.get("requiredForApplicationHealth"))
        .and_then(|value| value.as_bool())
        != Some(false)
    {
        return Err("SIDECAR_COMPONENT_LOCK_LOCAL_AI_POLICY".to_string());
    }

    let required_ids = [
        "node-runtime", "python-runtime", "lex-runtime", "legal-corpus",
        "paddle-ocr-pl", "stanza-pl-ner", "runtime-sidecar",
    ];
    let components = lock.get("components").and_then(|value| value.as_array())
        .ok_or_else(|| "SIDECAR_COMPONENT_LOCK_COMPONENTS_INVALID".to_string())?;
    for required in required_ids {
        let present = components.iter().any(|component| {
            component.get("id").and_then(|value| value.as_str()) == Some(required)
                && component.get("required").and_then(|value| value.as_bool()) == Some(true)
        });
        if !present {
            return Err(format!("SIDECAR_COMPONENT_LOCK_REQUIRED_MISSING:{required}"));
        }
    }

    let files = lock.get("files").and_then(|value| value.as_array())
        .ok_or_else(|| "SIDECAR_COMPONENT_LOCK_FILES_INVALID".to_string())?;
    let mut verified = 0_usize;
    for entry in files {
        let relative = entry.get("path").and_then(|value| value.as_str())
            .ok_or_else(|| "SIDECAR_COMPONENT_LOCK_FILE_PATH_INVALID".to_string())?;
        let expected = entry.get("sha256").and_then(|value| value.as_str())
            .ok_or_else(|| "SIDECAR_COMPONENT_LOCK_FILE_HASH_INVALID".to_string())?;
        if expected.len() != 64 || !expected.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err("SIDECAR_COMPONENT_LOCK_FILE_HASH_INVALID".to_string());
        }
        let path = safe_relative_path(root, components_dir, relative)?;
        if !path.is_file() {
            return Err(format!("SIDECAR_COMPONENT_FILE_MISSING:{relative}"));
        }
        let actual = sha256_file(&path)?;
        if !actual.eq_ignore_ascii_case(expected) {
            return Err(format!("SIDECAR_COMPONENT_HASH_MISMATCH:{relative}"));
        }
        verified += 1;
    }
    Ok(verified)
}

fn installed_skill_overlay() -> Option<PathBuf> {
    // Same location as the runtime's localAppDataRoot(): %LOCALAPPDATA%\LexMachina
    // on Windows, ~/.lex-machina elsewhere.
    let base = match env::var_os("LOCALAPPDATA") {
        Some(local) => PathBuf::from(local).join("LexMachina"),
        None => PathBuf::from(env::var_os("HOME")?).join(".lex-machina"),
    };
    let root = base.join("skills").join("current");
    if root.join(".lex-skills-version.json").is_file() && root.is_dir() {
        Some(root)
    } else {
        None
    }
}

fn self_test(root: &Path) -> Result<(), String> {
    let components = components_root(root);
    required_file(node_executable(&components), "SIDECAR_NODE_MISSING")?;
    required_file(root.join("app").join("dist").join("http").join("server.js"), "SIDECAR_SERVER_MISSING")?;
    required_file(python_executable(&components), "SIDECAR_PYTHON_MISSING")?;
    required_file(uvx_executable(&components), "SIDECAR_UVX_MISSING")?;
    required_file(root.join(SIDECAR_FILE), "SIDECAR_EXECUTABLE_MISSING")?;
    required_dir(root.join("corpus"), "SIDECAR_CORPUS_MISSING")?;
    required_dir(components.join("models").join("paddle").join("official_models"), "SIDECAR_PADDLE_MODELS_MISSING")?;
    required_dir(components.join("models").join("stanza").join("pl"), "SIDECAR_STANZA_MODELS_MISSING")?;

    let verified_files = validate_component_lock(root, &components)?;
    println!("{}", serde_json::json!({
        "gate": "G33_PAYLOAD_NATIVE_SELF_TEST",
        "result": "PASS",
        "verifiedFiles": verified_files,
        "runtimeNetworkRequiredAfterBootstrap": false,
        "expectedUserActionAfterInstall": "PROVIDER_API_KEY_OR_OPTIONAL_LOCAL_AI_SETUP",
        "localAiRequiredForApplicationHealth": false,
        "accountSessionClientsBundled": false
    }));
    Ok(())
}

fn run_runtime(root: &Path) -> Result<i32, String> {
    let components = components_root(root);
    let node = required_file(node_executable(&components), "SIDECAR_NODE_MISSING")?;
    let server = required_file(root.join("app").join("dist").join("http").join("server.js"), "SIDECAR_SERVER_MISSING")?;
    let python = required_file(python_executable(&components), "SIDECAR_PYTHON_MISSING")?;
    let uvx = required_file(uvx_executable(&components), "SIDECAR_UVX_MISSING")?;
    let inherited_path = env::var_os("PATH").unwrap_or_default();
    let mut runtime_paths = runtime_search_path(&components);
    runtime_paths.extend(env::split_paths(&inherited_path));
    let runtime_path = env::join_paths(runtime_paths)
        .map_err(|error| format!("SIDECAR_PATH_BUILD_FAILED:{error}"))?;
    let bundled_corpus = required_dir(root.join("corpus"), "SIDECAR_CORPUS_MISSING")?;
    let skills = installed_skill_overlay().unwrap_or(bundled_corpus);
    let paddle = required_dir(components.join("models").join("paddle"), "SIDECAR_PADDLE_MODELS_MISSING")?;
    let paddle_official = required_dir(paddle.join("official_models"), "SIDECAR_PADDLE_OFFICIAL_MODELS_MISSING")?;
    let stanza = required_dir(components.join("models").join("stanza"), "SIDECAR_STANZA_MODELS_MISSING")?;

    let mut command = Command::new(node);
    command
        .arg(server)
        .current_dir(root.join("app"))
        .env("LEX_RUNTIME_ROOT", root)
        .env("LEX_SKILLS_PATH", skills)
        .env("LEX_OCR_PYTHON", &python)
        .env("LEX_NER_PYTHON", &python)
        .env("LEX_STORAGE_PYTHON", &python)
        .env("LEX_LEGAL_MCP_UVX", &uvx)
        // Account-session clients are provisioned with the private npm.
        .env("LEX_NPM_CLI", npm_executable(&components))
        .env("PATH", runtime_path)
        .env("PADDLE_PDX_CACHE_HOME", &paddle)
        .env("LEX_PADDLE_MODEL_DIR", &paddle_official)
        .env("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
        .env("STANZA_RESOURCES_DIR", stanza)
        .env("PYTHONNOUSERSITE", "1")
        .env("PYTHONUTF8", "1")
        // Never rewrite locked __pycache__ files of the private runtime.
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());

    // macOS/Linux: node replaces this process, so it is the desktop app's own child
    // and ends with it. A spawned node outlived the app there (only this sidecar was
    // killed), leaving node and its Python workers running after every quit.
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        let error = command.exec();
        Err(format!("SIDECAR_NODE_START_FAILED:{error}"))
    }
    // Windows: taskkill /T ends the whole tree, so the sidecar may wait for node.
    #[cfg(not(unix))]
    {
        let status = command
            .status()
            .map_err(|error| format!("SIDECAR_NODE_START_FAILED:{error}"))?;
        Ok(status.code().unwrap_or(1))
    }
}

fn run() -> Result<i32, String> {
    let root = runtime_root()?;
    if env::args().skip(1).any(|arg| arg == "--self-test") {
        self_test(&root)?;
        return Ok(0);
    }
    run_runtime(&root)
}

fn main() -> ExitCode {
    match run() {
        Ok(code) => ExitCode::from(u8::try_from(code.clamp(0, 255)).unwrap_or(1)),
        Err(error) => {
            let _ = writeln!(std::io::stderr(), "{error}");
            ExitCode::FAILURE
        }
    }
}
