// The asker, as a process of its own.
//
//   devdeck-ask --run <run-id> --dir <asks-folder>
//
// Both come from the app, which wrote the MCP config the CLI is pointed at.
// The folder is passed rather than worked out, so this binary needs to know
// nothing about where the personal store lives — and therefore nothing about
// the app at all. It speaks MCP on stdin/stdout until the pipe closes.
fn main() {
    let argv: Vec<String> = std::env::args().collect();
    let val = |name: &str| -> Option<String> {
        argv.iter()
            .position(|a| a == name)
            .and_then(|i| argv.get(i + 1))
            .cloned()
    };

    let run = val("--run").unwrap_or_default();
    let dir = match val("--dir") {
        Some(d) => std::path::PathBuf::from(d),
        None => {
            // Never proceed unasked. Saying so on stderr is what puts the
            // reason in the run's log instead of leaving a worker to guess.
            eprintln!("devdeck-ask: no --dir was given, so there is nowhere to write a question");
            std::process::exit(2);
        }
    };
    if run.is_empty() {
        eprintln!("devdeck-ask: no --run was given, so a question could not be attributed");
        std::process::exit(2);
    }

    devdeck_ask::serve(&dir, &run);
}
