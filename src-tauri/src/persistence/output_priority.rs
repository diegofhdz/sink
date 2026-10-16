//! The global output priority list, plus a memory of every output device
//! Sink has seen, so a device that is unplugged right now can still be
//! ranked. Stored as JSON at `$XDG_CONFIG_HOME/sink/output_priority.json`.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::audio::types::{is_own_sink, OutputDevice};
use crate::error::SinkError;

/// One output device Sink has observed.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct KnownOutput {
    /// `node.name`, which stays the same across reconnects.
    pub name: String,
    /// Description at last sighting, so an absent device keeps its name.
    pub description: String,
    /// Unix seconds of the last sighting.
    pub last_seen: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct OutputPriority {
    /// Device `node.name`s, highest priority first.
    #[serde(default)]
    pub order: Vec<String>,
    #[serde(default)]
    pub known: Vec<KnownOutput>,
}

impl OutputPriority {
    pub fn config_path() -> Result<PathBuf, SinkError> {
        let dir = crate::persistence::config_root()
            .ok_or_else(|| SinkError::Config("cannot resolve the user config directory".into()))?;
        Ok(dir.join("sink").join("output_priority.json"))
    }

    pub fn load() -> Self {
        let Ok(path) = Self::config_path() else {
            return Self::default();
        };
        match fs::read_to_string(&path) {
            Ok(raw) => serde_json::from_str(&raw).unwrap_or_else(|e| {
                eprintln!("sink: ignoring malformed {}: {e}", path.display());
                Self::default()
            }),
            Err(_) => Self::default(),
        }
    }

    pub fn save(&self) -> Result<(), SinkError> {
        let path = Self::config_path()?;
        if let Some(parent) = path.parent() {
            crate::persistence::ensure_private_dir(parent)?;
        }
        let json = serde_json::to_string_pretty(self)
            .map_err(|e| SinkError::Config(format!("serialize output priority: {e}")))?;
        super::write_atomic(&path, &json)?;
        Ok(())
    }

    /// Note a sighting of the live devices. True when a device is new or
    /// renamed - worth saving now, unlike a bare `last_seen` bump.
    pub fn record(&mut self, devices: &[OutputDevice], now: u64) -> bool {
        let mut changed = false;
        for device in devices.iter().filter(|d| !d.name.is_empty()) {
            match self.known.iter_mut().find(|k| k.name == device.name) {
                Some(known) => {
                    known.last_seen = now;
                    // A node can show up before its description is filled
                    // in; keep the old one rather than blank it.
                    if !device.description.is_empty() && known.description != device.description {
                        known.description = device.description.clone();
                        changed = true;
                    }
                }
                None => {
                    self.known.push(KnownOutput {
                        name: device.name.clone(),
                        description: device.description.clone(),
                        last_seen: now,
                    });
                    changed = true;
                }
            }
        }
        changed
    }

    /// Replace the ranking, dropping blanks, repeats (first one wins) and our
    /// own nodes, which a channel can't play into without a loop.
    pub fn set_order(&mut self, order: Vec<String>) {
        let mut ranked: Vec<String> = Vec::with_capacity(order.len());
        for name in order {
            if !name.trim().is_empty() && !is_own_sink(&name) && !ranked.contains(&name) {
                ranked.push(name);
            }
        }
        self.order = ranked;
    }

    /// Forget a device: its memory and its rank. True when it was ranked,
    /// so the backend needs the new order.
    pub fn forget(&mut self, name: &str) -> bool {
        self.known.retain(|k| k.name != name);
        let before = self.order.len();
        self.order.retain(|n| n != name);
        self.order.len() != before
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn device(name: &str, description: &str) -> OutputDevice {
        OutputDevice {
            index: 0,
            name: name.into(),
            description: description.into(),
        }
    }

    #[test]
    fn record_remembers_devices_and_flags_only_real_changes() {
        let mut p = OutputPriority::default();
        assert!(p.record(&[device("usb", "Headset")], 10), "new device");
        assert!(
            !p.record(&[device("usb", "Headset")], 20),
            "just a sighting"
        );
        assert_eq!(p.known[0].last_seen, 20);
        assert!(p.record(&[device("usb", "Headset Pro")], 30), "renamed");
        assert_eq!(p.known[0].description, "Headset Pro");
        // Gone from the live set, still remembered.
        assert!(!p.record(&[], 40));
        assert_eq!(p.known.len(), 1);
        assert_eq!(p.known[0].last_seen, 30);
    }

    #[test]
    fn record_keeps_a_description_over_a_blank_one() {
        let mut p = OutputPriority::default();
        p.record(&[device("usb", "Headset")], 10);
        assert!(!p.record(&[device("usb", "")], 20));
        assert_eq!(p.known[0].description, "Headset");
    }

    #[test]
    fn record_skips_nameless_nodes() {
        let mut p = OutputPriority::default();
        assert!(!p.record(&[device("", "Ghost")], 10));
        assert!(p.known.is_empty());
    }

    #[test]
    fn set_order_drops_blanks_repeats_and_our_own_nodes() {
        let mut p = OutputPriority::default();
        p.set_order(vec![
            "a".into(),
            " ".into(),
            "sink_game".into(),
            "b".into(),
            "a".into(),
        ]);
        assert_eq!(p.order, vec!["a", "b"]);
    }

    #[test]
    fn forget_drops_memory_and_rank() {
        let mut p = OutputPriority::default();
        p.record(&[device("a", "A"), device("b", "B")], 10);
        p.set_order(vec!["a".into()]);
        assert!(!p.forget("b"), "b was not ranked");
        assert!(p.forget("a"));
        assert!(p.known.is_empty());
        assert!(p.order.is_empty());
    }

    #[test]
    fn roundtrips_and_loads_an_empty_object() {
        let mut p = OutputPriority::default();
        p.record(&[device("a", "A")], 10);
        p.set_order(vec!["a".into()]);
        let back: OutputPriority =
            serde_json::from_str(&serde_json::to_string(&p).unwrap()).unwrap();
        assert_eq!(back, p);
        let empty: OutputPriority = serde_json::from_str("{}").unwrap();
        assert_eq!(empty, OutputPriority::default());
    }
}
