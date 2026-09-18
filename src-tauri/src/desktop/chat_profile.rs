use sha2::{Digest, Sha256};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tauri_plugin_store::StoreExt;

const PROFILE_STORE: &str = if cfg!(debug_assertions) {
    ".chat.dev.dat"
} else {
    ".chat.dat"
};

pub fn epoch(app: &AppHandle) -> Result<u64, String> {
    let store = app
        .store(PROFILE_STORE)
        .map_err(|e| format!("CHAT_STORAGE_FAILED: {e}"))?;
    match store.get("epoch") {
        None => Ok(0),
        Some(value) => value
            .as_u64()
            .ok_or_else(|| "CHAT_STORAGE_FAILED: invalid profile generation".into()),
    }
}

pub fn advance(app: &AppHandle, old_epoch: u64) -> Result<(), String> {
    let next = old_epoch
        .checked_add(1)
        .ok_or("CHAT_STORAGE_FAILED: profile generation exhausted")?;
    let store = app
        .store(PROFILE_STORE)
        .map_err(|e| format!("CHAT_STORAGE_FAILED: {e}"))?;
    store.set("epoch", serde_json::json!(next));
    store
        .save()
        .map_err(|e| format!("CHAT_STORAGE_FAILED: {e}"))
}

pub fn directory(app: &AppHandle, epoch: u64) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("CHAT_STORAGE_FAILED: {e}"))?;
    let name = if cfg!(debug_assertions) {
        "chat-webview-dev"
    } else {
        "chat-webview"
    };
    Ok(root.join(name).join(format!("profile-{epoch}")))
}

pub fn identifier(app: &AppHandle, epoch: u64) -> Result<[u8; 16], String> {
    let hash = Sha256::digest(directory(app, epoch)?.to_string_lossy().as_bytes());
    let mut id: [u8; 16] = hash[..16].try_into().expect("SHA-256 prefix length");
    id[6] = (id[6] & 0x0f) | 0x40;
    id[8] = (id[8] & 0x3f) | 0x80;
    Ok(id)
}

pub fn ensure_supported() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use objc2_foundation::{NSOperatingSystemVersion, NSProcessInfo};
        if !NSProcessInfo::processInfo().isOperatingSystemAtLeastVersion(NSOperatingSystemVersion {
            majorVersion: 14,
            minorVersion: 0,
            patchVersion: 0,
        }) {
            return Err(
                "CHAT_UNSUPPORTED_OS: isolated persistent Chat requires macOS 14 or newer".into(),
            );
        }
    }
    Ok(())
}

pub async fn remove(app: &AppHandle, epoch: u64) -> Result<(), String> {
    ensure_supported()?;
    #[cfg(target_os = "macos")]
    {
        use block2::RcBlock;
        use objc2::MainThreadMarker;
        use objc2_foundation::{NSDate, NSUUID};
        use objc2_web_kit::WKWebsiteDataStore;
        use std::cell::RefCell;
        let id = identifier(app, epoch)?;
        let (sender, receiver) = tokio::sync::oneshot::channel();
        app.run_on_main_thread(move || {
            let mtm = MainThreadMarker::new().expect("Tauri main thread");
            let sender = RefCell::new(Some(sender));
            let completed = RcBlock::new(move || {
                if let Some(sender) = sender.borrow_mut().take() {
                    let _ = sender.send(());
                }
            });
            // wry 0.55 保留已关闭的 WKWebView；等待清空完成，再换独立存储代。
            unsafe {
                let store =
                    WKWebsiteDataStore::dataStoreForIdentifier(&NSUUID::from_bytes(id), mtm);
                let types = WKWebsiteDataStore::allWebsiteDataTypes(mtm);
                store.removeDataOfTypes_modifiedSince_completionHandler(
                    &types,
                    &NSDate::dateWithTimeIntervalSince1970(0.0),
                    &completed,
                );
            }
        })
        .map_err(|e| format!("CHAT_CLEAR_FAILED: {e}"))?;
        tokio::time::timeout(std::time::Duration::from_secs(15), receiver)
            .await
            .map_err(|_| "CHAT_CLEAR_FAILED: WebKit profile clearing timed out")?
            .map_err(|_| "CHAT_CLEAR_FAILED: WebKit profile clearing interrupted")?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let path = directory(app, epoch)?;
        for attempt in 0..10 {
            match tokio::fs::remove_dir_all(&path).await {
                Ok(()) => break,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => break,
                Err(e) if attempt == 9 => return Err(format!("CHAT_CLEAR_FAILED: {e}")),
                Err(_) => tokio::time::sleep(std::time::Duration::from_millis(200)).await,
            }
        }
    }
    advance(app, epoch)
}
