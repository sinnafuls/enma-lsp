use zed_extension_api::{self as zed, serde_json, Extension, LanguageServerId, Worktree};

struct EnmaExtension;

impl Extension for EnmaExtension {
    fn new() -> Self {
        EnmaExtension
    }

    fn language_server_command(
        &mut self,
        _language_server_id: &LanguageServerId,
        worktree: &Worktree,
    ) -> Result<zed::Command, String> {
        // Prefer the globally installed enma-language-server binary
        if let Some(path) = worktree.which("enma-language-server") {
            return Ok(zed::Command {
                command: path,
                args: vec!["--stdio".to_string()],
                env: vec![],
            });
        }

        // Fall back to node + the bundled server
        let node = worktree
            .which("node")
            .ok_or_else(|| {
                "enma-language-server not found in PATH, and node is not available. \
                 Install with: npm install -g enma-language"
                    .to_string()
            })?;

        // Look for the server bundle in the global npm install location
        let server_path = if cfg!(target_os = "windows") {
            let node_dir = node
                .rsplit_once(|c: char| c == '/' || c == '\\')
                .map(|(d, _)| d.to_string())
                .unwrap_or_default();
            format!("{}/../node_modules/enma-language/server/dist/server.js", node_dir)
                .replace('\\', "/")
        } else {
            let node_dir = node
                .rsplit_once('/')
                .map(|(d, _)| d.to_string())
                .unwrap_or_default();
            format!("{}/../lib/node_modules/enma-language/server/dist/server.js", node_dir)
        };

        if worktree.read_text_file(&server_path).is_ok() {
            return Ok(zed::Command {
                command: node,
                args: vec![server_path, "--stdio".to_string()],
                env: vec![],
            });
        }

        Err(
            "enma-language-server not found. Install it with: npm install -g enma-language"
                .to_string(),
        )
    }

    fn language_server_initialization_options(
        &mut self,
        _language_server_id: &LanguageServerId,
        _worktree: &Worktree,
    ) -> zed::Result<Option<serde_json::Value>> {
        Ok(Some(serde_json::json!({})))
    }
}

zed::register_extension!(EnmaExtension);
