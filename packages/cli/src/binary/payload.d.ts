// The launcher embeds the runtime tarball with `with { type: "file" }`, which
// yields the embedded file's path.
declare module "*.tar.gz" {
  const path: string;
  export default path;
}
