use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::path::BaseDirectory;
use tauri::{Manager, RunEvent, State};

/// Held in app state so the child can be killed when the app exits.
struct Sidecar(Mutex<Option<Child>>);

/// Port the backend was launched on (None when it could not be started).
struct BackendPort(Mutex<Option<u16>>);

/// Exposed to the webview so the SPA can talk to the backend on the right
/// port. Picking a free port instead of hardcoding one prevents collisions
/// when two instances of the app run side by side.
#[tauri::command]
fn backend_port(state: State<'_, BackendPort>) -> Option<u16> {
    *state.0.lock().ok()?
}

/// Ask the OS for a free localhost port (tiny race window, acceptable here).
fn pick_free_port() -> Option<u16> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).ok()?;
    let port = listener.local_addr().ok()?.port();
    drop(listener);
    Some(port)
}

#[cfg(windows)]
mod win_job {
    use std::io;
    use std::mem;

    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE,
    };

    /// Put the child in a job that is killed when this app exits, so the backend
    /// cannot outlive the app even on a crash or force-kill.
    pub fn kill_on_close(child_pid: u32) -> io::Result<()> {
        unsafe {
            let job = CreateJobObjectW(core::ptr::null(), core::ptr::null());
            if job.is_null() {
                return Err(io::Error::last_os_error());
            }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let ok = SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const _,
                mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            if ok == 0 {
                CloseHandle(job);
                return Err(io::Error::last_os_error());
            }
            let h = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, child_pid);
            if h.is_null() {
                CloseHandle(job);
                return Err(io::Error::last_os_error());
            }
            let ok = AssignProcessToJobObject(job, h);
            CloseHandle(h);
            if ok == 0 {
                CloseHandle(job);
                return Err(io::Error::last_os_error());
            }
            // `job` is intentionally leaked: it must stay open for the app's
            // lifetime. When the app exits the OS closes the handle and the
            // KILL_ON_JOB_CLOSE flag terminates the child.
        }
        Ok(())
    }
}

/// Poll the backend's /health endpoint until it responds or the timeout elapses.
fn wait_for_backend(port: u16, timeout: Duration) -> bool {
    let addr = format!("127.0.0.1:{port}");
    let start = Instant::now();
    while start.elapsed() < timeout {
        if let Ok(mut stream) = TcpStream::connect(&addr) {
            let _ = stream.set_read_timeout(Some(Duration::from_secs(1)));
            let _ = stream.set_write_timeout(Some(Duration::from_secs(1)));
            let req = b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n";
            if stream.write_all(req).is_ok() {
                // Read the whole response (small, but may arrive fragmented).
                let mut buf = Vec::with_capacity(4096);
                if stream.read_to_end(&mut buf).is_ok() && !buf.is_empty() {
                    if String::from_utf8_lossy(&buf).contains("200 OK") {
                        return true;
                    }
                }
            }
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    false
}

fn spawn_backend(app: &tauri::AppHandle, port: u16) -> Option<Child> {
    let exe = app
        .path()
        .resolve("bin/app-backend/app-backend.exe", BaseDirectory::Resource)
        .ok()?;
    match Command::new(&exe)
        .arg(port.to_string())
        .stdin(Stdio::null())
        .spawn()
    {
        Ok(child) => Some(child),
        Err(e) => {
            log::error!("failed to spawn backend sidecar: {e}");
            None
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![backend_port])
        .setup(|app| {
            // Log to file in every build so production failures are diagnosable;
            // stdout only helps during development.
            let level = if cfg!(debug_assertions) {
                log::LevelFilter::Debug
            } else {
                log::LevelFilter::Info
            };
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(level)
                    .targets([
                        tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                        tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                            file_name: Some("terna-app".into()),
                        }),
                    ])
                    .build(),
            )?;

            let handle = app.handle().clone();
            let port = pick_free_port();
            let child = port.and_then(|p| spawn_backend(&handle, p));

            match (port, child) {
                (Some(p), Some(child)) => {
                    // Register state immediately — the UI must not wait for the
                    // backend to be up. Readiness is tracked in a worker thread
                    // and the SPA polls /health with its own retry loop.
                    let pid = child.id();
                    app.manage(Sidecar(Mutex::new(Some(child))));
                    app.manage(BackendPort(Mutex::new(Some(p))));
                    std::thread::spawn(move || {
                        if wait_for_backend(p, Duration::from_secs(90)) {
                            log::info!("backend ready on port {p}");
                        } else {
                            log::error!("backend did not become ready within 90s");
                        }
                        #[cfg(windows)]
                        if let Err(e) = win_job::kill_on_close(pid) {
                            log::warn!("could not attach backend to job object: {e}");
                        }
                    });
                }
                _ => {
                    // No backend bundled (e.g. dev) — the SPA falls back to
                    // VITE_API_BASE_URL so a manually started backend still works.
                    log::error!("backend sidecar not available; frontend will use the default port");
                    app.manage(Sidecar(Mutex::new(None)));
                    app.manage(BackendPort(Mutex::new(None)));
                }
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // Kill the backend process when the app exits so it does not linger.
            if let RunEvent::Exit = event {
                if let Some(sidecar) = app_handle.try_state::<Sidecar>() {
                    if let Ok(mut guard) = sidecar.0.lock() {
                        if let Some(mut child) = guard.take() {
                            let _ = child.kill();
                            let _ = child.wait();
                        }
                    }
                }
            }
        });
}
