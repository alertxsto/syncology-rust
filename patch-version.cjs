const fs = require('fs');
const path = require('path');

const version = process.env.APP_VERSION;
if (!version) {
  console.error("APP_VERSION env var is missing");
  process.exit(1);
}

console.log(`Patching version to ${version}...`);

// 1. Patch package.json
const pkgPath = path.resolve(__dirname, 'package.json');
if (fs.existsSync(pkgPath)) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pkg.version = version;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  console.log("Patched package.json");
}

// 2. Patch tauri.conf.json
const tauriPath = path.resolve(__dirname, 'src-tauri', 'tauri.conf.json');
if (fs.existsSync(tauriPath)) {
  const tauri = JSON.parse(fs.readFileSync(tauriPath, 'utf8'));
  tauri.version = version;
  fs.writeFileSync(tauriPath, JSON.stringify(tauri, null, 2) + '\n', 'utf8');
  console.log("Patched tauri.conf.json");
}

// 3. Patch Cargo.toml
const cargoPath = path.resolve(__dirname, 'src-tauri', 'Cargo.toml');
if (fs.existsSync(cargoPath)) {
  let cargo = fs.readFileSync(cargoPath, 'utf8');
  let replaced = false;
  cargo = cargo.replace(/^version\s*=\s*".*"/m, () => {
    replaced = true;
    return `version = "${version}"`;
  });
  if (replaced) {
    fs.writeFileSync(cargoPath, cargo, 'utf8');
    console.log("Patched Cargo.toml");
  } else {
    console.error("Failed to find version line in Cargo.toml");
    process.exit(1);
  }
}
