//! Scan a repository for things you can run.
//!
//! Two jobs, and the second is the one that matters in real repos:
//!
//! 1. **Know more than Node.** .NET, Python, Rust, Go, Android/Gradle, Maven,
//!    Flutter, PHP, Ruby, Docker Compose and Make each get a detector that
//!    knows what that ecosystem's *useful* commands are — not just "build".
//! 2. **Look past the root.** A repo is rarely one project. `backend/`,
//!    `android/`, `apps/web`, `services/api` are the normal shape, and a
//!    root-only scan finds nothing in any of them. Every command carries the
//!    directory it must run in.
//!
//! Detectors are deliberately conservative: a command is only offered when a
//! marker file says the toolchain is actually in use. Offering `mvn test` for
//! a repo with no `pom.xml` trains you to ignore the list.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

/// How deep to look. Four covers `apps/web/src`-shaped monorepos without
/// walking an entire disk when someone points this at `C:\`.
const MAX_DEPTH: usize = 4;
/// A scan that returns hundreds of rows is not a list, it's a haystack.
const MAX_RESULTS: usize = 250;

/// Directories that never contain a project you want to run, and always
/// contain thousands of files. Skipping these is most of the performance.
const SKIP_DIRS: &[&str] = &[
    "node_modules",
    "target",
    "dist",
    "build",
    "out",
    "bin",
    "obj",
    "vendor",
    "venv",
    "env",
    "__pycache__",
    "site-packages",
    "coverage",
    "Pods",
    "DerivedData",
    "Debug",
    "Release",
    "artifacts",
    "packages",
    "bower_components",
    "tmp",
    "temp",
    "logs",
    "migrations",
];

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DetectedCommand {
    pub name: String,
    pub command: String,
    pub group: String,
    /// Package manager / toolchain, for the UI badge.
    pub manager: String,
    /// Directory relative to the scanned root (`""` = the root itself). This
    /// is where the command has to run — without it, every command found in
    /// `apps/web` would silently execute at the repo root.
    pub dir: String,
    /// A long-running thing (dev server, watcher, emulator). The setup page
    /// seeds these as services rather than one-shot commands.
    pub service: bool,
}

/// Builder that fills in the directory and leaves `service` false.
struct Ctx<'a> {
    /// Path relative to the scan root, e.g. `apps/web`. Empty at the root.
    rel: &'a str,
    out: &'a mut Vec<DetectedCommand>,
}

impl Ctx<'_> {
    /// The folder's own name, used to keep names unique across a monorepo:
    /// three `dev` scripts are indistinguishable, `web dev` / `api dev` are not.
    fn leaf(&self) -> &str {
        self.rel.rsplit('/').next().unwrap_or("")
    }

    fn add(&mut self, name: &str, command: impl Into<String>, group: &str, manager: &str) {
        self.push(name, command, group, manager, false);
    }

    /// Same, but flagged as long-running.
    fn service(&mut self, name: &str, command: impl Into<String>, group: &str, manager: &str) {
        self.push(name, command, group, manager, true);
    }

    fn push(
        &mut self,
        name: &str,
        command: impl Into<String>,
        group: &str,
        manager: &str,
        service: bool,
    ) {
        if self.out.len() >= MAX_RESULTS {
            return;
        }
        let leaf = self.leaf();
        let full_name = if leaf.is_empty() {
            name.to_string()
        } else {
            format!("{leaf} {name}")
        };
        let full_group = if self.rel.is_empty() {
            group.to_string()
        } else {
            format!("{} · {}", self.rel, group)
        };
        self.out.push(DetectedCommand {
            name: full_name,
            command: command.into(),
            group: full_group,
            manager: manager.into(),
            dir: self.rel.to_string(),
            service,
        });
    }
}

fn read_json(p: &Path) -> Option<serde_json::Value> {
    fs::read_to_string(p)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
}

fn file_names(dir: &Path) -> Vec<String> {
    fs::read_dir(dir)
        .map(|rd| {
            rd.flatten()
                .filter_map(|e| e.file_name().to_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default()
}

/// Lowercased contents of a file, for cheap "is this dependency here" checks.
fn read_lower(p: &Path) -> String {
    fs::read_to_string(p).unwrap_or_default().to_lowercase()
}

// ---------- JavaScript ----------

/// The JS package manager, inferred from the lockfile (defaults to npm).
fn js_manager(dir: &Path) -> &'static str {
    if dir.join("pnpm-lock.yaml").exists() {
        "pnpm"
    } else if dir.join("yarn.lock").exists() {
        "yarn"
    } else if dir.join("bun.lockb").exists() || dir.join("bun.lock").exists() {
        "bun"
    } else {
        "npm"
    }
}

fn js_run(mgr: &str, script: &str) -> String {
    match mgr {
        "npm" => format!("npm run {script}"),
        "yarn" => format!("yarn {script}"),
        "pnpm" => format!("pnpm {script}"),
        "bun" => format!("bun run {script}"),
        _ => format!("npm run {script}"),
    }
}

/// Script names that are long-running by convention.
fn js_is_service(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    n == "dev"
        || n == "start"
        || n == "serve"
        || n == "watch"
        || n.starts_with("dev:")
        || n.starts_with("start:")
        || n.starts_with("serve:")
}

fn detect_node(dir: &Path, c: &mut Ctx) {
    let Some(json) = read_json(&dir.join("package.json")) else {
        return;
    };
    let mgr = js_manager(dir);
    let group = format!("{mgr} scripts");
    if let Some(scripts) = json.get("scripts").and_then(|s| s.as_object()) {
        for name in scripts.keys() {
            let cmd = js_run(mgr, name);
            if js_is_service(name) {
                c.service(name, cmd, &group, mgr);
            } else {
                c.add(name, cmd, &group, mgr);
            }
        }
    }
    if !dir.join("node_modules").exists() {
        let install = if mgr == "npm" {
            "npm install".to_string()
        } else {
            format!("{mgr} install")
        };
        c.add("install", install, &group, mgr);
    }
}

// ---------- Python ----------

fn detect_python(dir: &Path, c: &mut Ctx) {
    let names = file_names(dir);
    let has = |f: &str| names.iter().any(|n| n == f);

    let pyproject = read_lower(&dir.join("pyproject.toml"));
    let reqs = read_lower(&dir.join("requirements.txt"));
    let deps = format!("{pyproject}{reqs}");
    let any_python = has("pyproject.toml")
        || has("requirements.txt")
        || has("Pipfile")
        || has("manage.py")
        || has("setup.py");
    if !any_python {
        return;
    }

    // How you invoke things differs per tool, so work it out once.
    let runner: &str = if pyproject.contains("[tool.poetry]") {
        "poetry run "
    } else if has("uv.lock") {
        "uv run "
    } else if has("Pipfile") {
        "pipenv run "
    } else {
        ""
    };

    // Dependency install, named for whatever manages this project.
    if has("Pipfile") {
        c.add("install", "pipenv install", "python", "pipenv");
    } else if has("uv.lock") || pyproject.contains("[tool.uv]") {
        c.add("install", "uv sync", "python", "uv");
    } else if pyproject.contains("[tool.poetry]") {
        c.add("install", "poetry install", "python", "poetry");
    } else if has("requirements.txt") {
        c.add(
            "install",
            "pip install -r requirements.txt",
            "python",
            "pip",
        );
    }

    // Django is the one that most rewards knowing the framework.
    if has("manage.py") {
        c.service(
            "runserver",
            format!("{runner}python manage.py runserver"),
            "django",
            "python",
        );
        c.add(
            "migrate",
            format!("{runner}python manage.py migrate"),
            "django",
            "python",
        );
        c.add(
            "makemigrations",
            format!("{runner}python manage.py makemigrations"),
            "django",
            "python",
        );
        c.add(
            "createsuperuser",
            format!("{runner}python manage.py createsuperuser"),
            "django",
            "python",
        );
        c.add(
            "shell",
            format!("{runner}python manage.py shell"),
            "django",
            "python",
        );
        c.add(
            "collectstatic",
            format!("{runner}python manage.py collectstatic --noinput"),
            "django",
            "python",
        );
    }

    // ASGI/WSGI servers: only offered when the dependency is actually present.
    if deps.contains("uvicorn") || deps.contains("fastapi") {
        let module = ["main", "app", "api", "server"]
            .iter()
            .find(|m| names.iter().any(|n| n == &format!("{m}.py")))
            .copied()
            .unwrap_or("main");
        c.service(
            "uvicorn",
            format!("{runner}uvicorn {module}:app --reload"),
            "python",
            "python",
        );
    }
    if deps.contains("flask") && !has("manage.py") {
        c.service(
            "flask run",
            format!("{runner}flask run --debug"),
            "python",
            "python",
        );
    }
    if deps.contains("streamlit") {
        let entry = ["app.py", "main.py", "streamlit_app.py"]
            .iter()
            .find(|f| names.iter().any(|n| n == *f))
            .copied()
            .unwrap_or("app.py");
        c.service(
            "streamlit",
            format!("{runner}streamlit run {entry}"),
            "python",
            "python",
        );
    }
    if deps.contains("pytest") {
        c.add("test", format!("{runner}pytest"), "python", "pytest");
    }

    // A plain entry point, when there's no framework to speak of.
    if !has("manage.py") {
        for entry in ["main.py", "app.py", "run.py", "bot.py"] {
            if names.iter().any(|n| n == entry) {
                c.add(
                    entry.trim_end_matches(".py"),
                    format!("{runner}python {entry}"),
                    "python",
                    "python",
                );
                break;
            }
        }
    }

    // Declared console scripts.
    if let Ok(txt) = fs::read_to_string(dir.join("pyproject.toml")) {
        let mut in_scripts = false;
        for line in txt.lines() {
            let l = line.trim();
            if l.starts_with('[') {
                in_scripts = l == "[project.scripts]" || l == "[tool.poetry.scripts]";
                continue;
            }
            if in_scripts {
                if let Some(eq) = l.find('=') {
                    let name = l[..eq].trim().trim_matches('"');
                    if !name.is_empty() {
                        c.add(name, format!("{runner}{name}"), "python", "python");
                    }
                }
            }
        }
    }
}

// ---------- .NET ----------

fn detect_dotnet(dir: &Path, c: &mut Ctx) {
    let names = file_names(dir);
    let projects: Vec<String> = names
        .iter()
        .filter(|n| {
            let l = n.to_ascii_lowercase();
            l.ends_with(".csproj") || l.ends_with(".fsproj") || l.ends_with(".vbproj")
        })
        .cloned()
        .collect();
    let sln = names
        .iter()
        .find(|n| n.to_ascii_lowercase().ends_with(".sln"));

    if let Some(sln) = sln {
        c.add(
            "build",
            format!("dotnet build \"{sln}\""),
            "dotnet",
            "dotnet",
        );
        c.add(
            "restore",
            format!("dotnet restore \"{sln}\""),
            "dotnet",
            "dotnet",
        );
        c.add("test", format!("dotnet test \"{sln}\""), "dotnet", "dotnet");
    }

    for proj in &projects {
        let stem = proj.rsplit_once('.').map(|(a, _)| a).unwrap_or(proj);
        let body = read_lower(&dir.join(proj));
        let is_test = stem.to_ascii_lowercase().contains("test")
            || body.contains("xunit")
            || body.contains("nunit")
            || body.contains("mstest");
        let is_web = body.contains("microsoft.net.sdk.web") || body.contains("aspnetcore");

        if is_test {
            c.add(
                &format!("test {stem}"),
                format!("dotnet test \"{proj}\""),
                "dotnet",
                "dotnet",
            );
            continue;
        }
        // `dotnet watch` is the one people actually live in for web projects.
        if is_web {
            c.service(
                &format!("watch {stem}"),
                format!("dotnet watch run --project \"{proj}\""),
                "dotnet",
                "dotnet",
            );
        }
        c.add(
            &format!("run {stem}"),
            format!("dotnet run --project \"{proj}\""),
            "dotnet",
            "dotnet",
        );
        if sln.is_none() {
            c.add(
                &format!("build {stem}"),
                format!("dotnet build \"{proj}\""),
                "dotnet",
                "dotnet",
            );
        }
        if body.contains("entityframeworkcore") {
            c.add(
                &format!("ef update {stem}"),
                format!("dotnet ef database update --project \"{proj}\""),
                "dotnet",
                "dotnet",
            );
        }
    }
}

// ---------- Gradle / Android / Maven ----------

fn detect_gradle(dir: &Path, c: &mut Ctx) {
    let names = file_names(dir);
    let has = |f: &str| names.iter().any(|n| n == f);
    let wrapper = has("gradlew.bat") || has("gradlew");
    // A Gradle *project* is where the wrapper or settings file lives. A bare
    // build.gradle is a **module** of one — `android/app/build.gradle` is not
    // a second project, and treating it as one produced a duplicate set of
    // commands that invoked bare `gradle` instead of the project's wrapper.
    if !(wrapper || has("settings.gradle") || has("settings.gradle.kts")) {
        return;
    }
    // The wrapper is the correct entry point when it exists — it pins the
    // Gradle version the project expects.
    let g = if wrapper { ".\\gradlew" } else { "gradle" };

    let build_files = [
        dir.join("build.gradle"),
        dir.join("build.gradle.kts"),
        dir.join("app").join("build.gradle"),
        dir.join("app").join("build.gradle.kts"),
    ];
    let body: String = build_files.iter().map(|p| read_lower(p)).collect();
    let is_android = body.contains("com.android.application")
        || body.contains("com.android.library")
        || dir
            .join("app")
            .join("src")
            .join("main")
            .join("AndroidManifest.xml")
            .exists();
    let is_spring = body.contains("org.springframework.boot");

    if is_android {
        c.add(
            "assembleDebug",
            format!("{g} assembleDebug"),
            "android",
            "gradle",
        );
        c.add(
            "installDebug",
            format!("{g} installDebug"),
            "android",
            "gradle",
        );
        c.add(
            "assembleRelease",
            format!("{g} assembleRelease"),
            "android",
            "gradle",
        );
        c.add(
            "bundleRelease",
            format!("{g} bundleRelease"),
            "android",
            "gradle",
        );
        c.add("lint", format!("{g} lint"), "android", "gradle");
        c.add(
            "unit tests",
            format!("{g} testDebugUnitTest"),
            "android",
            "gradle",
        );
        c.add("clean", format!("{g} clean"), "android", "gradle");
        // Handy enough to be worth offering, and it isn't obvious.
        c.add("devices", "adb devices", "android", "adb");
        c.service("logcat", "adb logcat", "android", "adb");
    } else {
        if is_spring {
            c.service("bootRun", format!("{g} bootRun"), "gradle", "gradle");
        }
        c.add("build", format!("{g} build"), "gradle", "gradle");
        c.add("test", format!("{g} test"), "gradle", "gradle");
        c.add("clean", format!("{g} clean"), "gradle", "gradle");
    }
}

fn detect_maven(dir: &Path, c: &mut Ctx) {
    if !dir.join("pom.xml").exists() {
        return;
    }
    let wrapper = dir.join("mvnw.cmd").exists() || dir.join("mvnw").exists();
    let m = if wrapper { ".\\mvnw" } else { "mvn" };
    let body = read_lower(&dir.join("pom.xml"));
    if body.contains("spring-boot") {
        c.service(
            "spring-boot:run",
            format!("{m} spring-boot:run"),
            "maven",
            "maven",
        );
    }
    c.add("package", format!("{m} package"), "maven", "maven");
    c.add("test", format!("{m} test"), "maven", "maven");
    c.add(
        "clean install",
        format!("{m} clean install"),
        "maven",
        "maven",
    );
}

// ---------- everything else ----------

fn detect_rust(dir: &Path, c: &mut Ctx) {
    if !dir.join("Cargo.toml").exists() {
        return;
    }
    let body = read_lower(&dir.join("Cargo.toml"));
    // A workspace root has no binary of its own to run.
    let workspace_only = body.contains("[workspace]") && !body.contains("[package]");
    if !workspace_only {
        c.add("run", "cargo run", "cargo", "cargo");
    }
    c.add("build", "cargo build --release", "cargo", "cargo");
    c.add("test", "cargo test", "cargo", "cargo");
    c.add("check", "cargo check", "cargo", "cargo");
    c.add("clippy", "cargo clippy --all-targets", "cargo", "cargo");
    c.add("fmt", "cargo fmt", "cargo", "cargo");
}

fn detect_go(dir: &Path, c: &mut Ctx) {
    if !dir.join("go.mod").exists() {
        return;
    }
    c.service("run", "go run .", "go", "go");
    c.add("build", "go build ./...", "go", "go");
    c.add("test", "go test ./...", "go", "go");
    c.add("tidy", "go mod tidy", "go", "go");
}

fn detect_flutter(dir: &Path, c: &mut Ctx) {
    let pubspec = read_lower(&dir.join("pubspec.yaml"));
    if pubspec.is_empty() {
        return;
    }
    if pubspec.contains("flutter:") || pubspec.contains("sdk: flutter") {
        c.service("run", "flutter run", "flutter", "flutter");
        c.add("get", "flutter pub get", "flutter", "flutter");
        c.add("build apk", "flutter build apk", "flutter", "flutter");
        c.add("test", "flutter test", "flutter", "flutter");
        c.add("devices", "flutter devices", "flutter", "flutter");
    } else {
        c.add("get", "dart pub get", "dart", "dart");
        c.add("test", "dart test", "dart", "dart");
    }
}

fn detect_php(dir: &Path, c: &mut Ctx) {
    if dir.join("artisan").exists() {
        c.service("serve", "php artisan serve", "laravel", "php");
        c.add("migrate", "php artisan migrate", "laravel", "php");
        c.add("tinker", "php artisan tinker", "laravel", "php");
        c.add("queue:work", "php artisan queue:work", "laravel", "php");
    }
    if let Some(json) = read_json(&dir.join("composer.json")) {
        if let Some(scripts) = json.get("scripts").and_then(|s| s.as_object()) {
            for name in scripts.keys() {
                c.add(
                    name,
                    format!("composer run-script {name}"),
                    "composer",
                    "composer",
                );
            }
        }
        if !dir.join("vendor").exists() {
            c.add("install", "composer install", "composer", "composer");
        }
    }
}

fn detect_ruby(dir: &Path, c: &mut Ctx) {
    if !dir.join("Gemfile").exists() {
        return;
    }
    let body = read_lower(&dir.join("Gemfile"));
    c.add("install", "bundle install", "ruby", "bundler");
    if body.contains("rails") {
        c.service("server", "bundle exec rails server", "rails", "rails");
        c.add("migrate", "bundle exec rails db:migrate", "rails", "rails");
        c.add("console", "bundle exec rails console", "rails", "rails");
    }
    if body.contains("rspec") {
        c.add("test", "bundle exec rspec", "ruby", "rspec");
    }
}

fn detect_docker(dir: &Path, c: &mut Ctx) {
    let names = file_names(dir);
    let compose = names.iter().find(|n| {
        matches!(
            n.as_str(),
            "docker-compose.yml" | "docker-compose.yaml" | "compose.yml" | "compose.yaml"
        )
    });
    if let Some(file) = compose {
        c.service(
            "compose up",
            format!("docker compose -f {file} up"),
            "docker",
            "docker",
        );
        c.add(
            "compose down",
            format!("docker compose -f {file} down"),
            "docker",
            "docker",
        );
        c.service(
            "compose logs",
            format!("docker compose -f {file} logs -f"),
            "docker",
            "docker",
        );
        c.add(
            "compose build",
            format!("docker compose -f {file} build"),
            "docker",
            "docker",
        );
    }
}

fn detect_make(dir: &Path, c: &mut Ctx) {
    let Ok(txt) = fs::read_to_string(dir.join("Makefile")) else {
        return;
    };
    for line in txt.lines() {
        if line.starts_with(' ') || line.starts_with('\t') {
            continue;
        }
        if let Some(idx) = line.find(':') {
            let target = line[..idx].trim();
            if !target.is_empty()
                && !target.starts_with('.')
                && target
                    .chars()
                    .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
            {
                c.add(target, format!("make {target}"), "make", "make");
            }
        }
    }
}

/// Run every detector against one directory.
// ---------- the extension point ----------
//
// Adding a language or tool is one of two jobs, depending on how much thinking
// it needs.
//
// **If a marker file is enough**, add a row to `MARKER_DETECTORS` below. No
// code: state the file, the commands it implies, and which of them are
// long-running.
//
// **If it needs to look inside files** — which dependency is present, whether
// this is a test project, which runner the project uses — write a
// `fn(&Path, &mut Ctx)` and add it to `DETECTORS`. `Ctx` already handles
// naming, the relative directory, and the service flag, so a detector only
// decides *what* to offer.
//
// Either way, add a fixture test. The bar for a new detector is that it only
// fires when a marker proves the toolchain is in use — a scan that offers
// commands a repo can't run teaches you to ignore the list.

/// One command a marker file implies: name, command, and whether it's
/// long-running.
type MarkerCmd = (&'static str, &'static str, bool);

/// Ecosystems that need no logic beyond "this file exists".
struct MarkerDetector {
    /// Any one of these files present in a directory fires the detector.
    markers: &'static [&'static str],
    group: &'static str,
    manager: &'static str,
    commands: &'static [MarkerCmd],
}

/// Deploy and infrastructure tooling — the "…and ship it" half of build, run,
/// test, deploy. Each is keyed to a config file that only exists when the tool
/// is genuinely wired up.
const MARKER_DETECTORS: &[MarkerDetector] = &[
    MarkerDetector {
        markers: &["fly.toml"],
        group: "deploy",
        manager: "fly",
        commands: &[
            ("deploy", "fly deploy", false),
            ("status", "fly status", false),
            ("logs", "fly logs", true),
        ],
    },
    MarkerDetector {
        markers: &["vercel.json", ".vercel"],
        group: "deploy",
        manager: "vercel",
        commands: &[
            ("deploy", "vercel deploy", false),
            ("deploy prod", "vercel deploy --prod", false),
        ],
    },
    MarkerDetector {
        markers: &["wrangler.toml", "wrangler.jsonc", "wrangler.json"],
        group: "deploy",
        manager: "wrangler",
        commands: &[
            ("deploy", "wrangler deploy", false),
            ("dev", "wrangler dev", true),
        ],
    },
    MarkerDetector {
        markers: &["serverless.yml", "serverless.yaml"],
        group: "deploy",
        manager: "serverless",
        commands: &[("deploy", "serverless deploy", false)],
    },
    MarkerDetector {
        markers: &["netlify.toml"],
        group: "deploy",
        manager: "netlify",
        commands: &[
            ("deploy", "netlify deploy --prod", false),
            ("dev", "netlify dev", true),
        ],
    },
    MarkerDetector {
        markers: &["Dockerfile"],
        group: "docker",
        manager: "docker",
        commands: &[("docker build", "docker build -t app .", false)],
    },
    MarkerDetector {
        markers: &["main.tf"],
        group: "terraform",
        manager: "terraform",
        commands: &[
            ("init", "terraform init", false),
            ("plan", "terraform plan", false),
            ("apply", "terraform apply", false),
        ],
    },
    MarkerDetector {
        markers: &["Chart.yaml"],
        group: "helm",
        manager: "helm",
        commands: &[
            ("template", "helm template .", false),
            ("upgrade", "helm upgrade --install app .", false),
        ],
    },
];

fn run_marker_detectors(dir: &Path, c: &mut Ctx) {
    let names = file_names(dir);
    for d in MARKER_DETECTORS {
        if !d.markers.iter().any(|m| names.iter().any(|n| n == m)) {
            continue;
        }
        for (name, command, service) in d.commands {
            if *service {
                c.service(name, *command, d.group, d.manager);
            } else {
                c.add(name, *command, d.group, d.manager);
            }
        }
    }
}

/// A detector that needs to read files, not just see them.
type Detector = fn(&Path, &mut Ctx);

/// Every ecosystem with real logic behind it. Order is the order commands
/// appear, so the thing you most likely want is near the top.
const DETECTORS: &[(&str, Detector)] = &[
    ("node", detect_node),
    ("python", detect_python),
    ("dotnet", detect_dotnet),
    ("gradle", detect_gradle),
    ("maven", detect_maven),
    ("rust", detect_rust),
    ("go", detect_go),
    ("flutter", detect_flutter),
    ("php", detect_php),
    ("ruby", detect_ruby),
    ("docker", detect_docker),
    ("make", detect_make),
];

fn detect_dir(dir: &Path, rel: &str, out: &mut Vec<DetectedCommand>) {
    let mut c = Ctx { rel, out };
    for (_name, detect) in DETECTORS {
        detect(dir, &mut c);
    }
    run_marker_detectors(dir, &mut c);
}

fn skippable(name: &str) -> bool {
    // Hidden directories are build caches and tooling state (.git, .venv,
    // .gradle, .next); none hold a command you want to run.
    name.starts_with('.') || SKIP_DIRS.iter().any(|s| s.eq_ignore_ascii_case(name))
}

fn walk(dir: &Path, rel: String, depth: usize, out: &mut Vec<DetectedCommand>) {
    detect_dir(dir, &rel, out);
    if depth >= MAX_DEPTH || out.len() >= MAX_RESULTS {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut subdirs: Vec<(String, std::path::PathBuf)> = entries
        .flatten()
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .filter_map(|e| e.file_name().to_str().map(|n| (n.to_string(), e.path())))
        .filter(|(n, _)| !skippable(n))
        .collect();
    // Stable order, so the same repo always scans the same way.
    subdirs.sort_by(|a, b| a.0.cmp(&b.0));
    for (name, path) in subdirs {
        let child_rel = if rel.is_empty() {
            name
        } else {
            format!("{rel}/{name}")
        };
        walk(&path, child_rel, depth + 1, out);
    }
}

#[tauri::command]
pub fn scan_project(dir: String) -> Result<Vec<DetectedCommand>, String> {
    let d = Path::new(&dir);
    if dir.trim().is_empty() || !d.is_dir() {
        return Err(format!("Not a folder: {dir}"));
    }
    let mut out: Vec<DetectedCommand> = Vec::new();
    walk(d, String::new(), 0, &mut out);

    // The same command in the same folder can be found twice (a Makefile
    // target that shadows an npm script, say). Keep the first.
    let mut seen = std::collections::HashSet::new();
    out.retain(|c| seen.insert((c.dir.clone(), c.command.clone())));
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// A throwaway directory tree, so the detectors are tested against real
    /// files rather than a mocked filesystem.
    struct Tmp(std::path::PathBuf);
    impl Tmp {
        fn new(tag: &str) -> Self {
            let mut p = std::env::temp_dir();
            p.push(format!("devdeck-scan-{tag}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&p);
            fs::create_dir_all(&p).unwrap();
            Tmp(p)
        }
        fn file(&self, rel: &str, body: &str) -> &Self {
            let p = self.0.join(rel);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(p, body).unwrap();
            self
        }
        fn scan(&self) -> Vec<DetectedCommand> {
            scan_project(self.0.to_string_lossy().to_string()).unwrap()
        }
    }
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn cmds(out: &[DetectedCommand]) -> Vec<String> {
        out.iter().map(|c| c.command.clone()).collect()
    }

    #[test]
    fn finds_projects_below_the_root() {
        let t = Tmp::new("nested");
        t.file("apps/web/package.json", r#"{"scripts":{"dev":"vite"}}"#)
            .file("services/api/requirements.txt", "fastapi\nuvicorn\n")
            .file("services/api/main.py", "app = 1")
            .file("android/build.gradle", "com.android.application")
            .file("android/gradlew.bat", "");
        let out = t.scan();

        // The whole point: a root-only scan finds none of these.
        let dirs: Vec<&str> = out.iter().map(|c| c.dir.as_str()).collect();
        assert!(dirs.contains(&"apps/web"), "missed the web app: {dirs:?}");
        assert!(dirs.contains(&"services/api"), "missed the python service");
        assert!(dirs.contains(&"android"), "missed the android module");

        // And each command knows where it has to run.
        let web = out.iter().find(|c| c.command == "npm run dev").unwrap();
        assert_eq!(web.dir, "apps/web");
        // Names are disambiguated by folder, or three `dev` rows look identical.
        assert_eq!(web.name, "web dev");
        assert!(web.service, "a dev script is long-running");
    }

    #[test]
    fn python_gets_more_than_a_build_command() {
        let t = Tmp::new("py");
        t.file("manage.py", "")
            .file("requirements.txt", "django\npytest\n");
        let c = cmds(&t.scan());
        assert!(c.iter().any(|x| x == "python manage.py runserver"));
        assert!(c.iter().any(|x| x == "python manage.py migrate"));
        assert!(c.iter().any(|x| x == "pip install -r requirements.txt"));
        assert!(c.iter().any(|x| x == "pytest"));
    }

    #[test]
    fn python_respects_the_project_runner() {
        let t = Tmp::new("poetry");
        t.file("pyproject.toml", "[tool.poetry]\nname = \"x\"\n")
            .file("manage.py", "");
        let c = cmds(&t.scan());
        assert!(
            c.iter()
                .any(|x| x == "poetry run python manage.py runserver"),
            "poetry projects must be run through poetry: {c:?}"
        );
    }

    #[test]
    fn dotnet_finds_each_project_and_knows_tests_from_apps() {
        let t = Tmp::new("dotnet");
        t.file(
            "Api/Api.csproj",
            "<Project Sdk=\"Microsoft.NET.Sdk.Web\"></Project>",
        )
        .file(
            "Api.Tests/Api.Tests.csproj",
            "<Project><PackageReference Include=\"xunit\" /></Project>",
        );
        let c = cmds(&t.scan());
        assert!(c
            .iter()
            .any(|x| x.contains("dotnet run --project \"Api.csproj\"")));
        // A web project earns a watch command; a test project earns none.
        assert!(c.iter().any(|x| x.contains("dotnet watch run")));
        assert!(c
            .iter()
            .any(|x| x.contains("dotnet test \"Api.Tests.csproj\"")));
        assert!(
            !c.iter()
                .any(|x| x.contains("dotnet run --project \"Api.Tests.csproj\"")),
            "a test project is not something you `dotnet run`"
        );
    }

    #[test]
    fn android_uses_the_wrapper_and_offers_android_commands() {
        let t = Tmp::new("android");
        t.file("gradlew.bat", "").file(
            "app/build.gradle",
            "apply plugin: 'com.android.application'",
        );
        let c = cmds(&t.scan());
        assert!(c.iter().any(|x| x == ".\\gradlew assembleDebug"), "{c:?}");
        assert!(c.iter().any(|x| x == ".\\gradlew installDebug"));
        assert!(c.iter().any(|x| x == "adb logcat"));
        assert!(
            !c.iter().any(|x| x == "gradle build"),
            "the wrapper pins the version"
        );
    }

    #[test]
    fn marker_detectors_cover_deploy_tooling() {
        let t = Tmp::new("deploy");
        t.file("fly.toml", "app = 'x'")
            .file("Dockerfile", "FROM scratch")
            .file("package.json", r#"{"scripts":{"build":"tsc"}}"#);
        let c = cmds(&t.scan());
        assert!(c.iter().any(|x| x == "fly deploy"), "{c:?}");
        assert!(c.iter().any(|x| x == "docker build -t app ."));
        // Still only what's present: no terraform here.
        assert!(!c.iter().any(|x| x.starts_with("terraform")));
    }

    #[test]
    fn every_detector_is_reachable() {
        // A detector added to the list but never wired is silent, and silence
        // looks exactly like "this repo doesn't use that toolchain".
        assert_eq!(DETECTORS.len(), 12, "update this when adding a detector");
        assert!(MARKER_DETECTORS.iter().all(|d| !d.commands.is_empty()));
        assert!(MARKER_DETECTORS.iter().all(|d| !d.markers.is_empty()));
    }

    #[test]
    fn a_gradle_module_is_not_a_second_project() {
        let t = Tmp::new("gmodule");
        t.file("gradlew.bat", "")
            .file("settings.gradle", "include ':app'")
            .file(
                "app/build.gradle",
                "apply plugin: 'com.android.application'",
            );
        let out = t.scan();
        // app/ is a module of the root Gradle project, not a project itself.
        assert!(
            !out.iter().any(|c| c.dir == "app"),
            "app/ was treated as its own project: {:?}",
            out.iter().map(|c| (&c.dir, &c.command)).collect::<Vec<_>>()
        );
        // And the wrapper is used, never bare `gradle`.
        assert!(out.iter().any(|c| c.command == ".\\gradlew assembleDebug"));
        assert!(!out.iter().any(|c| c.command.starts_with("gradle ")));
    }

    #[test]
    fn a_rust_workspace_root_has_nothing_to_run() {
        let t = Tmp::new("ws");
        t.file("Cargo.toml", "[workspace]\nmembers = [\"a\"]\n");
        let c = cmds(&t.scan());
        assert!(c.iter().any(|x| x == "cargo test"));
        assert!(
            !c.iter().any(|x| x == "cargo run"),
            "a workspace root has no binary of its own"
        );
    }

    #[test]
    fn noise_directories_are_never_walked() {
        let t = Tmp::new("noise");
        t.file("package.json", r#"{"scripts":{"build":"tsc"}}"#)
            .file(
                "node_modules/pkg/package.json",
                r#"{"scripts":{"evil":"rm -rf /"}}"#,
            )
            .file(".git/package.json", r#"{"scripts":{"nope":"x"}}"#)
            .file("target/package.json", r#"{"scripts":{"nope":"x"}}"#);
        let c = cmds(&t.scan());
        assert!(c.iter().any(|x| x == "npm run build"));
        assert!(
            !c.iter().any(|x| x.contains("evil")),
            "walked node_modules: {c:?}"
        );
        assert!(
            !c.iter().any(|x| x.contains("nope")),
            "walked a hidden/build dir"
        );
    }

    #[test]
    fn only_offers_what_the_repo_actually_uses() {
        let t = Tmp::new("sparse");
        t.file("package.json", r#"{"scripts":{"build":"tsc"}}"#);
        let c = cmds(&t.scan());
        // Offering commands for toolchains that aren't here trains you to
        // ignore the whole list.
        assert!(!c.iter().any(|x| x.starts_with("mvn")));
        assert!(!c.iter().any(|x| x.starts_with("cargo")));
        assert!(!c.iter().any(|x| x.starts_with("dotnet")));
        assert!(!c.iter().any(|x| x.starts_with("php")));
    }
}

#[cfg(test)]
mod probe {
    /// A diagnostic, not an assertion: point `DEVDECK_SCAN_PROBE` at a real
    /// repository and this prints exactly what the scanner would offer for
    /// it. Fixture tests prove the rules; this is how you check them against
    /// a tree you actually have. No-ops when the variable isn't set.
    #[test]
    fn print_probe_scan() {
        let Ok(root) = std::env::var("DEVDECK_SCAN_PROBE") else {
            return;
        };
        let out = super::scan_project(root).unwrap();
        println!("--- {} commands ---", out.len());
        for c in &out {
            println!(
                "{:<16} {:<10} {:<7} {}",
                if c.dir.is_empty() { "(root)" } else { &c.dir },
                c.manager,
                if c.service { "service" } else { "cmd" },
                c.command
            );
        }
    }
}
