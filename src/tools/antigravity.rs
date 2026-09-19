//! Antigravity CLI (Google) — third-class (T3) integration.
//!
//! Antigravity is closed-source and its private session formats have changed
//! across releases. Coffee CLI therefore treats `agy` as launch-only: brand
//! icon, PATH detection, and one-click terminal startup, with no hook or
//! protocol integration and no registry-driven history (`history_shape: None`).
//!
//! History and heatmap come from a separate, read-only second pass over the
//! current brain layout (`find_antigravity_cli_sessions` in server.rs). It is
//! best-effort by design: if agy changes the layout again the pass yields
//! nothing, and the tool falls back to plain launch-only behaviour.

use super::ToolDescriptor;

pub static DESCRIPTOR: ToolDescriptor = ToolDescriptor {
    id: "antigravity",
    display_name: "Antigravity CLI",
    binary_name: "agy",
    has_legacy_hook_artifacts: false,
    history_shape: None,
    default_args: &[],
};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn antigravity_is_launch_only() {
        assert!(DESCRIPTOR.history_shape.is_none());
        assert!(!DESCRIPTOR.has_legacy_hook_artifacts);
    }
}
