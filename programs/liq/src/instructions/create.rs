use anchor_lang::{prelude::*, system_program};
use anchor_spl::{
    associated_token::AssociatedToken,
    token_2022::{self, spl_token_2022::instruction::AuthorityType, MintTo, SetAuthority, Token2022},
    token_2022_extensions::{token_metadata_initialize, TokenMetadataInitialize},
    token_interface::{Mint, TokenAccount},
};

use crate::{
    constants::*,
    errors::LiqError,
    events::LaunchEvent,
    state::{Config, Phase, Pool},
};

#[derive(Accounts)]
pub struct CreateLaunch<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,

    /// Fresh keypair supplied by the client, so creators can grind a vanity
    /// address. Token-2022 with the metadata living on the mint itself.
    #[account(
        init,
        signer,
        payer = creator,
        mint::token_program = token_program,
        mint::decimals = TOKEN_DECIMALS,
        mint::authority = pool,
        extensions::metadata_pointer::authority = pool,
        extensions::metadata_pointer::metadata_address = mint,
    )]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = creator,
        space = 8 + Pool::INIT_SPACE,
        seeds = [POOL_SEED, mint.key().as_ref()],
        bump,
    )]
    pub pool: Box<Account<'info, Pool>>,

    #[account(
        init,
        payer = creator,
        associated_token::mint = mint,
        associated_token::authority = pool,
        associated_token::token_program = token_program,
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn create_launch(mut ctx: Context<CreateLaunch>, name: String, symbol: String, uri: String) -> Result<()> {
    require!(!ctx.accounts.config.paused, LiqError::Paused);
    require!(!name.trim().is_empty() && name.len() <= MAX_NAME_LEN, LiqError::InvalidName);
    require!(!symbol.trim().is_empty() && symbol.len() <= MAX_SYMBOL_LEN, LiqError::InvalidSymbol);
    require!(uri.len() <= MAX_URI_LEN, LiqError::InvalidUri);

    let accounts = &mut ctx.accounts;
    let params = accounts.config.params;
    let now = Clock::get()?.unix_timestamp;
    let mint_key = accounts.mint.key();
    let pool_key = accounts.pool.key();
    let bump = ctx.bumps.pool;
    let signer: &[&[&[u8]]] = &[&[POOL_SEED, mint_key.as_ref(), &[bump]]];

    // Token-2022 reallocs the mint to append metadata; top up rent first.
    // TLV header (4) + update authority (32) + mint (32) + three
    // length-prefixed strings + empty additional-metadata vec (4).
    let metadata_len = 4 + 32 + 32 + (4 + name.len()) + (4 + symbol.len()) + (4 + uri.len()) + 4;
    let mint_info = accounts.mint.to_account_info();
    let needed = Rent::get()?.minimum_balance(mint_info.data_len() + metadata_len);
    let top_up = needed.saturating_sub(mint_info.lamports());
    if top_up > 0 {
        system_program::transfer(
            CpiContext::new(
                system_program::ID,
                system_program::Transfer { from: accounts.creator.to_account_info(), to: mint_info.clone() },
            ),
            top_up,
        )?;
    }

    token_metadata_initialize(
        CpiContext::new_with_signer(
            token_2022::ID,
            TokenMetadataInitialize {
                program_id: accounts.token_program.to_account_info(),
                metadata: mint_info.clone(),
                update_authority: accounts.pool.to_account_info(),
                mint_authority: accounts.pool.to_account_info(),
                mint: mint_info.clone(),
            },
            signer,
        ),
        name.clone(),
        symbol.clone(),
        uri.clone(),
    )?;

    // Mint the entire fixed supply into the pool's vault, then renounce the
    // mint authority forever. There is no freeze authority to begin with.
    token_2022::mint_to(
        CpiContext::new_with_signer(
            token_2022::ID,
            MintTo {
                mint: mint_info.clone(),
                to: accounts.vault.to_account_info(),
                authority: accounts.pool.to_account_info(),
            },
            signer,
        ),
        params.total_supply,
    )?;
    token_2022::set_authority(
        CpiContext::new_with_signer(
            token_2022::ID,
            SetAuthority { current_authority: accounts.pool.to_account_info(), account_or_mint: mint_info },
            signer,
        ),
        AuthorityType::MintTokens,
        None,
    )?;

    let launch_index = accounts.config.launch_count;
    accounts.config.launch_count = launch_index.checked_add(1).ok_or(LiqError::MathOverflow)?;

    accounts.pool.set_inner(Pool {
        mint: mint_key,
        creator: accounts.creator.key(),
        phase: Phase::Curve,
        params,
        virtual_sol: params.initial_virtual_sol,
        virtual_tokens: params.initial_virtual_tokens,
        real_sol: 0,
        real_tokens: params.curve_supply,
        reserve_tokens: params.total_supply - params.curve_supply,
        creator_fees_unclaimed: 0,
        creator_fees_total: 0,
        volume_lamports: 0,
        trade_count: 0,
        launch_index,
        launched_at: now,
        graduated_at: 0,
        bump,
    });

    emit!(LaunchEvent {
        mint: mint_key,
        pool: pool_key,
        creator: accounts.creator.key(),
        name,
        symbol,
        uri,
        launch_index,
        timestamp: now,
    });
    Ok(())
}
