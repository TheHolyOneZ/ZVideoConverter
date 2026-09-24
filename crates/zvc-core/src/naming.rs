use std::collections::HashSet;
use std::path::{Path, PathBuf};

use chrono::format::{Item, StrftimeItems};
use serde::{Deserialize, Serialize};

const MAX_STEM_BYTES: usize = 220;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum OutputLocation {
    SameAsSource,
    Folder { path: PathBuf },
    Subfolder { name: String },
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CollisionPolicy {
    Suffix,
    Overwrite,
    Skip,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NamingOptions {
    pub template: String,
    pub location: OutputLocation,
    pub keep_structure: bool,
    pub collision: CollisionPolicy,
}

impl Default for NamingOptions {
    fn default() -> Self {
        NamingOptions {
            template: "{name}".into(),
            location: OutputLocation::SameAsSource,
            keep_structure: true,
            collision: CollisionPolicy::Suffix,
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct NameVars {
    pub profile: String,
    pub vcodec: String,
    pub acodec: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fps: Option<f64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NameRequest {
    pub id: String,
    pub input: PathBuf,
    #[serde(default)]
    pub root: Option<PathBuf>,
    pub ext: String,
    #[serde(default)]
    pub vars: NameVars,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NameStatus {
    Ok,
    Suffixed,
    Overwrites,
    Skipped,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedName {
    pub id: String,
    pub output: PathBuf,
    pub status: NameStatus,
}

pub fn simplify_verbatim(path: &str) -> String {
    if let Some(rest) = path.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{rest}");
    }
    match path.strip_prefix(r"\\?\") {
        Some(rest) if rest.len() >= 2 && rest.as_bytes()[1] == b':' => rest.to_string(),
        _ => path.to_string(),
    }
}

pub fn source_stem(input: &Path) -> String {
    input
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn source_ext(input: &Path) -> String {
    input
        .extension()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn res_label(width: Option<u32>, height: Option<u32>) -> String {
    match (width, height) {
        (Some(w), Some(h)) if w > 0 && h > 0 => format!("{}p", w.min(h)),
        (_, Some(h)) if h > 0 => format!("{h}p"),
        _ => String::new(),
    }
}

fn fps_label(fps: Option<f64>) -> String {
    match fps {
        Some(f) if f > 0.0 => {
            let r = (f * 100.0).round() / 100.0;
            if r.fract() == 0.0 {
                format!("{}", r as i64)
            } else {
                format!("{r}")
            }
        }
        _ => String::new(),
    }
}

fn format_date(fmt: &str) -> Option<String> {
    let fmt = if fmt.is_empty() { "%Y-%m-%d" } else { fmt };
    let items: Vec<Item> = StrftimeItems::new(fmt).collect();
    if items.iter().any(|i| matches!(i, Item::Error)) {
        return None;
    }
    Some(chrono::Local::now().format_with_items(items.into_iter()).to_string())
}

pub fn render(template: &str, input: &Path, vars: &NameVars, counter: usize) -> String {
    let stem = source_stem(input);
    let mut out = String::with_capacity(template.len() + stem.len());
    let mut rest = template;

    while let Some(open) = rest.find('{') {
        out.push_str(&rest[..open]);
        let after = &rest[open + 1..];
        let Some(close) = after.find('}') else {
            out.push_str(&rest[open..]);
            return out;
        };
        let token = &after[..close];
        let (key, arg) = match token.split_once(':') {
            Some((k, a)) => (k, Some(a)),
            None => (token, None),
        };
        let value = match key {
            "name" => Some(stem.clone()),
            "ext" => Some(source_ext(input)),
            "profile" => Some(vars.profile.clone()),
            "vcodec" => Some(vars.vcodec.clone()),
            "acodec" => Some(vars.acodec.clone()),
            "width" => Some(vars.width.map(|w| w.to_string()).unwrap_or_default()),
            "height" => Some(vars.height.map(|h| h.to_string()).unwrap_or_default()),
            "res" => Some(res_label(vars.width, vars.height)),
            "fps" => Some(fps_label(vars.fps)),
            "parent" => Some(
                input
                    .parent()
                    .and_then(|p| p.file_name())
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_default(),
            ),
            "date" => format_date(arg.unwrap_or("")),
            "counter" => {
                let width = arg.and_then(|a| a.parse::<usize>().ok()).unwrap_or(1).min(12);
                Some(format!("{counter:0width$}"))
            }
            _ => None,
        };
        match value {
            Some(v) => out.push_str(&v),
            None => {
                out.push('{');
                out.push_str(token);
                out.push('}');
            }
        }
        rest = &after[close + 1..];
    }
    out.push_str(rest);
    out
}

const WINDOWS_RESERVED: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

pub fn sanitize_stem(stem: &str, windows: bool) -> String {
    let mut s: String = stem
        .chars()
        .map(|c| match c {
            '/' | '\0' => '_',
            '\\' | '<' | '>' | ':' | '"' | '|' | '?' | '*' if windows => '_',
            c if windows && (c as u32) < 0x20 => '_',
            c => c,
        })
        .collect();

    if windows {
        let trimmed = s.trim_end_matches(['.', ' ']).len();
        s.truncate(trimmed);
        let base = s.split('.').next().unwrap_or("").trim_end();
        if WINDOWS_RESERVED.iter().any(|r| r.eq_ignore_ascii_case(base)) {
            s.insert(base.len(), '_');
        }
    }

    if s.len() > MAX_STEM_BYTES {
        let mut cut = MAX_STEM_BYTES;
        while !s.is_char_boundary(cut) {
            cut -= 1;
        }
        s.truncate(cut);
        if windows {
            let trimmed = s.trim_end_matches(['.', ' ']).len();
            s.truncate(trimmed);
        }
    }

    if s.is_empty() || s == "." || s == ".." {
        return "output".into();
    }
    s
}

pub fn output_dir(req: &NameRequest, opts: &NamingOptions, windows: bool) -> PathBuf {
    let src_dir = req.input.parent().map(Path::to_path_buf).unwrap_or_default();
    match &opts.location {
        OutputLocation::SameAsSource => src_dir,
        OutputLocation::Subfolder { name } => {
            let name = sanitize_stem(name.trim(), windows);
            src_dir.join(name)
        }
        OutputLocation::Folder { path } => {
            if opts.keep_structure {
                if let Some(root) = &req.root {
                    let base = root.parent().unwrap_or(root);
                    if let Ok(rel) = src_dir.strip_prefix(base) {
                        return path.join(rel);
                    }
                }
            }
            path.clone()
        }
    }
}

pub fn path_key(p: &Path, windows: bool) -> String {
    let joined = if windows {
        p.to_string_lossy()
            .split(['/', '\\'])
            .filter(|c| !c.is_empty() && *c != ".")
            .collect::<Vec<_>>()
            .join("/")
    } else {
        p.components()
            .map(|c| c.as_os_str().to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join("/")
    };
    if windows {
        joined.to_lowercase()
    } else {
        joined
    }
}

pub fn plan(
    reqs: &[NameRequest],
    opts: &NamingOptions,
    windows: bool,
    exists: impl Fn(&Path) -> bool,
) -> Vec<PlannedName> {
    let mut reserved: HashSet<String> =
        reqs.iter().map(|r| path_key(&r.input, windows)).collect();
    let mut out = Vec::with_capacity(reqs.len());

    for (i, req) in reqs.iter().enumerate() {
        let dir = output_dir(req, opts, windows);
        let stem = sanitize_stem(&render(&opts.template, &req.input, &req.vars, i + 1), windows);
        let ext = req.ext.trim_start_matches('.');
        let make = |suffix: Option<usize>| -> PathBuf {
            let name = match suffix {
                Some(n) => format!("{stem} ({n})"),
                None => stem.clone(),
            };
            if ext.is_empty() {
                dir.join(name)
            } else {
                dir.join(format!("{name}.{ext}"))
            }
        };

        let first = make(None);
        let first_key = path_key(&first, windows);
        let in_batch = reserved.contains(&first_key);
        let on_disk = !in_batch && exists(&first);

        let (output, status) = if !in_batch && !on_disk {
            (first, NameStatus::Ok)
        } else if on_disk && opts.collision == CollisionPolicy::Overwrite {
            (first, NameStatus::Overwrites)
        } else if on_disk && opts.collision == CollisionPolicy::Skip {
            (first, NameStatus::Skipped)
        } else {
            let mut n = 2;
            loop {
                let candidate = make(Some(n));
                let key = path_key(&candidate, windows);
                if (!reserved.contains(&key) && !exists(&candidate)) || n >= 100_000 {
                    break (candidate, NameStatus::Suffixed);
                }
                n += 1;
            }
        };

        if status != NameStatus::Skipped {
            reserved.insert(path_key(&output, windows));
        }
        out.push(PlannedName { id: req.id.clone(), output, status });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(id: &str, input: &str, ext: &str) -> NameRequest {
        NameRequest {
            id: id.into(),
            input: PathBuf::from(input),
            root: None,
            ext: ext.into(),
            vars: NameVars::default(),
        }
    }

    fn names(plan: &[PlannedName]) -> Vec<String> {
        plan.iter()
            .map(|p| p.output.file_name().unwrap().to_string_lossy().into_owned())
            .collect()
    }

    fn opts() -> NamingOptions {
        NamingOptions {
            location: OutputLocation::Folder { path: "/out".into() },
            ..NamingOptions::default()
        }
    }

    #[test]
    fn dots_and_brackets_survive() {
        let cases = [
            ("/v/Show.S01E01.[1080p].x264.mkv", "Show.S01E01.[1080p].x264.mp4"),
            ("/v/a.b.c.d.avi", "a.b.c.d.mp4"),
            ("/v/[Group] Title - 01 [ABCD1234].mkv", "[Group] Title - 01 [ABCD1234].mp4"),
            ("/v/Movie (2021) {edition-Director's Cut}.mkv", "Movie (2021) {edition-Director's Cut}.mp4"),
            ("/v/100% real.mov", "100% real.mp4"),
            ("/v/Ünïcödé 日本語 🎬.webm", "Ünïcödé 日本語 🎬.mp4"),
            ("/v/-starts-with-dash.mkv", "-starts-with-dash.mp4"),
            ("/v/no_extension", "no_extension.mp4"),
            ("/v/trailing.dot..mkv", "trailing.dot..mp4"),
            ("/v/  spaced  .mkv", "  spaced  .mp4"),
        ];
        for (input, expected) in cases {
            let p = plan(&[req("1", input, "mp4")], &opts(), false, |_| false);
            assert_eq!(names(&p), vec![expected], "input {input}");
            assert_eq!(p[0].status, NameStatus::Ok);
        }
    }

    #[test]
    fn same_prefix_files_stay_distinct() {
        let reqs = vec![
            req("1", "/v/Show.S01E01.[1080p].mkv", "mp4"),
            req("2", "/v/Show.S01E02.[1080p].mkv", "mp4"),
            req("3", "/v/Show.S01E03.[1080p].mkv", "mp4"),
        ];
        let p = plan(&reqs, &opts(), false, |_| false);
        assert_eq!(
            names(&p),
            vec!["Show.S01E01.[1080p].mp4", "Show.S01E02.[1080p].mp4", "Show.S01E03.[1080p].mp4"]
        );
        assert!(p.iter().all(|x| x.status == NameStatus::Ok));
    }

    #[test]
    fn substituted_values_are_not_reparsed() {
        let r = render("{name}-{profile}", Path::new("/v/{name}{counter}.mkv"), &NameVars {
            profile: "{res}".into(),
            ..Default::default()
        }, 1);
        assert_eq!(r, "{name}{counter}-{res}");
    }

    #[test]
    fn tokens_render() {
        let vars = NameVars {
            profile: "HEVC".into(),
            vcodec: "hevc".into(),
            acodec: "aac".into(),
            width: Some(1920),
            height: Some(1080),
            fps: Some(23.976),
        };
        let r = render("{name}_{res}_{width}x{height}_{fps}_{vcodec}_{acodec}_{profile}_{counter:3}_{ext}_{parent}_{nope}", Path::new("/v/Season 1/ep.mkv"), &vars, 7);
        assert_eq!(r, "ep_1080p_1920x1080_23.98_hevc_aac_HEVC_007_mkv_Season 1_{nope}");
        assert_eq!(render("{name", Path::new("/v/a.mkv"), &vars, 1), "{name");
        assert_eq!(render("x{date:%Q}", Path::new("/v/a.mkv"), &vars, 1), "x{date:%Q}");
        assert_eq!(render("{date:%Y}", Path::new("/v/a.mkv"), &vars, 1).len(), 4);
    }

    #[test]
    fn same_name_different_ext_in_batch_gets_suffix() {
        let reqs = vec![req("1", "/v/clip.mkv", "mp4"), req("2", "/v/clip.avi", "mp4")];
        let p = plan(&reqs, &opts(), false, |_| false);
        assert_eq!(names(&p), vec!["clip.mp4", "clip (2).mp4"]);
        assert_eq!(p[1].status, NameStatus::Suffixed);
    }

    #[test]
    fn never_overwrites_a_source_even_with_overwrite_policy() {
        let o = NamingOptions { collision: CollisionPolicy::Overwrite, ..NamingOptions::default() };
        let p = plan(&[req("1", "/v/clip.mp4", "mp4")], &o, false, |p| p == Path::new("/v/clip.mp4"));
        assert_eq!(p[0].output, PathBuf::from("/v/clip (2).mp4"));
        assert_eq!(p[0].status, NameStatus::Suffixed);
    }

    #[test]
    fn never_overwrites_another_jobs_source() {
        let reqs = vec![req("1", "/v/b.mp4", "mkv"), req("2", "/v/b.mkv", "mp4")];
        let o = NamingOptions { collision: CollisionPolicy::Overwrite, ..NamingOptions::default() };
        let p = plan(&reqs, &o, false, |_| false);
        assert_eq!(p[0].output, PathBuf::from("/v/b (2).mkv"));
        assert_eq!(p[1].output, PathBuf::from("/v/b (2).mp4"));
    }

    #[test]
    fn existing_files_follow_policy() {
        let exists = |p: &Path| p == Path::new("/out/a.mp4") || p == Path::new("/out/a (2).mp4");
        let mut o = opts();
        let p = plan(&[req("1", "/v/a.mkv", "mp4")], &o, false, exists);
        assert_eq!(names(&p), vec!["a (3).mp4"]);
        o.collision = CollisionPolicy::Overwrite;
        let p = plan(&[req("1", "/v/a.mkv", "mp4")], &o, false, exists);
        assert_eq!((names(&p)[0].as_str(), p[0].status), ("a.mp4", NameStatus::Overwrites));
        o.collision = CollisionPolicy::Skip;
        let p = plan(&[req("1", "/v/a.mkv", "mp4")], &o, false, exists);
        assert_eq!(p[0].status, NameStatus::Skipped);
    }

    #[test]
    fn windows_is_case_insensitive() {
        let reqs = vec![req("1", "C:/v/Clip.mkv", "mp4"), req("2", "C:/v2/clip.mkv", "mp4")];
        let mut o = opts();
        o.location = OutputLocation::Folder { path: "C:/out".into() };
        let p = plan(&reqs, &o, true, |_| false);
        assert_eq!(p[1].status, NameStatus::Suffixed);
    }

    #[test]
    fn mixed_separators_are_the_same_file() {
        assert_eq!(path_key(Path::new("C:/Videos\\a.MKV"), true), path_key(Path::new("c:\\videos/a.mkv"), true));
        assert_eq!(path_key(Path::new("/v/./a.mkv"), false), path_key(Path::new("/v/a.mkv"), false));
        let reqs = vec![req("1", "C:/v/clip.mp4", "mp4")];
        let o = NamingOptions { location: OutputLocation::Folder { path: "C:\\v".into() }, ..NamingOptions::default() };
        let p = plan(&reqs, &o, true, |_| false);
        assert_eq!(p[0].status, NameStatus::Suffixed);
    }

    #[test]
    fn verbatim_paths() {
        assert_eq!(simplify_verbatim(r"\\?\C:\Videos\a.mkv"), r"C:\Videos\a.mkv");
        assert_eq!(simplify_verbatim(r"\\?\UNC\nas\share\a.mkv"), r"\\nas\share\a.mkv");
        assert_eq!(simplify_verbatim(r"\\?\Volume{abc}\a.mkv"), r"\\?\Volume{abc}\a.mkv");
        assert_eq!(simplify_verbatim("/home/a.mkv"), "/home/a.mkv");
    }

    #[test]
    fn sanitize_windows() {
        assert_eq!(sanitize_stem("a:b?c*d", true), "a_b_c_d");
        assert_eq!(sanitize_stem("a:b?c*d", false), "a:b?c*d");
        assert_eq!(sanitize_stem("CON", true), "CON_");
        assert_eq!(sanitize_stem("con.backup", true), "con_.backup");
        assert_eq!(sanitize_stem("CONSOLE", true), "CONSOLE");
        assert_eq!(sanitize_stem("name. . ", true), "name");
        assert_eq!(sanitize_stem("a/b", false), "a_b");
        assert_eq!(sanitize_stem("", false), "output");
        let long = "é".repeat(200);
        let s = sanitize_stem(&long, false);
        assert!(s.len() <= MAX_STEM_BYTES && s.chars().all(|c| c == 'é'));
    }

    #[test]
    fn locations() {
        let mut r = req("1", "/media/Series/S1/ep.mkv", "mp4");
        r.root = Some("/media/Series".into());
        let mut o = opts();
        assert_eq!(output_dir(&r, &o, false), PathBuf::from("/out/Series/S1"));
        o.keep_structure = false;
        assert_eq!(output_dir(&r, &o, false), PathBuf::from("/out"));
        o.location = OutputLocation::Subfolder { name: "converted".into() };
        assert_eq!(output_dir(&r, &o, false), PathBuf::from("/media/Series/S1/converted"));
        o.location = OutputLocation::SameAsSource;
        assert_eq!(output_dir(&r, &o, false), PathBuf::from("/media/Series/S1"));
    }
}
