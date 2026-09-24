const GROUPS: &[&[&str]] = &[
    &["ger", "deu", "de", "german", "deutsch"],
    &["eng", "en", "english"],
    &["fre", "fra", "fr", "french", "français", "francais"],
    &["spa", "es", "spanish", "español", "espanol"],
    &["ita", "it", "italian", "italiano"],
    &["por", "pt", "portuguese", "português", "portugues"],
    &["dut", "nld", "nl", "dutch", "nederlands"],
    &["pol", "pl", "polish", "polski"],
    &["rus", "ru", "russian"],
    &["ukr", "uk", "ukrainian"],
    &["cze", "ces", "cs", "czech"],
    &["slo", "slk", "sk", "slovak"],
    &["hun", "hu", "hungarian"],
    &["rum", "ron", "ro", "romanian"],
    &["gre", "ell", "el", "greek"],
    &["tur", "tr", "turkish"],
    &["swe", "sv", "swedish"],
    &["dan", "da", "danish"],
    &["nor", "nob", "nno", "no", "nb", "nn", "norwegian"],
    &["fin", "fi", "finnish"],
    &["ice", "isl", "is", "icelandic"],
    &["jpn", "ja", "japanese"],
    &["kor", "ko", "korean"],
    &["chi", "zho", "zh", "chinese"],
    &["ara", "ar", "arabic"],
    &["heb", "he", "iw", "hebrew"],
    &["hin", "hi", "hindi"],
    &["tha", "th", "thai"],
    &["vie", "vi", "vietnamese"],
    &["ind", "id", "indonesian"],
    &["may", "msa", "ms", "malay"],
    &["per", "fas", "fa", "persian"],
    &["hrv", "hr", "croatian"],
    &["srp", "sr", "serbian"],
    &["bul", "bg", "bulgarian"],
    &["slv", "sl", "slovenian"],
    &["est", "et", "estonian"],
    &["lav", "lv", "latvian"],
    &["lit", "lt", "lithuanian"],
    &["cat", "ca", "catalan"],
];

pub fn normalize(code: &str) -> String {
    let c = code.trim().to_lowercase();
    GROUPS
        .iter()
        .find(|g| g.contains(&c.as_str()))
        .map(|g| g[0].to_string())
        .unwrap_or(c)
}

pub fn matches(tag: Option<&str>, wanted: &str) -> bool {
    match tag {
        Some(t) if !t.trim().is_empty() && t != "und" => normalize(t) == normalize(wanted),
        _ => false,
    }
}

pub fn rank(tag: Option<&str>, wanted: &[String]) -> Option<usize> {
    wanted.iter().position(|w| matches(tag, w))
}

pub fn looks_like_code(s: &str) -> bool {
    let c = s.to_lowercase();
    (c.len() == 2 || c.len() == 3) && GROUPS.iter().any(|g| g.contains(&c.as_str()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes() {
        assert!(matches(Some("ger"), "de"));
        assert!(matches(Some("deu"), "German"));
        assert!(matches(Some("eng"), "en"));
        assert!(!matches(Some("eng"), "de"));
        assert!(!matches(Some("und"), "und"));
        assert!(!matches(None, "de"));
        assert_eq!(normalize("FRA"), "fre");
        assert_eq!(normalize("xx"), "xx");
        assert_eq!(rank(Some("eng"), &["de".into(), "en".into()]), Some(1));
        assert!(looks_like_code("de") && looks_like_code("eng") && !looks_like_code("forced") && !looks_like_code("x"));
    }
}
