use serde::{Deserialize, Serialize};
use tauri::{LogicalPosition, LogicalSize, Rect, Url};

pub const CHAT_URL: &str = "https://chat.deepseek.com/";
pub const CHAT_LABEL_PREFIX: &str = "official-chat-";

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DesktopMode {
    #[default]
    Harness,
    Chat,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ChatPhase {
    #[default]
    Idle,
    Loading,
    Ready,
    Failed,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct ChatSnapshot {
    pub phase: ChatPhase,
    pub error: Option<String>,
    pub generation: u64,
}

impl ChatSnapshot {
    pub fn begin(&mut self) {
        self.generation += 1;
        self.phase = ChatPhase::Loading;
        self.error = None;
    }

    pub fn settle(&mut self, generation: u64, error: Option<String>) -> bool {
        if self.generation != generation || self.phase != ChatPhase::Loading {
            return false;
        }
        self.phase = if error.is_some() {
            ChatPhase::Failed
        } else {
            ChatPhase::Ready
        };
        self.error = error;
        true
    }
}

#[derive(Clone, Copy, Debug, Deserialize)]
pub struct ChatBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl ChatBounds {
    pub fn validate(self) -> Result<Self, String> {
        if [self.x, self.y, self.width, self.height]
            .iter()
            .any(|v| !v.is_finite() || *v < 0.0)
            || self.width > 32_768.0
            || self.height > 32_768.0
        {
            return Err(
                "CHAT_BOUNDS_INVALID: expected finite non-negative window coordinates".into(),
            );
        }
        Ok(self)
    }

    pub fn visible(self) -> bool {
        self.width >= 1.0 && self.height >= 1.0
    }

    pub fn rect(self) -> Rect {
        Rect {
            position: LogicalPosition::new(self.x, self.y).into(),
            size: LogicalSize::new(self.width.max(1.0), self.height.max(1.0)).into(),
        }
    }
}

pub fn is_chat_label(label: &str) -> bool {
    label.starts_with(CHAT_LABEL_PREFIX)
}

pub fn allowed_navigation(url: &Url, target: &Url) -> bool {
    url.origin() == target.origin() && url.username().is_empty() && url.password().is_none()
}

pub fn external_web_url(url: &Url) -> bool {
    matches!(url.scheme(), "https" | "http")
        && url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none()
}

pub fn target_url() -> Url {
    #[cfg(debug_assertions)]
    if let Ok(value) = std::env::var("DSH_CHAT_TEST_URL") {
        if let Ok(url) = Url::parse(&value) {
            if url.scheme() == "http" && url.host_str() == Some("127.0.0.1") {
                return url;
            }
        }
    }
    Url::parse(CHAT_URL).expect("fixed Chat URL")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chat_navigation_accepts_only_exact_origin_without_credentials() {
        let target = Url::parse(CHAT_URL).unwrap();
        for value in [
            CHAT_URL,
            "https://chat.deepseek.com/a/chat/s/123",
            "https://chat.deepseek.com:443/sign_in",
        ] {
            assert!(allowed_navigation(&Url::parse(value).unwrap(), &target));
        }
        for value in [
            "http://chat.deepseek.com",
            "https://chat.deepseek.com:444",
            "https://chat.deepseek.com.evil.test",
            "https://user@chat.deepseek.com",
            "https://deepseek.com",
            "file:///tmp/test",
            "javascript:alert(1)",
            "http://127.0.0.1:3080",
        ] {
            assert!(
                !allowed_navigation(&Url::parse(value).unwrap(), &target),
                "{value}"
            );
        }
    }

    #[test]
    fn browser_links_reject_active_and_privileged_schemes() {
        assert!(external_web_url(
            &Url::parse("https://example.com").unwrap()
        ));
        for value in [
            "file:///tmp/test",
            "javascript:alert(1)",
            "tauri://localhost",
            "https://user:pass@example.com",
        ] {
            assert!(!external_web_url(&Url::parse(value).unwrap()));
        }
    }

    #[test]
    fn old_callbacks_cannot_revive_failed_or_recreated_views() {
        let mut state = ChatSnapshot::default();
        state.begin();
        let old = state.generation;
        state.begin();
        assert!(!state.settle(old, None));
        assert!(state.settle(state.generation, Some("offline".into())));
        assert!(!state.settle(state.generation, None));
        assert_eq!(state.phase, ChatPhase::Failed);
    }

    #[test]
    fn bounds_reject_invalid_values_and_allow_hidden_layouts() {
        let bounds = ChatBounds {
            x: 0.0,
            y: 52.0,
            width: 1280.0,
            height: 788.0,
        };
        assert!(bounds.validate().unwrap().visible());
        assert!(!ChatBounds {
            width: 0.0,
            ..bounds
        }
        .validate()
        .unwrap()
        .visible());
        assert!(ChatBounds {
            y: f64::NAN,
            ..bounds
        }
        .validate()
        .is_err());
        assert!(ChatBounds {
            height: -1.0,
            ..bounds
        }
        .validate()
        .is_err());
        assert!(ChatBounds {
            width: f64::INFINITY,
            ..bounds
        }
        .validate()
        .is_err());
    }
}
