use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;

fn main() {
    // Load .env.local from parent directory (since build.rs runs in src-tauri)
    let env_path = Path::new("..").join(".env.local");
    if env_path.exists() {
        if let Ok(file) = File::open(env_path) {
            let reader = BufReader::new(file);
            for line in reader.lines() {
                if let Ok(line) = line {
                    let trimmed = line.trim();
                    if trimmed.is_empty() || trimmed.starts_with('#') {
                        continue;
                    }
                    if let Some((key, val)) = trimmed.split_once('=') {
                        let key = key.trim();
                        let val = val.trim();
                        // Remove enclosing quotes if present in the .env file
                        let val_clean = val.trim_matches(|c| c == '\'' || c == '"');
                        println!("cargo:rustc-env={}={}", key, val_clean);
                    }
                }
            }
        }
    }
    tauri_build::build()
}

