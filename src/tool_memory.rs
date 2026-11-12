use serde::Serialize;
use std::path::{Path, PathBuf};

const MAX_MEMORY_BYTES: u64 = 512 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolMemoryDocument {
    pub tool_id: String,
    pub supported: bool,
    pub exists: bool,
    pub path: String,
    pub file_name: String,
    pub content: String,
}

#[tauri::command]
pub async fn read_tool_memory(tool_id: String) -> Result<ToolMemoryDocument, String> {
    tokio::task::spawn_blocking(move || read_tool_memory_sync(&tool_id))
        .await
        .map_err(|e| format!("Failed to read tool memory: {e}"))?
}

#[tauri::command]
pub async fn write_tool_memory(
    tool_id: String,
    content: String,
) -> Result<ToolMemoryDocument, String> {
    tokio::task::spawn_blocking(move || save_tool_memory_sync(&tool_id, &content))
        .await
        .map_err(|e| format!("Failed to save tool memory: {e}"))?
}

fn read_tool_memory_sync(tool_id: &str) -> Result<ToolMemoryDocument, String> {
    let Some(spec) = memory_spec(tool_id)? else {
        return Ok(unsupported_doc(tool_id));
    };

    if !spec.path.exists() {
        return Ok(ToolMemoryDocument {
            tool_id: tool_id.to_string(),
            supported: true,
            exists: false,
            path: display_path(&spec.path),
            file_name: spec.file_name.to_string(),
            content: String::new(),
        });
    }

    let meta = std::fs::symlink_metadata(&spec.path)
        .map_err(|e| format!("Failed to inspect {}: {e}", display_path(&spec.path)))?;
    if meta.file_type().is_symlink() {
        return Err("Refusing to read a symlinked memory file".to_string());
    }
    if !meta.is_file() {
        return Err("Memory path is not a regular file".to_string());
    }
    if meta.len() > MAX_MEMORY_BYTES {
        return Err("Memory file exceeds the 512 KB editor limit".to_string());
    }

    let content = std::fs::read_to_string(&spec.path)
        .map_err(|e| format!("Failed to read {}: {e}", display_path(&spec.path)))?;
    Ok(ToolMemoryDocument {
        tool_id: tool_id.to_string(),
        supported: true,
        exists: true,
        path: display_path(&spec.path),
        file_name: spec.file_name.to_string(),
        content,
    })
}

fn save_tool_memory_sync(tool_id: &str, content: &str) -> Result<ToolMemoryDocument, String> {
    if content.len() as u64 > MAX_MEMORY_BYTES {
        return Err("Memory content exceeds the 512 KB editor limit".to_string());
    }
    let Some(spec) = memory_spec(tool_id)? else {
        return Err(format!("{tool_id} does not expose a global memory file"));
    };

    ensure_safe_parent(&spec.root)?;
    if let Ok(meta) = std::fs::symlink_metadata(&spec.path) {
        if meta.file_type().is_symlink() {
            return Err("Refusing to overwrite a symlinked memory file".to_string());
        }
        if !meta.is_file() {
            return Err("Memory path is not a regular file".to_string());
        }
    }

    write_atomic(&spec.path, content.as_bytes())?;
    read_tool_memory_sync(tool_id)
}

struct MemorySpec {
    root: PathBuf,
    path: PathBuf,
    file_name: &'static str,
}

fn memory_spec(tool_id: &str) -> Result<Option<MemorySpec>, String> {
    let home = dirs::home_dir().ok_or_else(|| "Home directory is unavailable".to_string())?;
    let spec = match tool_id {
        "claude" => (root("CLAUDE_CONFIG_DIR", home.join(".claude")), "CLAUDE.md"),
        "codex" => (root("CODEX_HOME", home.join(".codex")), "AGENTS.md"),
        "copilot" => (root("COPILOT_HOME", home.join(".copilot")), "copilot-instructions.md"),
        "opencode" => (opencode_config_root(&home), "AGENTS.md"),
        "pi" => (root("PI_CODING_AGENT_DIR", home.join(".pi/agent")), "AGENTS.md"),
        "omp" => (root("PI_CODING_AGENT_DIR", home.join(".omp/agent")), "AGENTS.md"),
        "hermes" => (root("HERMES_HOME", home.join(".hermes")).join("memories"), "USER.md"),
        "antigravity" => (home.join(".gemini"), "GEMINI.md"),
        "kimicode" => (home.join(".kimi"), "AGENTS.md"),
        _ => return Ok(None),
    };
    let path = spec.0.join(spec.1);
    Ok(Some(MemorySpec {
        root: spec.0,
        path,
        file_name: spec.1,
    }))
}

fn root(env_key: &str, fallback: PathBuf) -> PathBuf {
    std::env::var_os(env_key)
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .unwrap_or(fallback)
}

fn opencode_config_root(home: &Path) -> PathBuf {
    if let Some(dir) = std::env::var_os("OPENCODE_CONFIG_DIR").filter(|v| !v.is_empty()) {
        return PathBuf::from(dir);
    }
    if let Some(xdg) = std::env::var_os("XDG_CONFIG_HOME").filter(|v| !v.is_empty()) {
        return PathBuf::from(xdg).join("opencode");
    }
    home.join(".config").join("opencode")
}

fn ensure_safe_parent(dir: &Path) -> Result<(), String> {
    if let Ok(meta) = std::fs::symlink_metadata(dir) {
        if meta.file_type().is_symlink() {
            return Err("Refusing to write inside a symlinked config directory".to_string());
        }
    }
    std::fs::create_dir_all(dir)
        .map_err(|e| format!("Failed to create {}: {e}", display_path(dir)))
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    crate::json_file::write_atomic(path, bytes)
        .map_err(|e| format!("Failed to save {}: {e}", display_path(path)))
}

fn unsupported_doc(tool_id: &str) -> ToolMemoryDocument {
    ToolMemoryDocument {
        tool_id: tool_id.to_string(),
        supported: false,
        exists: false,
        path: String::new(),
        file_name: String::new(),
        content: String::new(),
    }
}

fn display_path(path: &Path) -> String {
    let raw = path.to_string_lossy();
    raw.strip_prefix(r"\\?\").unwrap_or(&raw).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_supported_tool_memory_files() {
        let claude = memory_spec("claude").unwrap().unwrap();
        assert_eq!(claude.file_name, "CLAUDE.md");
        assert!(claude.path.ends_with("CLAUDE.md"));

        let codex = memory_spec("codex").unwrap().unwrap();
        assert_eq!(codex.file_name, "AGENTS.md");
        assert!(codex.path.ends_with("AGENTS.md"));

        let antigravity = memory_spec("antigravity").unwrap().unwrap();
        assert_eq!(antigravity.file_name, "GEMINI.md");

        let kimicode = memory_spec("kimicode").unwrap().unwrap();
        assert_eq!(kimicode.file_name, "AGENTS.md");

        assert!(memory_spec("kilo").unwrap().is_none());
    }
}
