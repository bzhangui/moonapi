///|
fn main {
  let args = @env.args()
  if args.length() > 0 && args[args.length() - 1].has_prefix("{") {
    println(@app.dispatch(args[args.length() - 1]))
  } else {
    println("{\"ok\":false,\"error\":\"one policy command required\"}")
  }
}
