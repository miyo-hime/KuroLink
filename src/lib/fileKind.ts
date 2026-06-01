// glyphs, not colors - a rainbow tree would fight the cockpit's de-saturated palette.
// every file type gets a geometric mark; dirs keep the accent (handled in the node).

const GLYPH_BY_EXT: Record<string, string> = {};
const GLYPH_BY_NAME: Record<string, string> = {};

function register(glyph: string, exts: string[]) {
  for (const e of exts) GLYPH_BY_EXT[e] = glyph;
}

function named(glyph: string, names: string[]) {
  for (const n of names) GLYPH_BY_NAME[n] = glyph;
}

// code + scripts
register("◈", [
  "rs", "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "pyw", "go", "c", "h",
  "cpp", "hpp", "cc", "cxx", "hxx", "java", "kt", "kts", "rb", "php", "lua",
  "sh", "bash", "zsh", "fish", "ksh", "ps1", "psm1", "psd1", "bat", "cmd",
  "swift", "scala", "sc", "clj", "cljs", "cljc", "ex", "exs", "erl", "hrl",
  "svelte", "vue", "sql", "zig", "nim", "dart", "elm", "hs", "lhs", "ml",
  "mli", "fs", "fsx", "fsi", "cs", "vb", "pas", "d", "cr", "v", "sol", "move",
  "proto", "gd", "rkt", "scm", "lisp", "el", "vim", "tcl", "groovy", "gradle",
  "r", "jl", "pl", "pm", "raku", "coffee", "astro", "purs", "re", "res",
  "asm", "s", "wat", "wast", "m", "mm", "gleam", "odin", "wgsl", "hlsl",
  "glsl", "vert", "frag", "comp", "cu", "cuh", "ipynb", "awk", "sed",
]);

// config + structured data
register("▤", [
  "json", "jsonc", "json5", "toml", "yaml", "yml", "ini", "conf", "cfg",
  "cnf", "env", "xml", "csv", "tsv", "properties", "lock", "plist", "reg",
  "desktop", "service", "rc", "tf", "tfvars", "hcl", "nix", "dhall", "ron",
  "mod", "sum", "manifest", "babelrc", "eslintrc", "prettierrc", "editorconfig",
  "npmrc", "yarnrc", "dockerignore", "gitattributes", "gitmodules",
]);

// docs + plain text
register("≡", [
  "md", "markdown", "mdx", "txt", "text", "rst", "adoc", "asciidoc", "org",
  "log", "rtf", "tex", "bib", "textile", "nfo", "me",
]);

// images
register("▦", [
  "png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp", "tiff", "tif",
  "avif", "heic", "heif", "jfif", "psd", "xcf", "raw", "dng", "cr2", "nef", "arw",
]);

// archives + packages
register("▨", [
  "zip", "tar", "gz", "tgz", "xz", "txz", "bz2", "tbz2", "7z", "rar", "zst",
  "lz", "lzma", "lz4", "cab", "iso", "dmg", "cpio", "ar", "jar", "war", "ear",
  "apk", "aab", "whl", "gem", "crate", "nupkg", "vsix", "deb", "rpm",
]);

// keys + secrets
register("◉", [
  "pem", "key", "crt", "cert", "cer", "pub", "gpg", "asc", "kdbx", "p12",
  "pfx", "jks", "keystore", "ppk", "p8", "csr", "der", "ovpn",
]);

// binaries + fonts (opaque blobs either way)
register("▰", [
  "exe", "dll", "so", "dylib", "bin", "o", "obj", "lib", "node", "wasm",
  "class", "pyc", "pyo", "pyd", "elf", "img", "dat", "pdb", "msi", "appimage",
  "ttf", "otf", "woff", "woff2", "eot",
]);

// web markup + styles
register("◍", [
  "html", "htm", "xhtml", "css", "scss", "sass", "less", "styl", "stylus",
  "ejs", "hbs", "handlebars", "mustache", "pug", "jade", "liquid", "haml",
  "twig", "njk",
]);

// audio + video
register("◎", [
  "mp3", "wav", "flac", "ogg", "oga", "opus", "aac", "m4a", "wma", "aiff",
  "mp4", "mkv", "mov", "avi", "webm", "flv", "wmv", "m4v", "mpg", "mpeg", "3gp",
]);

// extensionless files that still have an obvious identity
named("▤", ["dockerfile", "containerfile", "makefile", "procfile", "cmakelists.txt"]);
named("◈", ["gemfile", "rakefile", "vagrantfile", "jenkinsfile", "justfile", "brewfile", "guardfile"]);
named("≡", ["readme", "license", "licence", "copying", "authors", "notice", "changelog", "contributing", "codeowners", "todo"]);

const DOTFILE_GLYPH = "▤";
const DEFAULT_GLYPH = "·";

export function fileGlyph(name: string): string {
  const lower = name.toLowerCase();
  if (GLYPH_BY_NAME[lower]) return GLYPH_BY_NAME[lower];

  const dot = name.lastIndexOf(".");
  // a leading-dot file with no other dot (.bashrc, .gitignore) is config-ish
  if (dot <= 0) return name.startsWith(".") ? DOTFILE_GLYPH : DEFAULT_GLYPH;

  const ext = lower.slice(dot + 1);
  return GLYPH_BY_EXT[ext] ?? DEFAULT_GLYPH;
}

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  const units = ["K", "M", "G", "T"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)}${units[i]}`;
}

export function formatMtime(secs: number): string {
  return new Date(secs * 1000).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
