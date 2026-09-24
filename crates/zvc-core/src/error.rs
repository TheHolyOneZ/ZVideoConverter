use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("ffmpeg was not found")]
    FfmpegMissing,
    #[error("ffprobe failed: {0}")]
    Probe(String),
    #[error("download failed: {0}")]
    Download(String),
    #[error("checksum mismatch")]
    Checksum,
    #[error("profile not found: {0}")]
    ProfileNotFound(String),
    #[error("built-in profiles cannot be changed")]
    ProfileReadOnly,
    #[error("invalid profile: {0}")]
    InvalidProfile(String),
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Json(#[from] serde_json::Error),
}

impl Error {
    pub fn code(&self) -> &'static str {
        match self {
            Error::FfmpegMissing => "ffmpegMissing",
            Error::Probe(_) => "probe",
            Error::Download(_) => "download",
            Error::Checksum => "checksum",
            Error::ProfileNotFound(_) => "profileNotFound",
            Error::ProfileReadOnly => "profileReadOnly",
            Error::InvalidProfile(_) => "invalidProfile",
            Error::Io(_) => "io",
            Error::Json(_) => "json",
        }
    }
}

#[derive(Debug, Serialize)]
pub struct ErrorDto {
    pub code: &'static str,
    pub detail: String,
}

impl From<&Error> for ErrorDto {
    fn from(e: &Error) -> Self {
        ErrorDto { code: e.code(), detail: e.to_string() }
    }
}

pub type Result<T> = std::result::Result<T, Error>;
