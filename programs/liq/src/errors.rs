use anchor_lang::prelude::*;

#[error_code]
pub enum LiqError {
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Launches and buys are paused")]
    Paused,
    #[msg("Fee configuration exceeds the 5% ceiling")]
    FeeTooHigh,
    #[msg("Curve parameters are inconsistent")]
    InvalidCurveParams,
    #[msg("Calm period is longer than allowed")]
    CalmPeriodTooLong,
    #[msg("Name is empty or too long")]
    InvalidName,
    #[msg("Symbol is empty or too long")]
    InvalidSymbol,
    #[msg("Metadata URI is too long")]
    InvalidUri,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Output is below your minimum (slippage)")]
    SlippageExceeded,
    #[msg("Calm waters: buy exceeds the per-transaction cap during the launch window")]
    CalmWatersCap,
    #[msg("Pool does not have enough liquidity for this trade")]
    InsufficientLiquidity,
    #[msg("Nothing to claim")]
    NothingToClaim,
}
