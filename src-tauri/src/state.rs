use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct AppState {
    pub project_root: Mutex<Option<PathBuf>>,
    pub open_files: Mutex<HashMap<String, String>>,
}
