//! dsh 子进程执行：启动 `dsh plugin` 进程并等待退出，输出逐行转发为事件。
//!
//! Windows 打包版是 GUI 进程（无控制台），直接以 CREATE_NO_WINDOW 启动会让
//! dsh 派生的子进程各建可见控制台窗口（黑窗闪烁），因此复用
//! `service/workflow/win_spawn` 的隐藏控制台方案并额外跟踪进程句柄以等待退出；
//! Unix 上直接以管道捕获标准输出/错误。

use serde::Serialize;
use std::collections::HashMap;
use std::ffi::OsString;
use std::io::{BufRead, BufReader, Read};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{Emitter, Webview};

#[cfg(windows)]
use crate::service::workflow;
#[cfg(not(windows))]
use std::process::{Command, Stdio};

/// 前端监听的控制台事件名（进程输出行）
pub(crate) const PREINSTALL_LOG_EVENT: &str = "preinstall-log";

/// 进程输出行事件载荷
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreinstallLogPayload {
    pub line: String,
}

/// 当前正在运行的 `dsh plugin` 子进程 PID（无进行中安装时为 None）。
///
/// `cancel`（跨平台）用它结束安装进程树；安装结束/失败后必须复位，
/// 防止把「下一个安装」或无关进程误杀。
///
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub(crate) struct ProcessOwner(u64);

static NEXT_PROCESS_OWNER: AtomicU64 = AtomicU64::new(1);
static ACTIVE_PLUGIN_PIDS: OnceLock<Mutex<HashMap<ProcessOwner, u32>>> = OnceLock::new();
static PLUGIN_PROCESS_LOCK: OnceLock<Arc<tokio::sync::Mutex<()>>> = OnceLock::new();
static PLUGIN_OPERATION_LOCK: OnceLock<Arc<tokio::sync::Mutex<()>>> = OnceLock::new();
static PLUGIN_CLEANUP_FAILURE: OnceLock<
    tokio::sync::watch::Sender<Option<(ProcessOwner, String)>>,
> = OnceLock::new();

fn active_pid_lock() -> &'static Mutex<HashMap<ProcessOwner, u32>> {
    ACTIVE_PLUGIN_PIDS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cleanup_failure_sender() -> &'static tokio::sync::watch::Sender<Option<(ProcessOwner, String)>> {
    PLUGIN_CLEANUP_FAILURE.get_or_init(|| tokio::sync::watch::channel(None).0)
}

pub(crate) fn new_process_owner() -> ProcessOwner {
    ProcessOwner(NEXT_PROCESS_OWNER.fetch_add(1, Ordering::Relaxed))
}

pub(crate) fn active_plugin_pid(owner: ProcessOwner) -> Option<u32> {
    active_pid_lock()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(&owner)
        .copied()
}

pub(crate) fn active_plugin_processes() -> Vec<(ProcessOwner, u32)> {
    active_pid_lock()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .map(|(owner, pid)| (*owner, *pid))
        .collect()
}

#[cfg(windows)]
pub(crate) fn plugin_process_has_exited(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, WaitForSingleObject, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    const SYNCHRONIZE_ACCESS: u32 = 0x0010_0000;
    let handle = unsafe {
        OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE_ACCESS,
            0,
            pid,
        )
    };
    if handle.is_null() {
        return std::io::Error::last_os_error().raw_os_error() == Some(87);
    }
    let wait = unsafe { WaitForSingleObject(handle, 0) };
    unsafe { CloseHandle(handle) };
    wait == 0
}

#[cfg(not(windows))]
pub(crate) fn plugin_process_has_exited(pid: u32) -> bool {
    let mut status = 0;
    let waited = unsafe { libc::waitpid(pid as libc::pid_t, &mut status, libc::WNOHANG) };
    if waited == pid as libc::pid_t {
        return true;
    }
    if waited == 0 {
        return false;
    }
    let result = unsafe { libc::kill(pid as libc::pid_t, 0) };
    result != 0 && std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH)
}

pub(crate) fn mark_process_cleanup_failed(owner: ProcessOwner, reason: String) {
    cleanup_failure_sender().send_replace(Some((owner, reason)));
}

pub(crate) fn clear_process_cleanup_failed(owner: ProcessOwner) {
    cleanup_failure_sender().send_if_modified(|failure| {
        if failure.as_ref().is_some_and(|(active, _)| *active == owner) {
            *failure = None;
            true
        } else {
            false
        }
    });
}

pub(crate) fn release_process_cleanup(
    owner: ProcessOwner,
    pid_guard: PidGuard,
    process_guard: tokio::sync::OwnedMutexGuard<()>,
) {
    clear_process_cleanup_failed(owner);
    drop(pid_guard);
    drop(process_guard);
}

pub(crate) async fn acquire_process_lock() -> Result<tokio::sync::OwnedMutexGuard<()>, String> {
    let lock = PLUGIN_PROCESS_LOCK
        .get_or_init(|| Arc::new(tokio::sync::Mutex::new(())))
        .clone();
    let mut cleanup_failure = cleanup_failure_sender().subscribe();
    loop {
        if let Some((_, reason)) = cleanup_failure.borrow().as_ref() {
            return Err(reason.clone());
        }
        tokio::select! {
            guard = lock.clone().lock_owned() => {
                if let Some((_, reason)) = cleanup_failure.borrow().as_ref() {
                    drop(guard);
                    return Err(reason.clone());
                }
                return Ok(guard);
            }
            changed = cleanup_failure.changed() => {
                if changed.is_err() {
                    return Err(
                        "PLUGIN_PROCESS_COORDINATOR_DROPPED: cleanup coordinator ended unexpectedly"
                            .to_string(),
                    );
                }
            }
        }
    }
}

pub(crate) async fn acquire_operation_lock() -> tokio::sync::OwnedMutexGuard<()> {
    PLUGIN_OPERATION_LOCK
        .get_or_init(|| Arc::new(tokio::sync::Mutex::new(())))
        .clone()
        .lock_owned()
        .await
}

/// 记录/清除当前安装进程 PID（guard-drop 模式，作用域结束自动复位）。
pub(crate) struct PidGuard {
    owner: ProcessOwner,
    pid: u32,
}

impl PidGuard {
    pub(crate) fn set(owner: ProcessOwner, pid: u32) -> Self {
        active_pid_lock()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(owner, pid);
        Self { owner, pid }
    }
}

impl Drop for PidGuard {
    fn drop(&mut self) {
        let mut active = active_pid_lock().lock().unwrap_or_else(|e| e.into_inner());
        if active.get(&self.owner) == Some(&self.pid) {
            active.remove(&self.owner);
        }
    }
}

/// Windows 进程句柄包装：原始句柄是 `*mut c_void`（非 Send），
/// 但 `WaitForSingleObject`/`GetExitCodeProcess` 均为线程安全的系统调用，
/// 包一层以安全地移入 `spawn_blocking` 等待进程退出。
#[cfg(windows)]
struct WaitableHandle(windows_sys::Win32::Foundation::HANDLE);

#[cfg(windows)]
unsafe impl Send for WaitableHandle {}

/// 启动 `dsh plugin` 进程并等待结束，返回 `(退出码, 捕获的完整输出)`。
///
/// 输出仍然逐行实时转发为 `preinstall-log` 事件（供前端进度反馈），同时把
/// 全部行追加进共享缓冲区并返回——安装失败时 pnpm 会在错误里印出
/// `allowBuilds:` 允许键（git depPath / 被忽略的构建包名），调用方需要这段
/// 文本去解析并重试。
pub(crate) async fn run_plugin_process(
    node: &Path,
    args: &[OsString],
    cwd: &Path,
    envs: &HashMap<String, String>,
    window: &Webview,
    owner: ProcessOwner,
) -> Result<(i32, String), String> {
    let process_guard = acquire_process_lock().await?;
    let captured = Arc::new(Mutex::new(String::new()));

    #[cfg(windows)]
    {
        let (stdout, stderr, pid, handle) =
            workflow::win_spawn::spawn_with_hidden_console_owned(node, args, Some(cwd), envs)
                .map_err(|e| format!("PREINSTALL_SPAWN: {e}"))?;
        let pid_guard = PidGuard::set(owner, pid);
        log::info!("dsh plugin install started, pid {pid}");

        spawn_line_emitter(stdout, window.clone(), captured.clone());
        spawn_line_emitter(stderr, window.clone(), captured.clone());

        let handle = WaitableHandle(handle);
        let exit_code = tauri::async_runtime::spawn_blocking(move || {
            let _process_guard = process_guard;
            let _pid_guard = pid_guard;
            use windows_sys::Win32::Foundation::CloseHandle;
            use windows_sys::Win32::System::Threading::{
                GetExitCodeProcess, WaitForSingleObject, INFINITE,
            };
            let handle = handle;
            unsafe {
                let wait = WaitForSingleObject(handle.0, INFINITE);
                let mut code: u32 = 0;
                if GetExitCodeProcess(handle.0, &mut code) == 0 {
                    code = wait;
                }
                CloseHandle(handle.0);
                code as i32
            }
        })
        .await
        .map_err(|e| format!("PREINSTALL_WAIT: {e}"))?;

        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        Ok((exit_code, drain_captured(captured)))
    }

    #[cfg(not(windows))]
    {
        use std::os::unix::process::CommandExt;
        let mut child = Command::new(node)
            .args(args)
            .envs(envs)
            .current_dir(cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            // 独立进程组：取消时可用 `kill(-pid, ...)` 一次结束整棵安装进程树
            .process_group(0)
            .spawn()
            .map_err(|e| format!("PREINSTALL_SPAWN: {e}"))?;

        let pid = child.id();
        let pid_guard = PidGuard::set(owner, pid);
        // 绑定守卫实例：本 cfg 块作用域结束时自动把共享 PID 槽复位为 None，
        // 避免把「这一次安装」的 PID 泄漏给之后的取消/下一次安装（误杀无关进程）。
        // 若 spawn_blocking 因错误提前 `?` 返回，守卫同样会 Drop 复位。
        log::info!("dsh plugin install started, pid {pid}");

        if let Some(stdout) = child.stdout.take() {
            spawn_line_emitter(stdout, window.clone(), captured.clone());
        }
        if let Some(stderr) = child.stderr.take() {
            spawn_line_emitter(stderr, window.clone(), captured.clone());
        }

        let exit_code = tauri::async_runtime::spawn_blocking(move || {
            let _process_guard = process_guard;
            let _pid_guard = pid_guard;
            child.wait().map(|s| s.code().unwrap_or(1)).unwrap_or(1)
        })
        .await
        .map_err(|e| format!("PREINSTALL_WAIT: {e}"))?;

        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        Ok((exit_code, drain_captured(captured)))
    }
}

/// 取出（并清空）共享缓冲区中的全部捕获输出。
fn drain_captured(captured: Arc<Mutex<String>>) -> String {
    captured
        .lock()
        .map(|mut buf| std::mem::take(&mut *buf))
        .unwrap_or_default()
}

/// 在独立线程中逐行读取进程输出：实时通过 `preinstall-log` 事件转发，
/// 同时追加进共享缓冲区。
/// 使用静态泛型约束 `R: Read + Send + 'static` 避免动态派发（Box<dyn Read>）堆分配。
fn spawn_line_emitter<R: Read + Send + 'static>(
    reader: R,
    window: Webview,
    captured: Arc<Mutex<String>>,
) {
    std::thread::spawn(move || {
        let mut buf = BufReader::new(reader);
        let mut acc_buf = Vec::new();
        loop {
            acc_buf.clear();
            match buf.read_until(b'\n', &mut acc_buf) {
                Ok(0) => break,
                Ok(_) => {
                    // lossy 兜底：zh-CN Windows 下 python MCP 插件输出 GBK 日志时，
                    // 严格 UTF-8 读取会中断本线程并关闭子进程管道（EPIPE）——
                    // 安装进程可能因此以非 0 退出码失败，被误判为安装失败。
                    // 行尾剥离与上游 utils.rs 的 #197 修复一致：只剥 \r\n/\n，
                    // 保留行内尾随空白以对齐 BufRead::lines() 语义。
                    let line = String::from_utf8_lossy(&acc_buf);
                    let trimmed = line
                        .strip_suffix("\r\n")
                        .or_else(|| line.strip_suffix('\n'))
                        .unwrap_or(&line)
                        .to_string();
                    let _ = window.emit(
                        PREINSTALL_LOG_EVENT,
                        PreinstallLogPayload {
                            line: trimmed.clone(),
                        },
                    );
                    if let Ok(mut acc) = captured.lock() {
                        acc.push_str(&trimmed);
                        acc.push('\n');
                    }
                }
                Err(e) => {
                    log::error!("Failed to read plugin process output: {}", e);
                    break;
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stale_guard_cannot_clear_a_new_process_for_the_same_owner() {
        let owner = new_process_owner();
        let stale = PidGuard::set(owner, 100);
        let current = PidGuard::set(owner, 200);

        drop(stale);
        assert_eq!(active_plugin_pid(owner), Some(200));

        drop(current);
        assert_eq!(active_plugin_pid(owner), None);
    }

    #[tokio::test]
    async fn cleanup_failure_clears_before_lock_handoff_and_preserves_other_owner() {
        let guard = acquire_process_lock().await.unwrap();
        let owner = new_process_owner();
        let pid_guard = PidGuard::set(owner, 100);
        let reason = "PLUGIN_PROCESS_CLEANUP_FAILED: test process is still active".to_string();
        mark_process_cleanup_failed(owner, reason.clone());

        let waiter = tokio::spawn(acquire_process_lock());
        tokio::task::yield_now().await;
        assert!(
            waiter.is_finished(),
            "active cleanup failure should wake a queued waiter"
        );
        assert_eq!(waiter.await.unwrap().unwrap_err(), reason);

        clear_process_cleanup_failed(owner);
        let handoff = tokio::spawn(acquire_process_lock());
        tokio::task::yield_now().await;
        assert!(
            !handoff.is_finished(),
            "waiter should queue after failure clears while guard remains held"
        );
        drop(pid_guard);
        drop(guard);
        assert!(handoff.await.unwrap().is_ok());
        assert_eq!(active_plugin_pid(owner), None);

        let guard = acquire_process_lock().await.unwrap();
        let other_owner = new_process_owner();
        let stale_pid_guard = PidGuard::set(owner, 101);
        let other_reason =
            "PLUGIN_PROCESS_CLEANUP_FAILED: another owner is still active".to_string();
        mark_process_cleanup_failed(other_owner, other_reason.clone());
        release_process_cleanup(owner, stale_pid_guard, guard);

        assert_eq!(
            acquire_process_lock().await.unwrap_err(),
            other_reason,
            "clearing a stale owner must not remove another owner's failure"
        );
        clear_process_cleanup_failed(other_owner);
    }
}
