pub const CONFIG_SEED: &[u8] = b"config";
pub const POOL_SEED: &[u8] = b"pool";

pub const TOKEN_DECIMALS: u8 = 6;

pub const MAX_NAME_LEN: usize = 32;
pub const MAX_SYMBOL_LEN: usize = 10;
pub const MAX_URI_LEN: usize = 200;

/// Hard ceiling on combined protocol + creator fees (5%). Enforced on every
/// config write so an admin can never set a punitive fee.
pub const MAX_TOTAL_FEE_BPS: u16 = 500;
/// Longest "calm waters" anti-snipe window an admin may configure.
pub const MAX_CALM_PERIOD_SECS: i64 = 600;
