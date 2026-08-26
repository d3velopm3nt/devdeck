//! Credential storage, via Windows Credential Manager.
//!
//! The rule from CLAUDE.md: *credentials belong in Windows Credential Manager
//! / DPAPI, never plaintext in SQLite.* This module is the only place a
//! password exists in this codebase, and it never lands in our database, our
//! logs, or any struct that gets serialised to the frontend.
//!
//! Secrets are handed out only to the code building a command line for a
//! database client, and are never returned over IPC.

/// Credential Manager target for a connection's password.
pub fn target_for(connection_id: i64) -> String {
    format!("devdeck:connection:{connection_id}")
}

#[cfg(windows)]
mod win {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Security::Credentials::{
        CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE,
        CRED_TYPE_GENERIC,
    };

    fn wide(s: &str) -> Vec<u16> {
        std::ffi::OsStr::new(s)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    /// Store (or replace) the secret for `target`.
    pub fn set(target: &str, user: &str, secret: &str) -> Result<(), String> {
        // UTF-16LE without a trailing NUL is the convention for generic
        // credentials, so the value reads correctly in the Windows UI and
        // `cmdkey` rather than showing as mojibake.
        let mut blob: Vec<u8> = secret
            .encode_utf16()
            .flat_map(|u| u.to_le_bytes())
            .collect();
        let mut target_w = wide(target);
        let mut user_w = wide(user);
        unsafe {
            let mut cred: CREDENTIALW = std::mem::zeroed();
            cred.Type = CRED_TYPE_GENERIC;
            cred.TargetName = target_w.as_mut_ptr();
            cred.CredentialBlobSize = blob.len() as u32;
            cred.CredentialBlob = blob.as_mut_ptr();
            cred.Persist = CRED_PERSIST_LOCAL_MACHINE;
            cred.UserName = user_w.as_mut_ptr();
            if CredWriteW(&cred, 0) == 0 {
                return Err("Windows refused to store the credential".into());
            }
        }
        Ok(())
    }

    /// Read the secret back. `None` when nothing is stored for this target.
    pub fn get(target: &str) -> Option<String> {
        let target_w = wide(target);
        unsafe {
            let mut ptr: *mut CREDENTIALW = std::ptr::null_mut();
            if CredReadW(target_w.as_ptr(), CRED_TYPE_GENERIC, 0, &mut ptr) == 0 {
                return None;
            }
            let cred = &*ptr;
            let len = cred.CredentialBlobSize as usize;
            let secret = if len == 0 || cred.CredentialBlob.is_null() {
                String::new()
            } else {
                let bytes = std::slice::from_raw_parts(cred.CredentialBlob, len);
                let units: Vec<u16> = bytes
                    .chunks_exact(2)
                    .map(|c| u16::from_le_bytes([c[0], c[1]]))
                    .collect();
                String::from_utf16_lossy(&units)
            };
            CredFree(ptr as *mut _);
            Some(secret)
        }
    }

    pub fn delete(target: &str) -> bool {
        let target_w = wide(target);
        unsafe { CredDeleteW(target_w.as_ptr(), CRED_TYPE_GENERIC, 0) != 0 }
    }
}

#[cfg(not(windows))]
mod win {
    pub fn set(_t: &str, _u: &str, _s: &str) -> Result<(), String> {
        Err("Credential storage is Windows-only".into())
    }
    pub fn get(_t: &str) -> Option<String> {
        None
    }
    pub fn delete(_t: &str) -> bool {
        false
    }
}

#[allow(unused_imports)]
pub use win::{delete, get, set};

/// Whether a secret exists, without reading it. This is what the frontend is
/// allowed to know -- "a password is saved", never the password.
pub fn exists(target: &str) -> bool {
    get(target).is_some()
}
