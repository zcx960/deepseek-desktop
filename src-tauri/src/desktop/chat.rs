use super::chat_policy::{self, ChatBounds, ChatPhase, ChatSnapshot, DesktopMode};
use super::chat_profile;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use tauri::webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, State, Webview, WebviewUrl,
};
use tauri_plugin_opener::OpenerExt;

#[derive(Clone, Default)]
struct Surface {
    selected: bool,
    occluded: bool,
    bounds: Option<ChatBounds>,
    snapshot: ChatSnapshot,
}

#[derive(Default)]
pub struct ChatManager {
    operation: tokio::sync::Mutex<()>,
    blanked: Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>>,
    surfaces: Mutex<HashMap<String, Surface>>,
}

impl ChatManager {
    fn surface(&self, owner: &str) -> Surface {
        self.surfaces
            .lock()
            .unwrap()
            .get(owner)
            .cloned()
            .unwrap_or_default()
    }

    fn update(&self, owner: &str, update: impl FnOnce(&mut Surface)) -> Surface {
        let mut surfaces = self.surfaces.lock().unwrap();
        let surface = surfaces.entry(owner.to_owned()).or_default();
        update(surface);
        surface.clone()
    }
}

fn label(owner: &str) -> String {
    format!("{}{owner}", chat_policy::CHAT_LABEL_PREFIX)
}

fn shell_owner(webview: &Webview) -> Result<String, String> {
    let owner = webview.label();
    if owner == "main" || owner.starts_with("window-") {
        Ok(owner.to_owned())
    } else {
        Err("CHAT_FORBIDDEN: only the local desktop shell can control Chat".into())
    }
}

fn publish(app: &AppHandle, owner: &str, snapshot: &ChatSnapshot) {
    if let Some(shell) = app.get_webview(owner) {
        let _ = shell.emit_to(
            tauri::EventTarget::Webview {
                label: owner.to_owned(),
            },
            "dsh-chat-status",
            snapshot,
        );
    }
}

fn apply_visibility(app: &AppHandle, owner: &str) -> Result<(), String> {
    let surface = app.state::<ChatManager>().surface(owner);
    let Some(view) = app.get_webview(&label(owner)) else {
        return Ok(());
    };
    let visible = surface.selected
        && !surface.occluded
        && surface.snapshot.phase == ChatPhase::Ready
        && surface.bounds.is_some_and(ChatBounds::visible);
    if visible {
        view.set_bounds(surface.bounds.unwrap().rect())
            .map_err(|e| format!("CHAT_LAYOUT_FAILED: {e}"))?;
        view.show().map_err(|e| format!("CHAT_SHOW_FAILED: {e}"))?;
    } else {
        view.hide().map_err(|e| format!("CHAT_HIDE_FAILED: {e}"))?;
    }
    Ok(())
}

fn settle(app: &AppHandle, owner: &str, generation: u64, error: Option<String>) {
    let manager = app.state::<ChatManager>();
    let snapshot = {
        let mut surfaces = manager.surfaces.lock().unwrap();
        let Some(surface) = surfaces.get_mut(owner) else {
            return;
        };
        if !surface.snapshot.settle(generation, error) {
            return;
        }
        surface.snapshot.clone()
    };
    if let Err(error) = apply_visibility(app, owner) {
        let surface = manager.update(owner, |s| {
            s.snapshot.phase = ChatPhase::Failed;
            s.snapshot.error = Some(error);
        });
        publish(app, owner, &surface.snapshot);
    } else {
        publish(app, owner, &snapshot);
    }
}

fn open_external(app: &AppHandle, url: &tauri::Url) {
    if chat_policy::external_web_url(url) {
        if let Err(error) = app.opener().open_url(url.as_str(), None::<&str>) {
            log::warn!("CHAT_BROWSER_FAILED: {error}");
        }
    }
}

async fn ensure_view(app: &AppHandle, owner: &str) -> Result<ChatSnapshot, String> {
    if app.get_webview(&label(owner)).is_some() {
        apply_visibility(app, owner)?;
        return Ok(app.state::<ChatManager>().surface(owner).snapshot);
    }
    let surface = app
        .state::<ChatManager>()
        .update(owner, |s| s.snapshot.begin());
    let generation = surface.snapshot.generation;
    publish(app, owner, &surface.snapshot);
    let result = create_view(app, owner, generation);
    if let Err(error) = result {
        settle(app, owner, generation, Some(error));
    } else {
        let app = app.clone();
        let owner = owner.to_owned();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_secs(45)).await;
            settle(
                &app,
                &owner,
                generation,
                Some("CHAT_LOAD_TIMEOUT: the official website did not finish loading".into()),
            );
        });
    }
    Ok(app.state::<ChatManager>().surface(owner).snapshot)
}

fn create_view(app: &AppHandle, owner: &str, generation: u64) -> Result<(), String> {
    chat_profile::ensure_supported()?;
    let window = app
        .get_window(owner)
        .ok_or("CHAT_WINDOW_MISSING: desktop window was closed")?;
    let epoch = chat_profile::epoch(app)?;
    let target = chat_policy::target_url();
    let navigation_target = target.clone();
    let navigation_app = app.clone();
    let popup_target = target.clone();
    let popup_app = app.clone();
    let popup_label = label(owner);
    let page_owner = owner.to_owned();
    let page_target = target.clone();
    let builder = WebviewBuilder::new(label(owner), WebviewUrl::External(target))
        .focused(false)
        .disable_drag_drop_handler()
        .on_navigation(move |url| {
            if url.as_str() == "about:blank"
                || chat_policy::allowed_navigation(url, &navigation_target)
            {
                true
            } else {
                open_external(&navigation_app, url);
                false
            }
        })
        .on_new_window(move |url, _| {
            if chat_policy::allowed_navigation(&url, &popup_target) {
                if let Some(view) = popup_app.get_webview(&popup_label) {
                    let _ = view.navigate(url);
                }
            } else {
                open_external(&popup_app, &url);
            }
            NewWindowResponse::Deny
        })
        .on_page_load(move |view, payload| {
            if payload.event() == PageLoadEvent::Finished && payload.url().as_str() == "about:blank"
            {
                if let Some(sender) = view
                    .app_handle()
                    .state::<ChatManager>()
                    .blanked
                    .lock()
                    .unwrap()
                    .remove(&page_owner)
                {
                    let _ = sender.send(());
                }
                return;
            }
            if payload.event() == PageLoadEvent::Finished
                && chat_policy::allowed_navigation(payload.url(), &page_target)
            {
                settle(view.app_handle(), &page_owner, generation, None);
            }
        });
    #[cfg(target_os = "macos")]
    let builder = builder.data_store_identifier(chat_profile::identifier(app, epoch)?);
    #[cfg(not(target_os = "macos"))]
    let builder = builder.data_directory(chat_profile::directory(app, epoch)?);

    let size = window
        .inner_size()
        .map_err(|e| format!("CHAT_LAYOUT_FAILED: {e}"))?
        .to_logical::<f64>(
            window
                .scale_factor()
                .map_err(|e| format!("CHAT_LAYOUT_FAILED: {e}"))?,
        );
    let bounds = app
        .state::<ChatManager>()
        .surface(owner)
        .bounds
        .unwrap_or(ChatBounds {
            x: 0.0,
            y: super::builder::SHELL_NAV_HEIGHT as f64,
            width: size.width,
            height: (size.height - super::builder::SHELL_NAV_HEIGHT as f64).max(1.0),
        });
    // 初次加载即使用内容区尺寸，避免网页按 1px 视口初始化响应式布局或滚动位置。
    let view = window
        .add_child(
            builder,
            LogicalPosition::new(-10_000.0, -10_000.0),
            LogicalSize::new(bounds.width.max(1.0), bounds.height.max(1.0)),
        )
        .map_err(|e| format!("CHAT_CREATE_FAILED: {e}"))?;
    view.hide().map_err(|e| format!("CHAT_HIDE_FAILED: {e}"))?;
    apply_visibility(app, owner)
}

async fn blank_view(app: &AppHandle, owner: &str) -> Result<(), String> {
    let Some(view) = app.get_webview(&label(owner)) else {
        return Ok(());
    };
    view.hide().map_err(|e| format!("CHAT_HIDE_FAILED: {e}"))?;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.state::<ChatManager>()
        .blanked
        .lock()
        .unwrap()
        .insert(owner.to_owned(), sender);
    view.navigate(tauri::Url::parse("about:blank").expect("blank URL"))
        .map_err(|e| format!("CHAT_CLEAR_FAILED: {e}"))?;
    let result = tokio::time::timeout(Duration::from_secs(10), receiver).await;
    app.state::<ChatManager>()
        .blanked
        .lock()
        .unwrap()
        .remove(owner);
    result
        .map_err(|_| "CHAT_CLEAR_FAILED: Chat did not stop its page")?
        .map_err(|_| "CHAT_CLEAR_FAILED: Chat page closed before acknowledgement".to_string())
}

async fn close_view(app: &AppHandle, owner: &str) -> Result<(), String> {
    if let Some(view) = app.get_webview(&label(owner)) {
        view.hide().map_err(|e| format!("CHAT_HIDE_FAILED: {e}"))?;
        view.close()
            .map_err(|e| format!("CHAT_CLOSE_FAILED: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn desktop_chat_select(
    app: AppHandle,
    webview: Webview,
    state: State<'_, ChatManager>,
    mode: DesktopMode,
) -> Result<ChatSnapshot, String> {
    let owner = shell_owner(&webview)?;
    let _operation = state.operation.lock().await;
    state.update(&owner, |s| s.selected = mode == DesktopMode::Chat);
    if mode == DesktopMode::Chat {
        let snapshot = ensure_view(&app, &owner).await?;
        if snapshot.phase == ChatPhase::Ready {
            if let Some(view) = app.get_webview(&label(&owner)) {
                if !state.surface(&owner).occluded {
                    let _ = view.set_focus();
                }
            }
        }
        Ok(snapshot)
    } else {
        apply_visibility(&app, &owner)?;
        webview
            .set_focus()
            .map_err(|e| format!("CHAT_FOCUS_FAILED: {e}"))?;
        Ok(state.surface(&owner).snapshot)
    }
}

#[tauri::command]
pub async fn desktop_chat_status(
    webview: Webview,
    state: State<'_, ChatManager>,
) -> Result<ChatSnapshot, String> {
    Ok(state.surface(&shell_owner(&webview)?).snapshot)
}

#[tauri::command]
pub async fn desktop_chat_layout(
    app: AppHandle,
    webview: Webview,
    state: State<'_, ChatManager>,
    bounds: ChatBounds,
    occluded: bool,
) -> Result<(), String> {
    let owner = shell_owner(&webview)?;
    let bounds = bounds.validate()?;
    let _operation = state.operation.lock().await;
    state.update(&owner, |s| {
        s.bounds = Some(bounds);
        s.occluded = occluded;
    });
    apply_visibility(&app, &owner)
}

#[tauri::command]
pub async fn desktop_chat_retry(
    app: AppHandle,
    webview: Webview,
    state: State<'_, ChatManager>,
) -> Result<ChatSnapshot, String> {
    let owner = shell_owner(&webview)?;
    let _operation = state.operation.lock().await;
    state.update(&owner, |s| {
        s.snapshot.generation += 1;
        s.snapshot.phase = ChatPhase::Idle;
    });
    blank_view(&app, &owner).await?;
    close_view(&app, &owner).await?;
    ensure_view(&app, &owner).await
}

#[tauri::command]
pub async fn desktop_chat_clear(
    app: AppHandle,
    webview: Webview,
    state: State<'_, ChatManager>,
) -> Result<ChatSnapshot, String> {
    let owner = shell_owner(&webview)?;
    let _operation = state.operation.lock().await;
    chat_profile::ensure_supported()?;
    let epoch = chat_profile::epoch(&app)?;
    let owners: Vec<String> = state.surfaces.lock().unwrap().keys().cloned().collect();
    let result: Result<(), String> = async {
        for owner in &owners {
            let surface = state.update(owner, |s| {
                s.snapshot.generation += 1;
                s.snapshot.phase = ChatPhase::Idle;
                s.snapshot.error = None;
            });
            publish(&app, owner, &surface.snapshot);
            blank_view(&app, owner).await?;
        }
        for owner in &owners {
            close_view(&app, owner).await?;
        }
        chat_profile::remove(&app, epoch).await?;
        for owner in &owners {
            if state.surface(owner).selected {
                ensure_view(&app, owner).await?;
            }
        }
        Ok(())
    }
    .await;
    if let Err(error) = result {
        log::warn!("{error}");
        for owner in &owners {
            let surface = state.update(owner, |s| {
                s.snapshot.phase = ChatPhase::Failed;
                s.snapshot.error = Some(error.clone());
            });
            let _ = apply_visibility(&app, owner);
            publish(&app, owner, &surface.snapshot);
        }
        return Err(error);
    }
    Ok(state.surface(&owner).snapshot)
}

#[tauri::command]
pub async fn desktop_chat_open_browser(app: AppHandle, webview: Webview) -> Result<(), String> {
    shell_owner(&webview)?;
    app.opener()
        .open_url(chat_policy::CHAT_URL, None::<&str>)
        .map_err(|e| format!("CHAT_BROWSER_FAILED: {e}"))
}

pub fn forget_window(app: &AppHandle, owner: &str) {
    app.state::<ChatManager>()
        .blanked
        .lock()
        .unwrap()
        .remove(owner);
    app.state::<ChatManager>()
        .surfaces
        .lock()
        .unwrap()
        .remove(owner);
}
