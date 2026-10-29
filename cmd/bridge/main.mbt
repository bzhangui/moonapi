///|
extern "js" fn install(handler : (String) -> String) -> Unit =
  #| (handler) => { globalThis.__moonapi_core = handler; }

///|
extern "js" fn install_modern(
  handler : (String, (String, String) -> Bool, (String, String) -> Bool) -> String,
) -> Unit =
  #| handler => { globalThis.__moonapi_modern = handler; }

///|
fn main {
  install(@app.dispatch)
  install_modern(@app.modern_dispatch)
}
