use super::*;
use serde::de::{Deserializer, IgnoredAny, MapAccess, SeqAccess, Visitor};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};

const INDEX_SCHEMA_VERSION: u32 = 1;
const HEAD_ANCHOR_BYTES: usize = 4096;
const TAIL_ANCHOR_BYTES: usize = 512;

fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for &b in bytes {
        hash ^= b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

#[inline]
fn contains_any_bytes(haystack: &[u8], needles: &[&[u8]]) -> bool {
    needles.iter().any(|needle| {
        !needle.is_empty()
            && haystack.len() >= needle.len()
            && haystack.windows(needle.len()).any(|w| w == *needle)
    })
}

fn cap_prompt_title(raw: &str) -> String {
    let safe = raw.replace('\n', " ");
    let mut chars = safe.chars();
    let chunk: String = chars.by_ref().take(40).collect();
    if chars.next().is_some() {
        format!("{chunk}...")
    } else {
        chunk
    }
}

fn stamp_epoch_ms(time: std::time::SystemTime) -> String {
    time.duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis().to_string())
        .unwrap_or_default()
}

// ─── Lossless zero-allocation serde visitors for transcript probing ──────────

fn de_opt_string<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    struct OptStrVisitor;
    impl<'de> Visitor<'de> for OptStrVisitor {
        type Value = Option<String>;
        fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.write_str("any JSON value (extracting string if present)")
        }
        fn visit_str<E: serde::de::Error>(self, v: &str) -> Result<Self::Value, E> {
            Ok(Some(v.to_string()))
        }
        fn visit_string<E: serde::de::Error>(self, v: String) -> Result<Self::Value, E> {
            Ok(Some(v))
        }
        fn visit_bool<E: serde::de::Error>(self, _: bool) -> Result<Self::Value, E> {
            Ok(None)
        }
        fn visit_i64<E: serde::de::Error>(self, _: i64) -> Result<Self::Value, E> {
            Ok(None)
        }
        fn visit_u64<E: serde::de::Error>(self, _: u64) -> Result<Self::Value, E> {
            Ok(None)
        }
        fn visit_f64<E: serde::de::Error>(self, _: f64) -> Result<Self::Value, E> {
            Ok(None)
        }
        fn visit_none<E: serde::de::Error>(self) -> Result<Self::Value, E> {
            Ok(None)
        }
        fn visit_unit<E: serde::de::Error>(self) -> Result<Self::Value, E> {
            Ok(None)
        }
        fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
            while seq.next_element::<IgnoredAny>()?.is_some() {}
            Ok(None)
        }
        fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
            while map.next_entry::<IgnoredAny, IgnoredAny>()?.is_some() {}
            Ok(None)
        }
    }
    deserializer.deserialize_any(OptStrVisitor)
}

fn de_opt_timestamp<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    struct OptTsVisitor;
    impl<'de> Visitor<'de> for OptTsVisitor {
        type Value = Option<String>;
        fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.write_str("any JSON value (extracting timestamp scalar if present)")
        }
        fn visit_str<E: serde::de::Error>(self, v: &str) -> Result<Self::Value, E> {
            Ok((!v.is_empty()).then(|| v.to_string()))
        }
        fn visit_string<E: serde::de::Error>(self, v: String) -> Result<Self::Value, E> {
            Ok((!v.is_empty()).then_some(v))
        }
        fn visit_i64<E: serde::de::Error>(self, v: i64) -> Result<Self::Value, E> {
            Ok(Some(v.to_string()))
        }
        fn visit_u64<E: serde::de::Error>(self, v: u64) -> Result<Self::Value, E> {
            Ok(Some(v.to_string()))
        }
        fn visit_f64<E: serde::de::Error>(self, v: f64) -> Result<Self::Value, E> {
            Ok(v.is_finite().then(|| v.to_string()))
        }
        fn visit_bool<E: serde::de::Error>(self, _: bool) -> Result<Self::Value, E> {
            Ok(None)
        }
        fn visit_none<E: serde::de::Error>(self) -> Result<Self::Value, E> {
            Ok(None)
        }
        fn visit_unit<E: serde::de::Error>(self) -> Result<Self::Value, E> {
            Ok(None)
        }
        fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
            while seq.next_element::<IgnoredAny>()?.is_some() {}
            Ok(None)
        }
        fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
            while map.next_entry::<IgnoredAny, IgnoredAny>()?.is_some() {}
            Ok(None)
        }
    }
    deserializer.deserialize_any(OptTsVisitor)
}

fn de_opt_object<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: serde::de::DeserializeOwned,
{
    struct OptObjVisitor<T>(std::marker::PhantomData<T>);
    impl<'de, T: serde::de::DeserializeOwned> Visitor<'de> for OptObjVisitor<T> {
        type Value = Option<T>;
        fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.write_str("any JSON value (extracting object if present)")
        }
        fn visit_map<A: MapAccess<'de>>(self, map: A) -> Result<Self::Value, A::Error> {
            T::deserialize(serde::de::value::MapAccessDeserializer::new(map)).map(Some)
        }
        fn visit_bool<E: serde::de::Error>(self, _: bool) -> Result<Self::Value, E> {
            Ok(None)
        }
        fn visit_i64<E: serde::de::Error>(self, _: i64) -> Result<Self::Value, E> {
            Ok(None)
        }
        fn visit_u64<E: serde::de::Error>(self, _: u64) -> Result<Self::Value, E> {
            Ok(None)
        }
        fn visit_f64<E: serde::de::Error>(self, _: f64) -> Result<Self::Value, E> {
            Ok(None)
        }
        fn visit_str<E: serde::de::Error>(self, _: &str) -> Result<Self::Value, E> {
            Ok(None)
        }
        fn visit_string<E: serde::de::Error>(self, _: String) -> Result<Self::Value, E> {
            Ok(None)
        }
        fn visit_none<E: serde::de::Error>(self) -> Result<Self::Value, E> {
            Ok(None)
        }
        fn visit_unit<E: serde::de::Error>(self) -> Result<Self::Value, E> {
            Ok(None)
        }
        fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
            while seq.next_element::<IgnoredAny>()?.is_some() {}
            Ok(None)
        }
    }
    deserializer.deserialize_any(OptObjVisitor(std::marker::PhantomData))
}

#[derive(serde::Deserialize, Default, Clone)]
struct TextBlockProbe {
    #[serde(rename = "type", default, deserialize_with = "de_opt_string")]
    kind: Option<String>,
    #[serde(default, deserialize_with = "de_opt_string")]
    text: Option<String>,
}

#[derive(Clone)]
enum ContentProbe {
    Text(String),
    Blocks(Vec<TextBlockProbe>),
    Other,
}

impl Default for ContentProbe {
    fn default() -> Self {
        Self::Other
    }
}

impl<'de> serde::Deserialize<'de> for ContentProbe {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct ContentVisitor;
        impl<'de> Visitor<'de> for ContentVisitor {
            type Value = ContentProbe;
            fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str("message content string or block array")
            }
            fn visit_str<E: serde::de::Error>(self, v: &str) -> Result<Self::Value, E> {
                Ok(ContentProbe::Text(v.to_string()))
            }
            fn visit_string<E: serde::de::Error>(self, v: String) -> Result<Self::Value, E> {
                Ok(ContentProbe::Text(v))
            }
            fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
                #[derive(serde::Deserialize)]
                struct Elem(#[serde(deserialize_with = "de_opt_object")] Option<TextBlockProbe>);
                let mut blocks = Vec::new();
                while let Some(Elem(opt)) = seq.next_element::<Elem>()? {
                    if let Some(b) = opt {
                        blocks.push(b);
                    }
                }
                Ok(ContentProbe::Blocks(blocks))
            }
            fn visit_bool<E: serde::de::Error>(self, _: bool) -> Result<Self::Value, E> {
                Ok(ContentProbe::Other)
            }
            fn visit_i64<E: serde::de::Error>(self, _: i64) -> Result<Self::Value, E> {
                Ok(ContentProbe::Other)
            }
            fn visit_u64<E: serde::de::Error>(self, _: u64) -> Result<Self::Value, E> {
                Ok(ContentProbe::Other)
            }
            fn visit_f64<E: serde::de::Error>(self, _: f64) -> Result<Self::Value, E> {
                Ok(ContentProbe::Other)
            }
            fn visit_none<E: serde::de::Error>(self) -> Result<Self::Value, E> {
                Ok(ContentProbe::Other)
            }
            fn visit_unit<E: serde::de::Error>(self) -> Result<Self::Value, E> {
                Ok(ContentProbe::Other)
            }
            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
                while map.next_entry::<IgnoredAny, IgnoredAny>()?.is_some() {}
                Ok(ContentProbe::Other)
            }
        }
        deserializer.deserialize_any(ContentVisitor)
    }
}

// ─── Incremental Per-Tool Transcript States ──────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub(super) struct CodexState {
    session_id: String,
    cwd: String,
    created_at: Option<String>,
    title: String,
    total_messages: u32,
    rejected: bool,
}

impl CodexState {
    fn new(stem: String) -> Self {
        Self {
            session_id: stem,
            cwd: String::new(),
            created_at: None,
            title: String::new(),
            total_messages: 0,
            rejected: false,
        }
    }

    fn feed_line(&mut self, line: &str) {
        if self.rejected {
            return;
        }
        if !contains_any_bytes(line.as_bytes(), &[b"session_meta", b"message", b"\\u"]) {
            return;
        }

        #[derive(serde::Deserialize)]
        struct PayloadProbe {
            #[serde(rename = "type", default, deserialize_with = "de_opt_string")]
            payload_type: Option<String>,
            #[serde(default, deserialize_with = "de_opt_string")]
            role: Option<String>,
        }
        #[derive(serde::Deserialize)]
        struct Envelope {
            #[serde(rename = "type", default, deserialize_with = "de_opt_string")]
            row_type: Option<String>,
            #[serde(default, deserialize_with = "de_opt_object")]
            payload: Option<PayloadProbe>,
        }

        let Ok(env) = serde_json::from_str::<Envelope>(line) else {
            return;
        };
        let row_type = env.row_type.as_deref().unwrap_or("");
        if row_type == "session_meta" {
            let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
                return;
            };
            let Some(payload) = value.get("payload") else {
                return;
            };
            self.created_at = payload
                .get("timestamp")
                .or_else(|| value.get("timestamp"))
                .and_then(json_timestamp_string)
                .or_else(|| self.created_at.take());
            if is_codex_subagent_session(payload) || is_codex_exec_session(payload) {
                self.rejected = true;
                return;
            }
            if let Some(id) = payload.get("id").and_then(|v| v.as_str()) {
                if !id.is_empty() {
                    self.session_id = id.to_string();
                }
            }
            if let Some(c) = payload.get("cwd").and_then(|v| v.as_str()) {
                if !c.is_empty() {
                    self.cwd = c.to_string();
                }
            }
            return;
        }

        let Some(p) = env.payload else {
            return;
        };
        let payload_type = p.payload_type.as_deref().unwrap_or("");
        let is_msg =
            (row_type == "response_item" && payload_type == "message") || row_type == "user_message";
        if !is_msg {
            return;
        }
        let role = p.role.as_deref().unwrap_or("");
        if role == "user" || role == "assistant" {
            self.total_messages += 1;
        }
        if !self.title.is_empty() || role != "user" {
            return;
        }

        #[derive(serde::Deserialize)]
        struct UserPayload {
            #[serde(default)]
            content: ContentProbe,
        }
        #[derive(serde::Deserialize)]
        struct UserRow {
            #[serde(default, deserialize_with = "de_opt_object")]
            payload: Option<UserPayload>,
        }
        let Ok(user_row) = serde_json::from_str::<UserRow>(line) else {
            return;
        };
        let Some(UserPayload {
            content: ContentProbe::Blocks(blocks),
        }) = user_row.payload
        else {
            return;
        };
        for block in blocks {
            let bt = block.kind.as_deref().unwrap_or("");
            if bt != "input_text" && bt != "text" {
                continue;
            }
            let Some(raw) = block.text.as_deref() else {
                continue;
            };
            let text = strip_codex_desktop_file_preamble(raw);
            if text.is_empty() || is_system_injected(text) {
                continue;
            }
            self.title = cap_prompt_title(text);
            break;
        }
    }

    fn finish(&self, file_path: &std::path::Path, stamp: Option<&SessionFileStamp>) -> Option<SavedSession> {
        if self.rejected {
            return None;
        }
        let updated_at = stamp
            .map(|s| stamp_epoch_ms(s.modified))
            .unwrap_or_default();
        let created_fallback = || {
            stamp
                .and_then(|s| s.created)
                .map(stamp_epoch_ms)
                .filter(|s| !s.is_empty())
        };
        let title = if self.title.is_empty() {
            "Codex Session".to_string()
        } else {
            self.title.clone()
        };
        let turn_count = if self.total_messages > 0 {
            std::cmp::max(1, (self.total_messages + 1) / 2)
        } else {
            0
        };
        Some(SavedSession {
            id: format!("codex_native_{}", self.session_id),
            name: title,
            tool: "codex".to_string(),
            cwd: self.cwd.clone(),
            session_token: Some(self.session_id.clone()),
            saved_at: updated_at,
            created_at: self.created_at.clone().or_else(created_fallback),
            file_path: Some(file_path.to_string_lossy().into_owned()),
            turn_count: Some(turn_count),
        })
    }
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub(super) struct AgentState {
    tool_name: String,
    session_id: String,
    cwd: String,
    created_at: Option<String>,
    first_title: String,
    custom_title: String,
    ai_title: String,
    sdk_entrypoint: bool,
    human_prompt: bool,
    total_messages: u32,
    real_user_messages: u32,
}

impl AgentState {
    fn new(stem: String, tool_name: &str) -> Self {
        Self {
            tool_name: tool_name.to_string(),
            session_id: stem,
            cwd: String::new(),
            created_at: None,
            first_title: String::new(),
            custom_title: String::new(),
            ai_title: String::new(),
            sdk_entrypoint: false,
            human_prompt: false,
            total_messages: 0,
            real_user_messages: 0,
        }
    }

    fn feed_line(&mut self, line: &str) {
        if self.created_at.is_some()
            && !self.cwd.is_empty()
            && !contains_any_bytes(
                line.as_bytes(),
                &[
                    b"sessionId",
                    b"entrypoint",
                    b"origin",
                    b"custom-title",
                    b"ai-title",
                    b"message",
                    b"\\u",
                ],
            )
        {
            return;
        }

        #[derive(serde::Deserialize, Default)]
        struct OriginProbe {
            #[serde(default, deserialize_with = "de_opt_string")]
            kind: Option<String>,
        }
        #[derive(serde::Deserialize, Default)]
        struct MsgRoleProbe {
            #[serde(default, deserialize_with = "de_opt_string")]
            role: Option<String>,
        }
        #[derive(serde::Deserialize, Default)]
        struct PayloadRoleProbe {
            #[serde(rename = "type", default, deserialize_with = "de_opt_string")]
            payload_type: Option<String>,
            #[serde(default, deserialize_with = "de_opt_string")]
            role: Option<String>,
        }
        #[derive(serde::Deserialize)]
        struct RowProbe {
            #[serde(default, deserialize_with = "de_opt_timestamp")]
            timestamp: Option<String>,
            #[serde(rename = "sessionId", default, deserialize_with = "de_opt_string")]
            session_id: Option<String>,
            #[serde(default, deserialize_with = "de_opt_string")]
            cwd: Option<String>,
            #[serde(default, deserialize_with = "de_opt_string")]
            entrypoint: Option<String>,
            #[serde(default, deserialize_with = "de_opt_object")]
            origin: Option<OriginProbe>,
            #[serde(rename = "type", default, deserialize_with = "de_opt_string")]
            row_type: Option<String>,
            #[serde(rename = "customTitle", default, deserialize_with = "de_opt_string")]
            custom_title: Option<String>,
            #[serde(rename = "aiTitle", default, deserialize_with = "de_opt_string")]
            ai_title: Option<String>,
            #[serde(default, deserialize_with = "de_opt_object")]
            message: Option<MsgRoleProbe>,
            #[serde(default, deserialize_with = "de_opt_object")]
            payload: Option<PayloadRoleProbe>,
        }

        let Ok(row) = serde_json::from_str::<RowProbe>(line) else {
            return;
        };
        if self.created_at.is_none() {
            self.created_at = row.timestamp;
        }
        if let Some(s) = row.session_id {
            if !s.is_empty() {
                self.session_id = s;
            }
        }
        if self.cwd.is_empty() {
            if let Some(c) = row.cwd {
                if !c.is_empty() {
                    self.cwd = c;
                }
            }
        }
        if let Some(entry) = row.entrypoint {
            self.sdk_entrypoint = entry.starts_with("sdk");
        }
        if row.origin.and_then(|o| o.kind).as_deref() == Some("human") {
            self.human_prompt = true;
        }
        match row.row_type.as_deref().unwrap_or("") {
            "custom-title" => {
                if let Some(t) = row.custom_title.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) {
                    self.custom_title = t;
                }
                return;
            }
            "ai-title" => {
                if let Some(t) = row.ai_title.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) {
                    self.ai_title = t;
                }
                return;
            }
            _ => {}
        }

        let (role, from_payload) = if let Some(msg) = row.message {
            (msg.role, false)
        } else if let Some(payload) = row.payload {
            if payload.payload_type.as_deref() == Some("message") {
                (payload.role, true)
            } else {
                (None, false)
            }
        } else {
            (None, false)
        };

        let Some(role_str) = role.as_deref() else {
            return;
        };
        if role_str == "user" || role_str == "assistant" {
            self.total_messages += 1;
        }
        if role_str != "user" {
            return;
        }

        // Only `role == "user"` needs `content` — and `ContentProbe` skips
        // `tool_result.content` blobs via `IgnoredAny` with zero heap allocation.
        #[derive(serde::Deserialize, Default)]
        struct UserContentHolder {
            #[serde(default)]
            content: ContentProbe,
        }
        #[derive(serde::Deserialize)]
        struct UserContentRow {
            #[serde(default, deserialize_with = "de_opt_object")]
            message: Option<UserContentHolder>,
            #[serde(default, deserialize_with = "de_opt_object")]
            payload: Option<UserContentHolder>,
        }
        let Ok(content_row) = serde_json::from_str::<UserContentRow>(line) else {
            return;
        };
        let holder = if from_payload {
            content_row.payload
        } else {
            content_row.message
        };
        let Some(holder) = holder else {
            return;
        };
        match holder.content {
            ContentProbe::Text(s) => {
                if !is_system_injected(&s) {
                    self.real_user_messages += 1;
                    if self.first_title.is_empty() {
                        self.first_title = cap_prompt_title(&s);
                    }
                }
            }
            ContentProbe::Blocks(blocks) => {
                let mut has_real = false;
                let mut need_title = self.first_title.is_empty();
                for block in blocks {
                    let kind = block.kind.as_deref();
                    if kind != Some("text") && kind != Some("input_text") {
                        continue;
                    }
                    if let Some(text) = block.text.as_deref() {
                        if !is_system_injected(text) {
                            has_real = true;
                            if need_title {
                                self.first_title = cap_prompt_title(text);
                                need_title = false;
                            }
                        }
                    }
                }
                if has_real {
                    self.real_user_messages += 1;
                }
            }
            ContentProbe::Other => {}
        }
    }

    fn finish(
        &self,
        file_path: &std::path::Path,
        claude_projects: &std::collections::HashMap<String, String>,
        stamp: Option<&SessionFileStamp>,
    ) -> Option<SavedSession> {
        if self.real_user_messages == 0 {
            return None;
        }
        if is_headless_claude_run(self.sdk_entrypoint, self.human_prompt) {
            return None;
        }
        let mut cwd = self.cwd.clone();
        if cwd.is_empty() && self.tool_name == "claude" {
            if let Some(real_path) = file_path
                .parent()
                .and_then(|p| p.file_name())
                .and_then(|n| n.to_str())
                .and_then(|folder| claude_projects.get(folder))
            {
                cwd = real_path.clone();
            }
        }
        let turn_count = if self.total_messages > 0 {
            std::cmp::max(1, (self.total_messages + 1) / 2)
        } else {
            0
        };
        let updated_at = stamp.map(|s| stamp_epoch_ms(s.modified)).unwrap_or_default();
        let created_fallback = || {
            stamp
                .and_then(|s| s.created)
                .map(stamp_epoch_ms)
                .filter(|s| !s.is_empty())
        };
        let mut title = if !self.custom_title.is_empty() {
            self.custom_title.clone()
        } else if !self.ai_title.is_empty() {
            self.ai_title.clone()
        } else {
            self.first_title.clone()
        };
        if title.is_empty() {
            let mut chars = self.tool_name.chars();
            let cap_name = match chars.next() {
                None => String::new(),
                Some(f) => f.to_uppercase().collect::<String>() + chars.as_str(),
            };
            title = format!("{cap_name} Session");
        }
        Some(SavedSession {
            id: format!("{}_native_{}", self.tool_name, self.session_id),
            name: title,
            tool: self.tool_name.clone(),
            cwd,
            session_token: Some(self.session_id.clone()),
            saved_at: updated_at,
            created_at: self.created_at.clone().or_else(created_fallback),
            file_path: Some(file_path.to_string_lossy().into_owned()),
            turn_count: Some(turn_count),
        })
    }
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub(super) struct CodeBuddyState {
    session_id: String,
    cwd: String,
    created_at: Option<String>,
    custom_title: String,
    ai_title: String,
    topic: String,
    first_prompt: String,
    total_messages: u32,
    real_user_messages: u32,
}

impl CodeBuddyState {
    fn new(stem: String) -> Self {
        Self {
            session_id: stem,
            cwd: String::new(),
            created_at: None,
            custom_title: String::new(),
            ai_title: String::new(),
            topic: String::new(),
            first_prompt: String::new(),
            total_messages: 0,
            real_user_messages: 0,
        }
    }

    fn feed_line(&mut self, line: &str) {
        if self.created_at.is_some()
            && !self.cwd.is_empty()
            && !contains_any_bytes(
                line.as_bytes(),
                &[b"custom-title", b"ai-title", b"topic", b"message", b"\\u"],
            )
        {
            return;
        }
        let Ok(root) = serde_json::from_str::<serde_json::Value>(line) else {
            return;
        };
        let item = root
            .get("payload")
            .filter(|value| value.is_object())
            .unwrap_or(&root);

        if self.created_at.is_none() {
            self.created_at = item.get("timestamp").and_then(json_timestamp_string);
        }
        if self.cwd.is_empty() {
            if let Some(value) = item.get("cwd").and_then(|value| value.as_str()) {
                if !value.is_empty() {
                    self.cwd = value.to_string();
                }
            }
        }
        let item_title = |key: &str| -> Option<String> {
            item.get(key)
                .and_then(|value| value.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        };
        match item.get("type").and_then(|value| value.as_str()).unwrap_or("") {
            "custom-title" => {
                if let Some(value) = item_title("customTitle") {
                    self.custom_title = value;
                }
            }
            "ai-title" => {
                if let Some(value) = item_title("aiTitle") {
                    self.ai_title = value;
                }
            }
            "topic" => {
                if let Some(value) = item_title("topic") {
                    self.topic = value;
                }
            }
            "message" => {
                let role = item.get("role").and_then(|value| value.as_str()).unwrap_or("");
                if role != "user" && role != "assistant" {
                    return;
                }
                self.total_messages += 1;
                if role != "user" {
                    return;
                }
                let text = codebuddy_content_text(item.get("content"));
                if text.is_empty() || is_system_injected(&text) {
                    return;
                }
                if !codebuddy_is_real_user_prompt(item) {
                    return;
                }
                self.real_user_messages += 1;
                if self.first_prompt.is_empty() {
                    self.first_prompt = cap_prompt_title(&text);
                }
            }
            _ => {}
        }
    }

    fn finish(&self, file_path: &std::path::Path, stamp: Option<&SessionFileStamp>) -> Option<SavedSession> {
        if self.real_user_messages == 0 {
            return None;
        }
        let mut title = if !self.custom_title.is_empty() {
            self.custom_title.clone()
        } else if !self.ai_title.is_empty() {
            self.ai_title.clone()
        } else if !self.topic.is_empty() {
            self.topic.clone()
        } else {
            self.first_prompt.clone()
        };
        if title.is_empty() {
            title = "CodeBuddy Session".to_string();
        }
        let turn_count = if self.total_messages > 0 {
            std::cmp::max(1, (self.total_messages + 1) / 2)
        } else {
            0
        };
        let updated_at = stamp.map(|s| stamp_epoch_ms(s.modified)).unwrap_or_default();
        let created_fallback = || {
            stamp
                .and_then(|s| s.created)
                .map(stamp_epoch_ms)
                .filter(|s| !s.is_empty())
        };
        Some(SavedSession {
            id: format!("codebuddy_native_{}", self.session_id),
            name: title,
            tool: "codebuddy".to_string(),
            cwd: self.cwd.clone(),
            session_token: Some(self.session_id.clone()),
            saved_at: updated_at,
            created_at: self.created_at.clone().or_else(created_fallback),
            file_path: Some(file_path.to_string_lossy().into_owned()),
            turn_count: Some(turn_count),
        })
    }
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub(super) struct PiState {
    tool: String,
    session_id: String,
    cwd: String,
    created_at: Option<String>,
    first_title: String,
    native_title: String,
    total_messages: u32,
    pub(super) omp_heatmap_messages: u32,
}

impl PiState {
    fn new(stem: String, tool: &str) -> Self {
        let stem_uuid = stem
            .rsplit_once('_')
            .map(|(_, u)| u.to_string())
            .unwrap_or(stem);
        Self {
            tool: tool.to_string(),
            session_id: stem_uuid,
            cwd: String::new(),
            created_at: None,
            first_title: String::new(),
            native_title: String::new(),
            total_messages: 0,
            omp_heatmap_messages: 0,
        }
    }

    fn feed_line(&mut self, line: &str) {
        if !contains_any_bytes(line.as_bytes(), &[b"session", b"message", b"title", b"\\u"]) {
            return;
        }

        #[derive(serde::Deserialize, Default)]
        struct PiMsgRole {
            #[serde(default, deserialize_with = "de_opt_string")]
            role: Option<String>,
        }
        #[derive(serde::Deserialize)]
        struct PiRow {
            #[serde(rename = "type", default, deserialize_with = "de_opt_string")]
            row_type: Option<String>,
            #[serde(default, deserialize_with = "de_opt_string")]
            title: Option<String>,
            #[serde(default, deserialize_with = "de_opt_string")]
            name: Option<String>,
            #[serde(default, deserialize_with = "de_opt_string")]
            id: Option<String>,
            #[serde(default, deserialize_with = "de_opt_string")]
            cwd: Option<String>,
            #[serde(default, deserialize_with = "de_opt_timestamp")]
            timestamp: Option<String>,
            #[serde(default, deserialize_with = "de_opt_object")]
            message: Option<PiMsgRole>,
        }

        let Ok(row) = serde_json::from_str::<PiRow>(line) else {
            return;
        };
        let row_type = row.row_type.as_deref().unwrap_or("");

        if self.tool == "omp" && matches!(row_type, "title" | "title_change" | "session") {
            if let Some(text) = row.title.as_deref().filter(|s| !s.trim().is_empty()) {
                if row_type != "session" || self.native_title.is_empty() {
                    self.native_title = text.to_string();
                }
            }
        }
        if row_type == "session_info" {
            self.native_title = row.name.as_deref().map(str::trim).unwrap_or("").to_string();
            return;
        }
        if row_type == "session" {
            self.created_at = row.timestamp.or_else(|| self.created_at.take());
            if let Some(id) = row.id.filter(|s| !s.is_empty()) {
                self.session_id = id;
            }
            if let Some(c) = row.cwd.filter(|s| !s.is_empty()) {
                self.cwd = c;
            }
            return;
        }
        if row_type == "message" {
            let Some(msg) = row.message else {
                return;
            };
            let role = msg.role.as_deref().unwrap_or("");
            if matches!(role, "user" | "assistant" | "toolResult") {
                self.omp_heatmap_messages = self.omp_heatmap_messages.saturating_add(1);
            }
            if role == "user" || role == "assistant" {
                self.total_messages += 1;
            }
            if !self.first_title.is_empty() || role != "user" {
                return;
            }
            #[derive(serde::Deserialize, Default)]
            struct PiMsgContent {
                #[serde(default)]
                content: Option<ContentProbe>,
            }
            #[derive(serde::Deserialize)]
            struct PiUserRow {
                #[serde(default, deserialize_with = "de_opt_object")]
                message: Option<PiMsgContent>,
            }
            let Ok(user_row) = serde_json::from_str::<PiUserRow>(line) else {
                return;
            };
            let Some(content) = user_row.message.and_then(|m| m.content) else {
                return;
            };
            match content {
                ContentProbe::Text(text) => {
                    if !is_system_injected(&text) {
                        self.first_title = cap_prompt_title(&text);
                    }
                }
                ContentProbe::Blocks(blocks) => {
                    for block in blocks {
                        let bt = block.kind.as_deref().unwrap_or("");
                        if bt != "text" && bt != "input_text" {
                            continue;
                        }
                        let Some(text) = block.text.as_deref() else {
                            continue;
                        };
                        if is_system_injected(text) {
                            continue;
                        }
                        self.first_title = cap_prompt_title(text);
                        break;
                    }
                }
                ContentProbe::Other => {}
            }
        }
    }

    fn finish(&self, file_path: &std::path::Path, stamp: Option<&SessionFileStamp>) -> Option<SavedSession> {
        if self.tool == "omp" && self.total_messages == 0 {
            return None;
        }
        let mut title = if !self.native_title.is_empty() {
            self.native_title.clone()
        } else {
            self.first_title.clone()
        };
        if title.is_empty() {
            title = if self.tool == "omp" {
                "Oh-My-Pi Session".to_string()
            } else {
                "Pi Session".to_string()
            };
        }
        let turn_count = if self.total_messages > 0 {
            std::cmp::max(1, (self.total_messages + 1) / 2)
        } else {
            0
        };
        let updated_at = stamp.map(|s| stamp_epoch_ms(s.modified)).unwrap_or_default();
        let created_fallback = || {
            stamp
                .and_then(|s| s.created)
                .map(stamp_epoch_ms)
                .filter(|s| !s.is_empty())
        };
        Some(SavedSession {
            id: format!("{}_native_{}", self.tool, self.session_id),
            name: title,
            tool: self.tool.clone(),
            cwd: self.cwd.clone(),
            session_token: Some(self.session_id.clone()),
            saved_at: updated_at,
            created_at: self.created_at.clone().or_else(created_fallback),
            file_path: Some(file_path.to_string_lossy().into_owned()),
            turn_count: Some(turn_count),
        })
    }
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub(super) struct QwenState {
    session_id: String,
    cwd: String,
    created_at: Option<String>,
    title: String,
    total_messages: u32,
}

impl QwenState {
    fn new(stem: String) -> Self {
        Self {
            session_id: stem,
            cwd: String::new(),
            created_at: None,
            title: String::new(),
            total_messages: 0,
        }
    }

    fn feed_line(&mut self, line: &str) {
        if self.created_at.is_some()
            && !self.cwd.is_empty()
            && !contains_any_bytes(
                line.as_bytes(),
                &[b"sessionId", b"user", b"assistant", b"\\u"],
            )
        {
            return;
        }
        #[derive(serde::Deserialize)]
        struct QwenRow {
            #[serde(rename = "sessionId", default, deserialize_with = "de_opt_string")]
            session_id: Option<String>,
            #[serde(default, deserialize_with = "de_opt_timestamp")]
            timestamp: Option<String>,
            #[serde(default, deserialize_with = "de_opt_string")]
            cwd: Option<String>,
            #[serde(rename = "type", default, deserialize_with = "de_opt_string")]
            row_type: Option<String>,
        }

        let Ok(row) = serde_json::from_str::<QwenRow>(line) else {
            return;
        };
        if let Some(s) = row.session_id.filter(|s| !s.is_empty()) {
            self.session_id = s;
        }
        if self.created_at.is_none() {
            self.created_at = row.timestamp;
        }
        if self.cwd.is_empty() {
            if let Some(c) = row.cwd {
                self.cwd = c;
            }
        }
        let row_type = row.row_type.as_deref().unwrap_or("");
        if row_type == "user" || row_type == "assistant" {
            self.total_messages += 1;
        }
        if !self.title.is_empty() || row_type != "user" {
            return;
        }
        let Ok(val) = serde_json::from_str::<serde_json::Value>(line) else {
            return;
        };
        let Some(parts) = val
            .get("message")
            .and_then(|m| m.get("parts"))
            .and_then(|v| v.as_array())
        else {
            return;
        };
        for block in parts {
            let Some(text) = block.get("text").and_then(|v| v.as_str()) else {
                continue;
            };
            if is_system_injected(text) {
                continue;
            }
            self.title = cap_prompt_title(text);
            break;
        }
    }

    fn finish(&self, file_path: &std::path::Path, stamp: Option<&SessionFileStamp>) -> Option<SavedSession> {
        let title = if self.title.is_empty() {
            "Qwen Session".to_string()
        } else {
            self.title.clone()
        };
        let turn_count = if self.total_messages > 0 {
            std::cmp::max(1, (self.total_messages + 1) / 2)
        } else {
            0
        };
        let updated_at = stamp.map(|s| stamp_epoch_ms(s.modified)).unwrap_or_default();
        let created_fallback = || {
            stamp
                .and_then(|s| s.created)
                .map(stamp_epoch_ms)
                .filter(|s| !s.is_empty())
        };
        Some(SavedSession {
            id: format!("qwen_native_{}", self.session_id),
            name: title,
            tool: "qwen".to_string(),
            cwd: self.cwd.clone(),
            session_token: Some(self.session_id.clone()),
            saved_at: updated_at,
            created_at: self.created_at.clone().or_else(created_fallback),
            file_path: Some(file_path.to_string_lossy().into_owned()),
            turn_count: Some(turn_count),
        })
    }
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub(super) enum TranscriptState {
    Codex(CodexState),
    Agent(AgentState),
    CodeBuddy(CodeBuddyState),
    Pi(PiState),
    Qwen(QwenState),
}

impl TranscriptState {
    pub(super) fn new(path: &std::path::Path, tool: &str) -> Option<Self> {
        let stem = path.file_stem()?.to_string_lossy().to_string();
        Some(match tool {
            "codex" => Self::Codex(CodexState::new(stem)),
            "codebuddy" => Self::CodeBuddy(CodeBuddyState::new(stem)),
            "pi" | "omp" => Self::Pi(PiState::new(stem, tool)),
            "qwen" => Self::Qwen(QwenState::new(stem)),
            other => Self::Agent(AgentState::new(stem, other)),
        })
    }

    fn matches_tool(&self, tool: &str) -> bool {
        match self {
            Self::Codex(_) => tool == "codex",
            Self::CodeBuddy(_) => tool == "codebuddy",
            Self::Pi(s) => s.tool == tool,
            Self::Qwen(_) => tool == "qwen",
            Self::Agent(s) => s.tool_name == tool,
        }
    }

    pub(super) fn feed_line(&mut self, line: &str) {
        match self {
            Self::Codex(s) => s.feed_line(line),
            Self::Agent(s) => s.feed_line(line),
            Self::CodeBuddy(s) => s.feed_line(line),
            Self::Pi(s) => s.feed_line(line),
            Self::Qwen(s) => s.feed_line(line),
        }
    }

    pub(super) fn is_permanently_rejected(&self) -> bool {
        matches!(self, Self::Codex(s) if s.rejected)
    }

    pub(super) fn finish(
        &self,
        path: &std::path::Path,
        claude_projects: &std::collections::HashMap<String, String>,
        stamp: Option<&SessionFileStamp>,
    ) -> Option<SavedSession> {
        match self {
            Self::Codex(s) => s.finish(path, stamp),
            Self::Agent(s) => s.finish(path, claude_projects, stamp),
            Self::CodeBuddy(s) => s.finish(path, stamp),
            Self::Pi(s) => s.finish(path, stamp),
            Self::Qwen(s) => s.finish(path, stamp),
        }
    }
}

// ─── File Stamp + Incremental Checkpoint + Persistent Disk Index ─────────────

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct SessionFileStamp {
    pub(super) modified: std::time::SystemTime,
    pub(super) created: Option<std::time::SystemTime>,
    pub(super) size: u64,
    #[cfg(unix)]
    pub(super) identity: (u64, u64),
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
struct DiskStamp {
    modified_secs: u64,
    modified_nanos: u32,
    created_secs: Option<u64>,
    created_nanos: Option<u32>,
    size: u64,
    #[serde(default)]
    identity: (u64, u64),
}

impl SessionFileStamp {
    fn to_disk(&self) -> Option<DiskStamp> {
        let mod_dur = self.modified.duration_since(std::time::UNIX_EPOCH).ok()?;
        let (created_secs, created_nanos) = match self
            .created
            .and_then(|c| c.duration_since(std::time::UNIX_EPOCH).ok())
        {
            Some(d) => (Some(d.as_secs()), Some(d.subsec_nanos())),
            None => (None, None),
        };
        Some(DiskStamp {
            modified_secs: mod_dur.as_secs(),
            modified_nanos: mod_dur.subsec_nanos(),
            created_secs,
            created_nanos,
            size: self.size,
            #[cfg(unix)]
            identity: self.identity,
            #[cfg(not(unix))]
            identity: (0, 0),
        })
    }

    fn from_disk(d: &DiskStamp) -> Self {
        let modified = std::time::UNIX_EPOCH
            + std::time::Duration::new(d.modified_secs, d.modified_nanos);
        let created = match (d.created_secs, d.created_nanos) {
            (Some(s), Some(n)) => {
                Some(std::time::UNIX_EPOCH + std::time::Duration::new(s, n))
            }
            _ => None,
        };
        Self {
            modified,
            created,
            size: d.size,
            #[cfg(unix)]
            identity: d.identity,
        }
    }
}

pub(super) fn file_stamp(path: &std::path::Path) -> Option<SessionFileStamp> {
    let metadata = std::fs::metadata(path).ok()?;
    #[cfg(unix)]
    use std::os::unix::fs::MetadataExt;
    Some(SessionFileStamp {
        modified: metadata.modified().ok()?,
        created: metadata.created().ok(),
        size: metadata.len(),
        #[cfg(unix)]
        identity: (metadata.dev(), metadata.ino()),
    })
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub(super) struct IncrementalCheckpoint {
    pub(super) committed_offset: u64,
    head_len: usize,
    head_hash: u64,
    tail_len: usize,
    tail_hash: u64,
    pub(super) committed_nonempty_lines: u32,
    pub(super) state: TranscriptState,
}

impl IncrementalCheckpoint {
    pub(super) fn heatmap_count(&self) -> u32 {
        match &self.state {
            TranscriptState::Pi(s) if s.tool == "omp" => s.omp_heatmap_messages,
            _ => self.committed_nonempty_lines,
        }
    }
}

pub(super) struct CachedSession {
    pub(super) stamp: SessionFileStamp,
    pub(super) session: SavedSession,
    pub(super) checkpoint: Option<IncrementalCheckpoint>,
}

#[derive(Clone, Debug)]
pub(super) struct RejectedSession {
    pub(super) stamp: SessionFileStamp,
}

#[derive(Clone, Debug)]
pub(super) struct PartialSession {
    pub(super) stamp: SessionFileStamp,
    pub(super) checkpoint: IncrementalCheckpoint,
}

#[derive(Default)]
pub(super) struct SessionParseCache {
    // Compare the map actually used by the parser, avoiding timestamp
    // collisions and a race between reading it and statting it afterwards.
    pub(super) claude_projects: std::collections::HashMap<String, String>,
    pub(super) entries: std::collections::HashMap<std::path::PathBuf, CachedSession>,
    pub(super) rejected: std::collections::HashMap<std::path::PathBuf, RejectedSession>,
    pub(super) partial: std::collections::HashMap<std::path::PathBuf, PartialSession>,
    pub(super) dirty: bool,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct DiskCachedEntry {
    path: String,
    stamp: DiskStamp,
    session: SavedSession,
    checkpoint: Option<IncrementalCheckpoint>,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct DiskRejectedEntry {
    path: String,
    stamp: DiskStamp,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct DiskPartialEntry {
    path: String,
    stamp: DiskStamp,
    checkpoint: IncrementalCheckpoint,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct DiskSessionIndex {
    version: u32,
    claude_projects: std::collections::HashMap<String, String>,
    entries: Vec<DiskCachedEntry>,
    rejected: Vec<DiskRejectedEntry>,
    partial: Vec<DiskPartialEntry>,
}

fn normalize_disk_path_str(raw: &str) -> String {
    #[cfg(windows)]
    {
        raw.replace('/', "\\")
    }
    #[cfg(not(windows))]
    {
        raw.to_string()
    }
}

pub(super) fn normalize_heatmap_path_key(path: &std::path::Path) -> String {
    let raw = path.to_string_lossy();
    #[cfg(windows)]
    {
        let mut normalized = raw.replace('/', "\\");
        if normalized.as_bytes().get(1) == Some(&b':') {
            if let Some(first) = normalized.get_mut(0..1) {
                first.make_ascii_uppercase();
            }
        }
        normalized
    }
    #[cfg(not(windows))]
    {
        raw.into_owned()
    }
}

pub(super) fn session_index_disk_path() -> Option<std::path::PathBuf> {
    Some(
        dirs::home_dir()?
            .join(".coffee-cli")
            .join("cache")
            .join("session-index.v1.json"),
    )
}

impl SessionParseCache {
    pub(super) fn load_from_path(path: &std::path::Path) -> Self {
        let Ok(raw) = std::fs::read_to_string(path) else {
            return Self::default();
        };
        let Ok(disk) = serde_json::from_str::<DiskSessionIndex>(&raw) else {
            return Self::default();
        };
        if disk.version != INDEX_SCHEMA_VERSION {
            return Self::default();
        }
        let mut cache = Self {
            claude_projects: disk.claude_projects,
            entries: std::collections::HashMap::with_capacity(disk.entries.len()),
            rejected: std::collections::HashMap::with_capacity(disk.rejected.len()),
            partial: std::collections::HashMap::with_capacity(disk.partial.len()),
            dirty: false,
        };
        for item in disk.entries {
            let p = std::path::PathBuf::from(normalize_disk_path_str(&item.path));
            cache.entries.insert(
                p,
                CachedSession {
                    stamp: SessionFileStamp::from_disk(&item.stamp),
                    session: item.session,
                    checkpoint: item.checkpoint,
                },
            );
        }
        for item in disk.rejected {
            let p = std::path::PathBuf::from(normalize_disk_path_str(&item.path));
            cache.rejected.insert(
                p,
                RejectedSession {
                    stamp: SessionFileStamp::from_disk(&item.stamp),
                },
            );
        }
        for item in disk.partial {
            let p = std::path::PathBuf::from(normalize_disk_path_str(&item.path));
            cache.partial.insert(
                p,
                PartialSession {
                    stamp: SessionFileStamp::from_disk(&item.stamp),
                    checkpoint: item.checkpoint,
                },
            );
        }
        cache
    }

    pub(super) fn save_to_path(&mut self, path: &std::path::Path) {
        let mut entries = Vec::with_capacity(self.entries.len());
        for (k, v) in &self.entries {
            let Some(path_str) = k.to_str() else { continue };
            let Some(stamp) = v.stamp.to_disk() else { continue };
            entries.push(DiskCachedEntry {
                path: normalize_disk_path_str(path_str),
                stamp,
                session: v.session.clone(),
                checkpoint: v.checkpoint.clone(),
            });
        }
        let mut rejected = Vec::with_capacity(self.rejected.len());
        for (k, v) in &self.rejected {
            let Some(path_str) = k.to_str() else { continue };
            let Some(stamp) = v.stamp.to_disk() else { continue };
            rejected.push(DiskRejectedEntry {
                path: normalize_disk_path_str(path_str),
                stamp,
            });
        }
        let mut partial = Vec::with_capacity(self.partial.len());
        for (k, v) in &self.partial {
            let Some(path_str) = k.to_str() else { continue };
            let Some(stamp) = v.stamp.to_disk() else { continue };
            partial.push(DiskPartialEntry {
                path: normalize_disk_path_str(path_str),
                stamp,
                checkpoint: v.checkpoint.clone(),
            });
        }
        let disk = DiskSessionIndex {
            version: INDEX_SCHEMA_VERSION,
            claude_projects: self.claude_projects.clone(),
            entries,
            rejected,
            partial,
        };
        if let Ok(bytes) = serde_json::to_vec(&disk) {
            let _ = crate::json_file::write_atomic(path, &bytes);
            self.dirty = false;
        }
    }

    pub(super) fn retain_paths(&mut self, keep_paths: &std::collections::HashSet<std::path::PathBuf>) {
        let prev = self.entries.len() + self.rejected.len() + self.partial.len();
        self.entries.retain(|k, _| keep_paths.contains(k));
        self.rejected.retain(|k, _| keep_paths.contains(k));
        self.partial.retain(|k, _| keep_paths.contains(k));
        if self.entries.len() + self.rejected.len() + self.partial.len() != prev {
            self.dirty = true;
        }
    }
}

pub(super) fn session_parse_cache() -> &'static std::sync::Mutex<SessionParseCache> {
    static CACHE: std::sync::OnceLock<std::sync::Mutex<SessionParseCache>> =
        std::sync::OnceLock::new();
    CACHE.get_or_init(|| {
        let initial = session_index_disk_path()
            .map(|p| SessionParseCache::load_from_path(&p))
            .unwrap_or_default();
        std::sync::Mutex::new(initial)
    })
}

pub(super) fn sync_aux_generation(
    cache: &mut SessionParseCache,
    claude_projects: &std::collections::HashMap<String, String>,
) -> bool {
    if cache.claude_projects == *claude_projects {
        return false;
    }
    cache.entries.clear();
    cache.rejected.clear();
    cache.partial.clear();
    cache.claude_projects = claude_projects.clone();
    cache.dirty = true;
    true
}

fn compute_anchors(file: &mut std::fs::File, committed_offset: u64) -> Option<(usize, u64, usize, u64)> {
    let head_len = committed_offset.min(HEAD_ANCHOR_BYTES as u64) as usize;
    let mut head_buf = vec![0u8; head_len];
    if head_len > 0 {
        file.seek(SeekFrom::Start(0)).ok()?;
        file.read_exact(&mut head_buf).ok()?;
    }
    let head_hash = fnv1a64(&head_buf);

    let tail_start = committed_offset.saturating_sub(TAIL_ANCHOR_BYTES as u64);
    let tail_len = (committed_offset - tail_start) as usize;
    let mut tail_buf = vec![0u8; tail_len];
    if tail_len > 0 {
        file.seek(SeekFrom::Start(tail_start)).ok()?;
        file.read_exact(&mut tail_buf).ok()?;
    }
    let tail_hash = fnv1a64(&tail_buf);
    Some((head_len, head_hash, tail_len, tail_hash))
}

fn verify_anchors(file: &mut std::fs::File, cp: &IncrementalCheckpoint) -> bool {
    if cp.head_len > 0 {
        let mut buf = vec![0u8; cp.head_len];
        if file.seek(SeekFrom::Start(0)).is_err() || file.read_exact(&mut buf).is_err() {
            return false;
        }
        if fnv1a64(&buf) != cp.head_hash {
            return false;
        }
    }
    if cp.tail_len > 0 {
        let tail_start = cp.committed_offset.saturating_sub(cp.tail_len as u64);
        let mut buf = vec![0u8; cp.tail_len];
        if file.seek(SeekFrom::Start(tail_start)).is_err() || file.read_exact(&mut buf).is_err() {
            return false;
        }
        if fnv1a64(&buf) != cp.tail_hash {
            return false;
        }
    }
    true
}

struct JsonlScanOutcome {
    checkpoint: IncrementalCheckpoint,
    effective_state: TranscriptState,
}

fn scan_jsonl_from(
    mut file: std::fs::File,
    start_offset: u64,
    mut committed_state: TranscriptState,
    mut committed_nonempty_lines: u32,
) -> Option<JsonlScanOutcome> {
    file.seek(SeekFrom::Start(start_offset)).ok()?;
    let mut reader = BufReader::with_capacity(SESSION_READ_BUF, file);
    let mut raw_buf: Vec<u8> = Vec::with_capacity(4096);
    let mut committed_offset = start_offset;
    let mut trailing_effective: Option<TranscriptState> = None;

    loop {
        raw_buf.clear();
        let n = match reader.read_until(b'\n', &mut raw_buf) {
            Ok(0) => break,
            Ok(n) => n,
            Err(_) => break,
        };
        let ended_with_nl = raw_buf.last() == Some(&b'\n');
        let line_bytes = if ended_with_nl {
            let without_nl = &raw_buf[..raw_buf.len() - 1];
            without_nl.strip_suffix(b"\r").unwrap_or(without_nl)
        } else {
            raw_buf.as_slice()
        };
        let Ok(line_str) = std::str::from_utf8(line_bytes) else {
            break;
        };
        if ended_with_nl {
            committed_offset += n as u64;
            if line_bytes.iter().any(|&b| !b.is_ascii_whitespace()) {
                committed_nonempty_lines = committed_nonempty_lines.saturating_add(1);
            }
            committed_state.feed_line(line_str);
            if committed_state.is_permanently_rejected() {
                break;
            }
        } else {
            let mut eff = committed_state.clone();
            eff.feed_line(line_str);
            trailing_effective = Some(eff);
            break;
        }
    }

    let mut file = reader.into_inner();
    let (head_len, head_hash, tail_len, tail_hash) = compute_anchors(&mut file, committed_offset)?;
    let effective_state = trailing_effective.unwrap_or_else(|| committed_state.clone());
    Some(JsonlScanOutcome {
        checkpoint: IncrementalCheckpoint {
            committed_offset,
            head_len,
            head_hash,
            tail_len,
            tail_hash,
            committed_nonempty_lines,
            state: committed_state,
        },
        effective_state,
    })
}

pub(super) fn parse_jsonl_cold(
    path: &std::path::Path,
    tool: &str,
    claude_projects: &std::collections::HashMap<String, String>,
) -> Option<SavedSession> {
    let stamp = file_stamp(path);
    let file = std::fs::File::open(path).ok()?;
    let init = TranscriptState::new(path, tool)?;
    let outcome = scan_jsonl_from(file, 0, init, 0)?;
    outcome
        .effective_state
        .finish(path, claude_projects, stamp.as_ref())
}

/// Cache a stable parse with incremental byte-offset resumption on append.
/// `None` from an unreadable file (`File::open` error) is never persisted so a
/// temporary sharing/permission error is retried on the next scan.
pub(super) fn parse_session_cached(
    cache: &mut SessionParseCache,
    path: &std::path::Path,
    tool: &str,
    claude_project_map: &std::collections::HashMap<String, String>,
) -> Option<SavedSession> {
    let Some(before) = file_stamp(path) else {
        if cache.entries.remove(path).is_some()
            | cache.rejected.remove(path).is_some()
            | cache.partial.remove(path).is_some()
        {
            cache.dirty = true;
        }
        return None;
    };

    // 1. Exact stamp hit on accepted session -> 0 file opens / 0 bytes read.
    if let Some(hit) = cache.entries.get(path) {
        if hit.stamp == before && hit.session.tool == tool {
            return Some(hit.session.clone());
        }
    }
    // 2. Exact stamp hit on permanently rejected session (e.g. Codex subagent/exec).
    if let Some(rej) = cache.rejected.get(path) {
        if rej.stamp == before {
            return None;
        }
    }
    // 3. Exact stamp hit on partial/empty session (e.g. compaction with 0 user turns).
    if let Some(part) = cache.partial.get(path) {
        if part.stamp == before && part.checkpoint.state.matches_tool(tool) {
            return None;
        }
    }

    // Hermes flat `.json` files are single JSON documents (rewritten in place, not JSONL).
    if tool == "hermes" {
        cache.entries.remove(path);
        cache.rejected.remove(path);
        cache.partial.remove(path);
        let session = parse_hermes_json(path)?;
        if file_stamp(path).as_ref() == Some(&before) {
            cache.entries.insert(
                path.to_path_buf(),
                CachedSession {
                    stamp: before,
                    session: session.clone(),
                    checkpoint: None,
                },
            );
            cache.dirty = true;
        }
        return Some(session);
    }

    // Check if we have a valid incremental checkpoint (from either `entries` or `partial`)
    // whose inode/head/tail anchors confirm an append-only growth.
    let prior_cp: Option<(SessionFileStamp, IncrementalCheckpoint)> = cache
        .entries
        .get(path)
        .and_then(|e| e.checkpoint.as_ref().map(|cp| (e.stamp.clone(), cp.clone())))
        .or_else(|| {
            cache
                .partial
                .get(path)
                .map(|p| (p.stamp.clone(), p.checkpoint.clone()))
        });

    cache.entries.remove(path);
    cache.rejected.remove(path);
    cache.partial.remove(path);

    let mut file = std::fs::File::open(path).ok()?;
    let can_resume = prior_cp.as_ref().and_then(|(old_stamp, cp)| {
        #[cfg(unix)]
        if old_stamp.identity != before.identity {
            return None;
        }
        let _ = old_stamp;
        if !cp.state.matches_tool(tool)
            || cp.committed_offset == 0
            || before.size < cp.committed_offset
        {
            return None;
        }
        verify_anchors(&mut file, cp).then(|| cp.clone())
    });

    let outcome = if let Some(cp) = can_resume {
        scan_jsonl_from(file, cp.committed_offset, cp.state, cp.committed_nonempty_lines)?
    } else {
        let init = TranscriptState::new(path, tool)?;
        scan_jsonl_from(file, 0, init, 0)?
    };

    let session = outcome
        .effective_state
        .finish(path, claude_project_map, Some(&before));

    // Only commit to cache if the file did not concurrently mutate mid-read.
    if file_stamp(path).as_ref() == Some(&before) {
        match &session {
            Some(sess) => {
                cache.entries.insert(
                    path.to_path_buf(),
                    CachedSession {
                        stamp: before,
                        session: sess.clone(),
                        checkpoint: Some(outcome.checkpoint),
                    },
                );
                cache.dirty = true;
            }
            None => {
                if outcome.effective_state.is_permanently_rejected() {
                    cache
                        .rejected
                        .insert(path.to_path_buf(), RejectedSession { stamp: before });
                    cache.dirty = true;
                } else if before.size > 0 {
                    cache.partial.insert(
                        path.to_path_buf(),
                        PartialSession {
                            stamp: before,
                            checkpoint: outcome.checkpoint,
                        },
                    );
                    cache.dirty = true;
                }
            }
        }
    }

    session
}
