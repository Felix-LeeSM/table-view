use std::sync::{Mutex, Once};

use tokio::sync::OnceCell;

/// 우리 통합 테스트가 띄운 컨테이너를 식별하는 라벨 키. owner-pid 와 함께
/// 박아 두면 self-sweep 이 "내 컨테이너 / 남의 컨테이너" 를 구분할 수 있다.
pub(crate) const OWNED_LABEL: &str = "table-view.tests";
pub(crate) const OWNER_PID_LABEL: &str = "table-view.tests.owner-pid";

static SWEEP_DONE: OnceCell<()> = OnceCell::const_new();
static PROCESS_CLEANUP: ContainerCleanupRegistry = ContainerCleanupRegistry::new();
static PROCESS_CLEANUP_INSTALL: Once = Once::new();

pub(crate) fn current_pid_label() -> String {
    std::process::id().to_string()
}

pub(crate) fn remove_container_args(id: &str) -> [&str; 4] {
    ["rm", "-f", "-v", id]
}

pub(crate) struct ContainerCleanupRegistry {
    ids: Mutex<Vec<String>>,
}

impl ContainerCleanupRegistry {
    pub(crate) const fn new() -> Self {
        Self {
            ids: Mutex::new(Vec::new()),
        }
    }

    pub(crate) fn register(&self, id: impl Into<String>) {
        let id = id.into();
        if id.trim().is_empty() {
            return;
        }

        let mut ids = self.ids.lock().unwrap_or_else(|e| e.into_inner());
        if !ids.iter().any(|existing| existing == &id) {
            ids.push(id);
        }
    }

    pub(crate) fn cleanup_with<F>(&self, mut remove: F)
    where
        F: FnMut(&str),
    {
        let ids = {
            let mut ids = self.ids.lock().unwrap_or_else(|e| e.into_inner());
            std::mem::take(&mut *ids)
        };
        for id in ids {
            remove(&id);
        }
    }
}

pub(crate) fn register_container_for_process_cleanup(id: impl Into<String>) {
    install_process_cleanup();
    PROCESS_CLEANUP.register(id);
}

#[cfg(unix)]
unsafe extern "C" {
    fn atexit(callback: extern "C" fn()) -> std::ffi::c_int;
}

#[cfg(unix)]
fn install_process_cleanup() {
    PROCESS_CLEANUP_INSTALL.call_once(|| unsafe {
        let _ = atexit(cleanup_registered_containers_at_exit);
    });
}

#[cfg(not(unix))]
fn install_process_cleanup() {}

#[cfg(unix)]
extern "C" fn cleanup_registered_containers_at_exit() {
    cleanup_registered_containers_sync();
}

fn cleanup_registered_containers_sync() {
    PROCESS_CLEANUP.cleanup_with(|id| {
        let _ = std::process::Command::new("docker")
            .args(remove_container_args(id))
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    });
}

/// owner PID 가 죽은 우리 컨테이너만 `docker rm -f -v` 로 정리.
/// 살아있는 PID 의 컨테이너에는 손대지 않으므로 동시 실행 중인 다른
/// 테스트 binary 와 race-safe. `-v` 는 container-owned anonymous volume
/// 누적을 같이 막는다.
async fn sweep_dead_owners() {
    let listing = match tokio::process::Command::new("docker")
        .args([
            "ps",
            "-a",
            "--filter",
            &format!("label={}", OWNED_LABEL),
            "--format",
            &format!("{{{{.ID}}}}\t{{{{.Label \"{}\"}}}}", OWNER_PID_LABEL),
        ])
        .output()
        .await
    {
        Ok(o) if o.status.success() => o,
        _ => return,
    };
    let stdout = String::from_utf8_lossy(&listing.stdout);
    for line in stdout.lines() {
        let mut parts = line.splitn(2, '\t');
        let (Some(id), Some(pid_str)) = (parts.next(), parts.next()) else {
            continue;
        };
        let pid_str = pid_str.trim();
        if pid_str.is_empty() {
            continue;
        }
        let alive = tokio::process::Command::new("kill")
            .args(["-0", pid_str])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .await
            .map(|s| s.success())
            .unwrap_or(false);
        if !alive {
            let _ = tokio::process::Command::new("docker")
                .args(remove_container_args(id))
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status()
                .await;
        }
    }
}

pub(crate) async fn ensure_sweep_once() {
    SWEEP_DONE
        .get_or_init(|| async {
            sweep_dead_owners().await;
        })
        .await;
}
