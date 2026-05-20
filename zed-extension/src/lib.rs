use zed_extension_api::{self as zed, serde_json, Extension, LanguageServerId, Worktree};

struct EnmaExtension {
    cached_binary_path: Option<String>,
}

impl Extension for EnmaExtension {
    fn new() -> Self {
        EnmaExtension {
            cached_binary_path: None,
        }
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

        // Use cached path if available
        if let Some(ref path) = self.cached_binary_path {
            return Ok(zed::Command {
                command: path.clone(),
                args: vec!["--stdio".to_string()],
                env: vec![],
            });
        }

        // Find node
        let node = worktree
            .which("node")
            .ok_or_else(|| {
                "enma-language-server not found in PATH, and node is not available. \
                 Install with: npm install -g enma-language"
                    .to_string()
            })?;

        // Derive the npm global prefix from the node binary path
        let node_dir = parent_dir(&node);
        let server_path = format!(
            "{}/node_modules/enma-language/server/dist/server.js",
            node_dir
        );

        if worktree.read_text_file(&server_path).is_ok() {
            self.cached_binary_path = Some(node.clone());
            return Ok(zed::Command {
                command: node,
                args: vec![server_path, "--stdio".to_string()],
                env: vec![],
            });
        }

        // Try Unix-style global lib path
        let server_path_unix = format!(
            "{}/../lib/node_modules/enma-language/server/dist/server.js",
            node_dir
        );
        if worktree.read_text_file(&server_path_unix).is_ok() {
            self.cached_binary_path = Some(node.clone());
            return Ok(zed::Command {
                command: node,
                args: vec![server_path_unix, "--stdio".to_string()],
                env: vec![],
            });
        }

        Err(
            "enma-language-server not found. Install it with: npm install -g enma-language \
             or ensure the server bundle is accessible via node."
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

/// Get the parent directory of a file path, handling both `/` and `\` separators.
fn parent_dir(path: &str) -> String {
    path.rsplit_once(|c: char| c == '/' || c == '\\')
        .map(|(dir, _)| dir.to_string())
        .unwrap_or_else(|| ".".to_string())
}

zed::register_extension!(EnmaExtension);
