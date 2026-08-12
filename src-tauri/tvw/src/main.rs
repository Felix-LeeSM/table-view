//! Process shim. Every decision lives in the lib (`src/lib.rs`) so that CI's
//! `cargo test --workspace --lib` covers it.

use std::io::{self, Write};
use std::process::ExitCode;

#[tokio::main]
async fn main() -> ExitCode {
    let outcome = tvw::run_argv(std::env::args_os()).await;

    // `tvw query … | head` closes the pipe early. Left to `print!`, that is a
    // panic — a Rust backtrace on stderr and exit 101, which is not one of the
    // three codes the contract defines. A reader that stopped reading is not a
    // query failure, so it exits 0.
    if emit(io::stdout(), &outcome.stdout).is_err() {
        return ExitCode::from(tvw::EXIT_SUCCESS);
    }
    let _ = emit(io::stderr(), &outcome.stderr);

    ExitCode::from(outcome.code)
}

fn emit(mut sink: impl Write, text: &str) -> io::Result<()> {
    sink.write_all(text.as_bytes())?;
    sink.flush()
}
