///|
extern "js" fn install(handler : (String) -> String) -> Unit =
  #| (handler) => { globalThis.__moonapi_core = handler; }

///|
fn main {
  install(@app.dispatch)
}
