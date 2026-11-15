// Windows: a desktop window only, no console window next to it (user 2026-11-15: the server
// window is of no use to the user). Debug builds keep the console for the logs.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    lex_machina_desktop_lib::run();
}
