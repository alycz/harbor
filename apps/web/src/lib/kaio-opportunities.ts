/** Public discovery snapshot, not a verified investor-specific instrument registry. */
export const KAIO_CATALOG_SOURCE = 'https://kaio.xyz/';
export const KAIO_CATALOG_CHECKED_AT = '2026-11-14';
export const KAIO_OPPORTUNITIES = [
  { symbol: 'CASH', name: 'BlackRock ICS US Dollar Liquidity Fund', category: 'Money market', minimumUsd: '100', liquidity: 'Daily' },
  { symbol: 'SCOPE', name: 'Hamilton Lane Senior Credit Opportunities Fund', category: 'Private credit', minimumUsd: '10000', liquidity: 'Monthly' },
  { symbol: 'VOLT', name: 'Laser Digital Carry Fund', category: 'Crypto basis', minimumUsd: '10000', liquidity: 'Monthly' },
  { symbol: 'MACRO', name: 'Brevan Howard Master Fund', category: 'Hedge fund', minimumUsd: '10000', liquidity: 'Monthly' },
  { symbol: 'MCAS', name: 'Mubadala Capital Alternatives Solution Fund', category: 'Private equity', minimumUsd: '100000', liquidity: 'Monthly' },
] as const;
export type KaioOpportunity = (typeof KAIO_OPPORTUNITIES)[number];

export function kaioResearchPrompt(opportunity: KaioOpportunity): string {
  return `Research KAIO ${opportunity.symbol} (${opportunity.name}) from ${KAIO_CATALOG_SOURCE} and the official KAIO documentation. Compare its risks, current minimum, dealing window, fees and investor/jurisdiction eligibility. The catalog snapshot was checked ${KAIO_CATALOG_CHECKED_AT}; verify current terms. Harbor has no linked KAIO investor session or verified instrument ID, so do not claim a mint/subscription is executable or submitted. Explain the steps required to subscribe.`;
}
